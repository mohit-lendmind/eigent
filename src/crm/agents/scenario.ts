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

// M5 (FR-010) — the A6 scenario agent. Two seams, mirroring A4 sourcing:
//
//   • DISPATCH (declarative): an adviser triggers a scenario run on a
//     G9-verified case; the agent publishes a directive (issuedBy the adviser)
//     and resolves on admission. The compute itself is PURE and local — there is
//     no browser and no model in this path.
//
//   • RECORD (compute + write): the agent runs the base scenario plus N pure
//     counterfactuals, routes every criteria + affordability payload through
//     assertIndicative (THE choke-point), and writes an lm.scenario.run/1 with a
//     SMALL folded summary (pass counts + top max-borrow) while the full working
//     for every scenario rides as a REFERENCED attachment, never inline.
//
// The honesty spine is enforced BEFORE anything is written: the scenario count is
// capped at the firm's scenarioCap, the case must be G9-verified (affordability
// cannot run on unverified income), and any refusal from the choke-point aborts
// the whole run — the agent never writes a partial or downgraded payload.

import type {
  AgentId,
  DirectiveEnvelope,
  VersionStamp,
} from '../agentContracts';
import type { CaseLogEvent } from '../agentContracts/caseLog';
import type {
  ScenarioDelta,
  ScenarioResult,
  ScenarioRunPayload,
} from '../agentContracts/criteriaAffordability';
import {
  CRITERIA_SURFACE_CLASS,
  SCENARIO_CAP_DEFAULT,
  decodeScenarioRunPayload,
} from '../agentContracts/criteriaAffordability';
import { assertIndicative } from '../criteria/assertIndicative';
import {
  applyDelta,
  buildBaseScenario,
  diffScenarios,
  type ScenarioBasis,
} from '../criteria/counterfactual';
import { appendCaseLog } from './caseLogWrite';
import { ensureCaseProject } from './caseProject';
import { encodeJsonAttachment } from './codec';
import { dispatchDirective } from './dispatch';
import { getAgentEdge } from './edge';
import {
  assessIncomeGate,
  describeIncomeBlocker,
  type IncomeFactState,
  type IncomeGateBlocker,
} from './incomeGate';
import type { DispatchResult } from './types';

export const SCENARIO_AGENT: AgentId = 'lm-scenario';

const SCENARIO_VERSIONS: VersionStamp = {
  model: 'lm-scenario',
  promptSha: 'lm-scenario',
  skillSemver: '1.0.0',
  skillSha: 'lm-scenario-m5',
};

// A counterfactual run is pure local compute; the pump budget is nominal.
const SCENARIO_BUDGET_MICRO_GBP = 10_000;
const DESKTOP_RUN_ID = 'desktop:lm-scenario';

function workingAttachmentName(caseId: string): string {
  return `lm/scenario/${caseId}/working.json`;
}

export interface DispatchScenarioInput {
  caseId: string;
  firmId: string;
  /** The adviser the run acts as — stamped on issuedBy so it is attributable. */
  adviserId: string;
  /** How many counterfactuals the adviser asked for (base is always included). */
  deltaCount: number;
  traceId?: string;
}

/**
 * Build the declarative directive that triggers a scenario run (FR-010). The run
 * is pure local compute, so the directive carries no plan — just the adviser,
 * the case, and the requested counterfactual count. issuedBy is the adviser.
 */
export function buildScenarioDirective(
  input: DispatchScenarioInput
): DirectiveEnvelope {
  return {
    kind: 'lm.directive/1',
    agent: SCENARIO_AGENT,
    caseId: input.caseId,
    firmId: input.firmId,
    directive: `Run an indicative base + ${input.deltaCount} counterfactual scenario(s) for case ${input.caseId} (adviser-only).`,
    inputs: { artifacts: [] },
    constraints: { deltaCount: input.deltaCount },
    issuedBy: { kind: 'adviser', id: input.adviserId },
    gatePolicy: 'scenario-run',
    traceId: input.traceId ?? `scenario_${input.caseId}`,
    attemptNonce: `${input.caseId}:scenario`,
    versions: SCENARIO_VERSIONS,
    budgetMicroGbp: SCENARIO_BUDGET_MICRO_GBP,
  };
}

/** Fire the scenario run (fire-and-forget; the compute happens in recordScenarioRun). */
export function dispatchScenarioRun(
  input: DispatchScenarioInput
): Promise<DispatchResult> {
  return dispatchDirective(buildScenarioDirective(input));
}

export interface RecordScenarioInput {
  firmId: string;
  adviserId: string;
  /** The pinned pack + facts + panel + affordability inputs the base runs on. */
  basis: ScenarioBasis;
  /** The counterfactuals to fold over the base. Empty = base-only. */
  deltas: readonly ScenarioDelta[];
  /** The firm's scenario ceiling; scenarioCount (1 + deltas) must not exceed it. */
  scenarioCap?: number;
  /** G9 precondition — affordability cannot run on unverified income. */
  income: {
    applicants: readonly string[];
    facts: readonly IncomeFactState[];
    requiredFieldKeys?: readonly string[];
  };
  now?: number;
}

export type RecordScenarioResult =
  | {
      ok: true;
      payload: ScenarioRunPayload;
      runArtifactId: string;
      workingArtifactId: string;
      headSeq: string;
    }
  | { ok: false; reason: 'cap-exceeded'; scenarioCount: number; cap: number }
  | {
      ok: false;
      reason: 'g9-unverified';
      blocking: IncomeGateBlocker[];
      blockingSteps: string[];
    }
  | { ok: false; reason: 'choke-point'; detail: string };

/**
 * Run base + N counterfactuals and write the scenario run (FR-010). The cap and
 * the G9 precondition are enforced BEFORE any compute or write, so an oversized
 * or unverified request never mints an artifact. Every payload is routed through
 * assertIndicative; a refusal aborts the whole run. The folded summary is small
 * (pass counts + top max-borrow) and the full working rides as an attachment.
 */
export async function recordScenarioRun(
  input: RecordScenarioInput
): Promise<RecordScenarioResult> {
  const cap = input.scenarioCap ?? SCENARIO_CAP_DEFAULT;
  const scenarioCount = 1 + input.deltas.length;

  // Cap FIRST — an oversized request must never reach the compute or the write.
  if (scenarioCount > cap) {
    return { ok: false, reason: 'cap-exceeded', scenarioCount, cap };
  }

  // G9 — affordability cannot run on unverified income (block before write).
  const gate = assessIncomeGate(
    input.income.applicants,
    input.income.facts,
    input.income.requiredFieldKeys
  );
  if (!gate.satisfied) {
    return {
      ok: false,
      reason: 'g9-unverified',
      blocking: gate.blocking,
      blockingSteps: gate.blocking.map(describeIncomeBlocker),
    };
  }

  const caseId = input.basis.caseId;
  const base = buildBaseScenario(input.basis);
  const scenarios: ScenarioResult[] = [base];
  for (const delta of input.deltas) {
    scenarios.push(applyDelta(base, delta));
  }

  // Route every payload through THE choke-point. Any refusal aborts the run.
  for (const s of scenarios) {
    const c = assertIndicative(s.criteria, { surface: 'adviser' });
    if (!c.ok) return { ok: false, reason: 'choke-point', detail: c.reason };
    const a = assertIndicative(s.affordability, {
      surface: 'adviser',
      g9Verified: true,
    });
    if (!a.ok) return { ok: false, reason: 'choke-point', detail: a.reason };
  }

  const passCountByScenario = scenarios.map(
    (s) => s.criteria.results.filter((r) => r.verdict === 'pass').length
  );
  const topMaxBorrowPence = scenarios.reduce(
    (top, s) => Math.max(top, s.affordability.results.maxBorrowPence),
    0
  );

  const now = input.now ?? Date.now();
  const edge = await getAgentEdge();
  const projectId = await ensureCaseProject(caseId);

  // The full working for every scenario (plus its diff vs the base) rides as an
  // attachment — never inline, so the fold's oversize ceiling is never hit.
  const workingArtifact = await edge.uploadAttachment(projectId, {
    name: workingAttachmentName(caseId),
    media_type: 'application/json',
    data_base64: encodeJsonAttachment({
      kind: 'lm.scenario.working/1',
      caseId,
      scenarios: scenarios.map((s, i) => ({
        scenarioId: s.scenarioId,
        delta: s.delta,
        criteria: s.criteria,
        affordability: s.affordability,
        diffVsBase: i === 0 ? null : diffScenarios(base, s),
      })),
    }),
  });

  const payload: ScenarioRunPayload = {
    kind: 'lm.scenario.run/1',
    caseId,
    adviserId: input.adviserId,
    baseRef: input.basis.pack.packRef,
    scenarioCount,
    surfaceClass: CRITERIA_SURFACE_CLASS,
    workingAttachmentId: workingArtifact.artifact_id,
    summary: { passCountByScenario, topMaxBorrowPence },
  };

  // Decode our own output against the cap before it ever folds — a bad summary
  // or an over-cap count is a hard stop here, not a silent bad artifact.
  decodeScenarioRunPayload(payload, cap);

  const runArtifact = await edge.uploadAttachment(projectId, {
    name: `lm/scenario/${caseId}/run.json`,
    media_type: 'application/json',
    data_base64: encodeJsonAttachment({
      kind: 'lm.scenario.run/1',
      caseId,
      payload,
    }),
  });

  const events: CaseLogEvent[] = [
    {
      type: 'scenario-run',
      payload: {
        scenarioRun: payload,
        scenarioRunArtifactId: runArtifact.artifact_id,
      },
    },
  ];

  const write = await appendCaseLog(edge, projectId, {
    caseId,
    firmId: input.firmId,
    actor: { kind: 'agent', id: input.adviserId },
    events,
    versions: SCENARIO_VERSIONS,
    originArtifactId: runArtifact.artifact_id,
    runId: DESKTOP_RUN_ID,
    at: now,
  });

  return {
    ok: true,
    payload,
    runArtifactId: runArtifact.artifact_id,
    workingArtifactId: workingArtifact.artifact_id,
    headSeq: write.headSeq,
  };
}
