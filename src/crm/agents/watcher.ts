// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

// FR-010..014, Journey 2 — the firm watcher's desktop-drivable half. It runs
// over the WHOLE firm on a `*/5` schedule (one coordinator Project, one trigger),
// not one case at a time. Each pass reads the firm index + the head of each
// case's log, fast-path SKIPS the cases whose head has not moved and whose clocks
// have not crossed a threshold (so no model tokens are spent on the unchanged),
// then for the rest fires deterministic triggers — a fixed-rate-end radar and a
// stalled-case chase. Every decision is PROPOSE-ONLY: it writes an
// `lm.watcher.decision/1` artifact (its `directive` left UNSET — the M3 dispatch
// seam), raises a worklist item on the case log, and mirrors a G7 proposal for a
// stage transition. Nothing is sent, nothing transitions. The per-case breaker
// and per-pass budget bound the pass; a tripped limit is a metric, not an error.
// The server-side behaviour is described in the lm-watcher SKILL; this module is
// the deterministic half a test can drive.

import type { CaseLogEvent } from '../agentContracts';
import {
  FIRM_CONFIG_DEFAULTS,
  decodeFirmConfig,
  gateById,
  type FirmConfig,
  type VersionStamp,
} from '../agentContracts';
import type {
  ActivityEvent,
  WorklistItem,
  WorklistKind,
} from '../domain/types';
import { CRM_SCHEMA_VERSION } from '../domain/types';
import { getCrmFirmStore } from '../firmStore';
import { getCrmEventLogStore, type MirroredGate } from '../fold/eventLogStore';
import {
  CaseBreaker,
  PassBudget,
  buildSpendRecord,
  usdMicroToGbpMicro,
} from './budget';
import { appendCaseLog } from './caseLogWrite';
import { firmCoordinatorProject } from './caseProject';
import { encodeJsonAttachment } from './codec';
import type { AgentEdge } from './edge';
import { getAgentEdge } from './edge';
import { readFirmIndex, type CaseIndexPointer } from './firmIndex';
import type {
  SpendRecord,
  WatcherDecisionKind,
  WatcherDecisionPayload,
  WatcherPassReport,
} from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

// A fixed-rate deal within this window of its end is a remortgage/retention
// opportunity worth surfacing well before the deal lapses (FR-013).
const RATE_END_LEAD_MS = 120 * DAY_MS;
// A case that has not moved for this long is stalled and needs a chase (FR-013).
const STALL_MS = 14 * DAY_MS;
// A realistic per-decision provider cost in micro-USD; the pass converts the
// running total to the firm's currency for its SpendRecord (FR-014).
const PROVIDER_CALL_MICRO_USD = 2_000n;

// The five-field cron the coordinator schedule fires on — every 5 minutes.
const WATCHER_CRON = '*/5 * * * *';
// The command text the schedule submits on each firing. The server-side skill
// (lm-watcher) turns this into a pass; the desktop half is runWatcherPass.
const WATCHER_TASK_TEXT =
  'Run one lm-watcher pass over this firm: read the case index, skip the ' +
  'unchanged, and propose next actions for the rest. Propose only — never send.';

const WATCHER_VERSIONS: VersionStamp = {
  model: 'lm-watcher',
  promptSha: 'lm-watcher',
  skillSemver: '1.0.0',
  skillSha: 'lm-watcher-m2',
};

// The facts a trigger reads for a case, published alongside its log as
// `lm/case/<caseId>/facts.json`. All optional — a thin case simply fires fewer
// triggers rather than throwing.
export interface WatcherCaseFacts {
  stage?: string;
  /** Epoch ms the current fixed-rate deal ends. */
  fixedRateEndAt?: number;
  /** Epoch ms of the last movement on the case (for the stall clock). */
  lastActivityAt?: number;
}

interface TriggerHit {
  kind: WatcherDecisionKind;
  reason: { claim: string; working: string[]; confidence: number };
  /** True when the proposal is a regulatory-meaning transition (raises G7). */
  raisesG7: boolean;
  worklistKind: WorklistKind;
  title: string;
  detail: string;
}

// The cross-pass fast-path memory (headSeq + last proposed kind per case) is
// persisted in the durable firm store, not a module Map (finding 3): a process
// restart or renderer reload used to wipe it, so a warm restart re-spent on and
// re-proposed for cases that had not moved. See firmStore.watcherLastSeenByCase.

// The per-case invocation breaker is a ROLLING-HOUR limit, so it must persist
// across passes (a `*/5` cadence is 12 passes an hour): one breaker per firm,
// pruned by its own sliding window. A fresh per-pass breaker could never trip.
const breakersByFirm = new Map<string, CaseBreaker>();

function lastSeenKey(firmId: string, caseId: string): string {
  return `${firmId}::${caseId}`;
}

function firmBreaker(firmId: string, maxPerHour: number): CaseBreaker {
  const existing = breakersByFirm.get(firmId);
  if (existing) return existing;
  const created = new CaseBreaker(maxPerHour);
  breakersByFirm.set(firmId, created);
  return created;
}

/** Drops the cross-pass fast-path memory + breakers (tests, or a firm re-seed). */
export function resetWatcherState(): void {
  breakersByFirm.clear();
  getCrmFirmStore().getState().clearWatcherLastSeen();
}

export interface RunWatcherPassOptions {
  /** The pass clock; defaults to Date.now(). */
  now?: number;
  /** Inject the firm config instead of reading lm/config.json (tests). */
  firmConfig?: FirmConfig;
  /** A stable pass id; defaults to a firm+clock derived id. */
  passId?: string;
}

function facts(pointerFacts: unknown): WatcherCaseFacts {
  if (!pointerFacts || typeof pointerFacts !== 'object') return {};
  const row = pointerFacts as Record<string, unknown>;
  const out: WatcherCaseFacts = {};
  if (typeof row.stage === 'string') out.stage = row.stage;
  if (typeof row.fixedRateEndAt === 'number') {
    out.fixedRateEndAt = row.fixedRateEndAt;
  }
  if (typeof row.lastActivityAt === 'number') {
    out.lastActivityAt = row.lastActivityAt;
  }
  return out;
}

function caseFactsName(caseId: string): string {
  return `lm/case/${caseId}/facts.json`;
}

// Read the latest version of an exact-named JSON artifact, or null when absent.
// Uses only listArtifacts + inline getArtifact, so a server-side run reads the
// same bytes the desktop would (the run-portability rule, T009).
async function readNamedJson(
  edge: AgentEdge,
  projectId: string,
  name: string
): Promise<unknown | null> {
  const list = await edge.listArtifacts(projectId, { name });
  const newest = list.artifacts?.[0];
  if (!newest) return null;
  const access = await edge.getArtifact(projectId, newest.artifact_id, {
    inline: true,
  });
  if (access.content_truncated === true || access.content === undefined) {
    return null;
  }
  return JSON.parse(access.content);
}

// The firm's config, from lm/config.json in the coordinator Project, else the
// documented defaults. A missing config is never "unbounded" — the breaker and
// budget defaults still bite.
async function loadFirmConfig(
  edge: AgentEdge,
  firmId: string
): Promise<FirmConfig> {
  const projectId = await firmCoordinatorProject(firmId);
  const raw = await readNamedJson(edge, projectId, 'lm/config.json');
  if (raw && typeof raw === 'object') {
    return decodeFirmConfig({ ...(raw as Record<string, unknown>), firmId });
  }
  return decodeFirmConfig({ ...FIRM_CONFIG_DEFAULTS, firmId });
}

// The days-remaining figure a proposal cites; never negative in the string.
function daysBetween(a: number, b: number): number {
  return Math.round((a - b) / DAY_MS);
}

// The first firing trigger for a case, in priority order (rate-end before
// stall), or null when nothing is due. Deterministic — no model call here.
function evaluateTriggers(
  caseFacts: WatcherCaseFacts,
  now: number
): TriggerHit | null {
  const { fixedRateEndAt, lastActivityAt } = caseFacts;

  if (
    typeof fixedRateEndAt === 'number' &&
    fixedRateEndAt > now &&
    fixedRateEndAt - now <= RATE_END_LEAD_MS
  ) {
    const remaining = daysBetween(fixedRateEndAt, now);
    return {
      kind: 'retention-open',
      raisesG7: true,
      worklistKind: 'retention',
      title: 'Retention review due — fixed rate ending',
      detail: `The current deal ends in ${remaining} days; propose opening a retention/remortgage review.`,
      reason: {
        claim: 'Fixed-rate deal ends within the firm lead window.',
        working: [
          `fixedRateEndAt=${new Date(fixedRateEndAt).toISOString()}`,
          `lead window=${daysBetween(RATE_END_LEAD_MS, 0)}d`,
          `days remaining=${remaining}`,
        ],
        confidence: 0.8,
      },
    };
  }

  if (typeof lastActivityAt === 'number' && now - lastActivityAt >= STALL_MS) {
    const idle = daysBetween(now, lastActivityAt);
    return {
      kind: 'chase',
      raisesG7: false,
      worklistKind: 'doc',
      title: 'Stalled case — chase due',
      detail: `No movement for ${idle} days; propose a chase (respecting quiet hours).`,
      reason: {
        claim: 'Case has stalled past the firm chase cadence.',
        working: [
          `lastActivityAt=${new Date(lastActivityAt).toISOString()}`,
          `stall threshold=${daysBetween(STALL_MS, 0)}d`,
          `idle=${idle}d`,
        ],
        confidence: 0.7,
      },
    };
  }

  return null;
}

function decisionArtifactName(passId: string, caseId: string): string {
  return `lm/watcher/${passId}/${caseId}.json`;
}

// Pass-INDEPENDENT ids (finding 3): a re-proposal of the same (case, kind) mints
// the SAME worklist item + G7 mirror instance, so a worklist-upsert/gate-raise
// supersedes rather than duplicates. A process restart or a moved log head can
// therefore never spawn a second open item or a second card for one proposal.
function watcherWorklistItemId(
  caseId: string,
  kind: WatcherDecisionKind
): string {
  return `wl_watcher_${caseId}_${kind}`;
}

function watcherGateInstanceId(caseId: string): string {
  return `G7_${caseId}`;
}

async function writeDecision(
  edge: AgentEdge,
  coordinatorProjectId: string,
  pointer: CaseIndexPointer,
  passId: string,
  hit: TriggerHit,
  now: number
): Promise<void> {
  const worklistItemId = watcherWorklistItemId(pointer.caseId, hit.kind);

  // The dispatch-ready decision record. `directive` is deliberately UNSET:
  // M2 is propose-only; M3 populates it and a consumer runs it, no rewrite here.
  const payload: WatcherDecisionPayload = {
    passId,
    caseId: pointer.caseId,
    kind: hit.kind,
    reason: hit.reason,
    worklistItemId,
  };
  const decisionArtifact = await edge.uploadAttachment(coordinatorProjectId, {
    name: decisionArtifactName(passId, pointer.caseId),
    media_type: 'application/json',
    data_base64: encodeJsonAttachment({
      kind: 'lm.watcher.decision/1',
      firmId: pointer.firmId,
      at: now,
      versions: WATCHER_VERSIONS,
      payload,
    }),
  });

  // The proposal surfaces on the case log as an activity + an open worklist
  // item, so the fold renders it in the needs-you queue.
  const worklistItem: WorklistItem = {
    id: worklistItemId,
    caseId: pointer.caseId,
    kind: hit.worklistKind,
    title: hit.title,
    detail: hit.detail,
    status: 'open',
    createdAt: now,
    auto: true,
    reasonParams: { passId, decisionKind: hit.kind },
    schemaVersion: CRM_SCHEMA_VERSION,
  };
  // Deterministic activity id (finding 3): a re-proposal of the same (case,
  // kind) supersedes the prior activity rather than stacking a duplicate.
  const activity: ActivityEvent = {
    id: `act_watcher_${pointer.caseId}_${hit.kind}`,
    caseId: pointer.caseId,
    kind: 'ai-did',
    title: `Watcher proposal: ${hit.kind}`,
    detail: hit.reason.claim,
    when: now,
    actor: 'lm-watcher',
    schemaVersion: CRM_SCHEMA_VERSION,
  };

  // A regulatory-meaning transition is proposed behind G7. It is CHAIN-SOURCED:
  // the gate-raise entry travels the case log (exactly as onboarding raises G1),
  // so a wipe-then-refold reconstructs the Today-queue card byte-for-byte
  // (finding 2). A bare mirrorOpenGate would be a side-write the fold loses. The
  // mirror carries the proposal's worklist item id so the card can be resolved
  // by its OWN ids, never the G1 send path (finding 1). Propose-only: the raise
  // proposes the transition, it never resolves it.
  const gate: MirroredGate | null = hit.raisesG7
    ? {
        id: watcherGateInstanceId(pointer.caseId),
        gateId: 'G7',
        caseId: pointer.caseId,
        projectId: pointer.aionProjectId,
        approvalId: `appr_${watcherGateInstanceId(pointer.caseId)}`,
        title: gateById('G7').name,
        worklistItemId,
        reasons: [hit.reason.claim, ...hit.reason.working],
        raisedAt: now,
        status: 'open',
      }
    : null;

  const events: CaseLogEvent[] = [
    { type: 'activity', payload: { activity } },
    { type: 'worklist-upsert', payload: { item: worklistItem } },
    ...(gate
      ? [{ type: 'gate-raise', payload: { gate } } as CaseLogEvent]
      : []),
  ];
  await appendCaseLog(edge, pointer.aionProjectId, {
    caseId: pointer.caseId,
    firmId: pointer.firmId,
    actor: { kind: 'watcher', id: 'lm-watcher' },
    events,
    versions: WATCHER_VERSIONS,
    originArtifactId: decisionArtifact.artifact_id,
    runId: passId,
    at: now,
  });

  if (gate) getCrmEventLogStore().getState().mirrorOpenGate(gate);
}

/**
 * One watcher pass over a firm. Reads the firm index, fast-path skips the
 * unchanged, fires the fixed-rate-end and stalled-case triggers on the rest, and
 * writes propose-only decisions bounded by the per-case breaker and per-pass
 * budget. Resolves with the pass metrics (SC-002); throws nothing for a tripped
 * limit — that is reported, not raised. The optional second argument keeps the
 * signature assignable to the frozen `(firmId) => Promise<report>` contract.
 */
export async function runWatcherPass(
  firmId: string,
  options: RunWatcherPassOptions = {}
): Promise<WatcherPassReport> {
  const now = options.now ?? Date.now();
  const edge = await getAgentEdge();
  const cfg = options.firmConfig ?? (await loadFirmConfig(edge, firmId));
  const passId = options.passId ?? `pass_${firmId}_${now}`;
  const coordinatorProjectId = await firmCoordinatorProject(firmId);

  const breaker = firmBreaker(firmId, cfg.breaker.maxInvocationsPerCaseHour);
  const budget = new PassBudget(BigInt(cfg.budgets.watcherPassMicroGbp));
  const perCallGbp = usdMicroToGbpMicro(
    PROVIDER_CALL_MICRO_USD,
    cfg.fxUsdPerGbpMicro ?? FIRM_CONFIG_DEFAULTS.fxUsdPerGbpMicro!
  );

  const firmStore = getCrmFirmStore();
  const indexReadStats = { skipped: 0 };
  const pointers = await readFirmIndex(firmId, indexReadStats);

  let scanned = 0;
  let skipped = 0;
  let decided = 0;
  let breakerTrips = 0;
  let budgetRefusals = 0;
  let providerCalls = 0;

  for (const pointer of pointers) {
    scanned += 1;
    const key = lastSeenKey(firmId, pointer.caseId);
    const prev = firmStore.getState().getWatcherLastSeen(key);
    const headChanged = !prev || prev.headSeq !== pointer.logHeadSeq;

    const caseFacts = facts(
      await readNamedJson(
        edge,
        pointer.aionProjectId,
        caseFactsName(pointer.caseId)
      )
    );
    const hit = evaluateTriggers(caseFacts, now);

    // Fast-path skip: nothing due, OR the same proposal already stands and the
    // log head has not moved. Either way, no model tokens are spent.
    if (!hit || (!headChanged && prev?.proposedKind === hit.kind)) {
      skipped += 1;
      firmStore.getState().setWatcherLastSeen(key, {
        headSeq: pointer.logHeadSeq,
        proposedKind: prev?.proposedKind,
      });
      continue;
    }

    // A trigger is due. The breaker refuses a case touched too often this hour;
    // the budget stops the pass once its envelope is spent. Both are metrics.
    if (breaker.wouldTrip(pointer.caseId, now)) {
      breakerTrips += 1;
      firmStore.getState().setWatcherLastSeen(key, {
        headSeq: pointer.logHeadSeq,
        proposedKind: prev?.proposedKind,
      });
      continue;
    }
    if (!budget.tryDebit(perCallGbp)) {
      // Budget-starved, NOT a cheap fast-path skip: counted distinctly so a
      // supervisor can tell a healthy pass from one that ran out of envelope.
      budgetRefusals += 1;
      firmStore.getState().setWatcherLastSeen(key, {
        headSeq: pointer.logHeadSeq,
        proposedKind: prev?.proposedKind,
      });
      continue;
    }

    breaker.tryConsume(pointer.caseId, now);
    await writeDecision(edge, coordinatorProjectId, pointer, passId, hit, now);
    decided += 1;
    providerCalls += 1;
    firmStore.getState().setWatcherLastSeen(key, {
      headSeq: pointer.logHeadSeq,
      proposedKind: hit.kind,
    });
  }

  const spend: SpendRecord = buildSpendRecord({
    passId,
    runId: passId,
    costMicroUsd: PROVIDER_CALL_MICRO_USD * BigInt(providerCalls),
    providerCalls,
    fxUsdPerGbpMicro: cfg.fxUsdPerGbpMicro,
    fxEffectiveDate: cfg.fxEffectiveDate,
    at: now,
  });

  return {
    passId,
    scanned,
    skipped,
    decided,
    breakerTrips,
    spend,
    budgetRefusals,
    pointerSkips: indexReadStats.skipped,
  };
}

// A desktop-issued acknowledgement has no server run to point back to; a stable
// sentinel names the origin rather than an empty runId (contract requires it).
const WATCHER_ACK_RUN_ID = 'desktop:lm-watcher-ack';

export interface AcknowledgeWatcherProposalInput {
  caseId: string;
  firmId: string;
  projectId: string;
  worklistItemId: string;
  gateInstanceId: string;
  adviserId: string;
  note?: string;
  now?: number;
}

export interface AcknowledgeWatcherProposalResult {
  headSeq: string;
  decision: 'acknowledged';
}

/**
 * Adviser acknowledgement of a watcher G7 proposal. M2 is PROPOSE-ONLY: this is
 * NOT a send and NOT a stage transition (contrast the G1 onboarding send). It
 * resolves the proposal's OWN worklist item and closes the G7 mirror keyed by
 * the gate's OWN instance id — never G1's — writing a gate-resolve so a refold
 * reconstructs the closed card (findings 1 & 2). Nothing is dispatched.
 */
export async function acknowledgeWatcherProposal(
  input: AcknowledgeWatcherProposalInput
): Promise<AcknowledgeWatcherProposalResult> {
  const now = input.now ?? Date.now();
  const edge = await getAgentEdge();

  const activity: ActivityEvent = {
    id: `act_watcher_ack_${input.caseId}`,
    caseId: input.caseId,
    kind: 'note',
    title: 'Watcher proposal acknowledged',
    detail: input.note
      ? `Adviser acknowledged the watcher proposal: ${input.note}`
      : 'Adviser acknowledged the watcher proposal; propose-only, nothing was sent.',
    when: now,
    actor: input.adviserId,
    schemaVersion: CRM_SCHEMA_VERSION,
  };

  const events: CaseLogEvent[] = [
    { type: 'activity', payload: { activity } },
    {
      type: 'worklist-resolve',
      payload: {
        id: input.worklistItemId,
        resolvedBy: input.adviserId,
        resolution: {
          method: 'reviewed',
          detail: 'Watcher proposal acknowledged; propose-only, nothing sent.',
        },
      },
    },
    {
      type: 'gate-resolve',
      payload: { id: input.gateInstanceId, decision: 'acknowledged' },
    },
  ];

  const write = await appendCaseLog(edge, input.projectId, {
    caseId: input.caseId,
    firmId: input.firmId,
    actor: { kind: 'adviser', id: input.adviserId },
    events,
    versions: WATCHER_VERSIONS,
    originArtifactId: `watcher_ack_${input.caseId}`,
    runId: WATCHER_ACK_RUN_ID,
    at: now,
  });

  getCrmEventLogStore()
    .getState()
    .resolveMirroredGate(input.gateInstanceId, 'acknowledged', now);

  return { headSeq: write.headSeq, decision: 'acknowledged' };
}

/**
 * Ensure the firm's every-5-minutes watcher schedule exists on its coordinator
 * Project, exactly once. Idempotent: a schedule already firing the watcher task is
 * returned rather than duplicated (the create itself also carries an
 * Idempotency-Key at the transport). Returns the schedule id.
 */
export async function ensureWatcherSchedule(firmId: string): Promise<string> {
  const edge = await getAgentEdge();
  const projectId = await firmCoordinatorProject(firmId);

  const existing = await edge.listSchedules({ projectId });
  const found = existing.schedules?.find(
    (s) => s.project_id === projectId && s.task === WATCHER_TASK_TEXT
  );
  if (found) return found.schedule_id;

  const created = await edge.createSchedule({
    project_id: projectId,
    cron: WATCHER_CRON,
    task: WATCHER_TASK_TEXT,
    single_shot: false,
  });
  return created.schedule_id;
}
