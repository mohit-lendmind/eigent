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

// FR-007/08/09/10/14 — the artifact-canonical fold. It replays a content-hash
// case-log into the four domain stores DETERMINISTICALLY: every applied write
// derives its clock and ids from the entry itself (entry.at, entry-derived
// keys), never Date.now or a minted random id, and never round-trips through
// the side-bus. That is the whole trick behind convergence — a batch fold, an
// incremental fold, and a wipe-then-refold all land byte-for-byte identical.
//
// Loudness is the other half: nothing is dropped silently. An ahead-of-order
// entry buffers; a gap or a broken hash-link halts THAT case (and only that
// case) behind one deduplicated worklist item; an unknown event member is
// quarantined as a pointer record and the chain advances past it; a duplicate
// sequence is first-wins with a counter; an oversize entry is refused with a
// counter but still advances the chain (it is a real link).

import type {
  CaseId,
  CaseLogEntry,
  DecimalSeq,
} from '../agentContracts/caseLog';
import {
  encodeCaseLogEntry,
  isKnownCaseLogEventKind,
} from '../agentContracts/caseLog';
import type { FoldReasonCode } from '../agentContracts/reasonCodes';
import {
  foldWorklistItemId,
  formatFoldTitle,
} from '../agentContracts/reasonCodes';
import {
  categoryForApplicant,
  computeApplicantCompleteness,
  computeCaseCompleteness,
  computeSectionCompleteness,
  getCrmCasesStore,
} from '../casesStore';
import { getCrmClientsStore } from '../clientsStore';
import { getCrmDocumentsStore } from '../documentsStore';
import { requiredKeysForSection } from '../domain/factFindSchema';
import type {
  ActivityEvent,
  Applicant,
  Case,
  Client,
  ConflictRecord,
  CrmDocument,
  DocChecklistItem,
  FactFindField,
  FactFindSectionKey,
  FieldValue,
  Stage,
  StreamEntry,
  WorklistItem,
} from '../domain/types';
import { CRM_SCHEMA_VERSION } from '../domain/types';
import { computeEntryHash } from '../hashChain';
import { getCrmWorkstreamStore } from '../workstreamStore';
import type { CaseFoldPatch, QuarantineRecord } from './eventLogStore';
import {
  QUARANTINE_PREVIEW_MAX_BYTES,
  getCrmEventLogStore,
} from './eventLogStore';

// The contracts version this build folds at. A stored version below this
// triggers a one-time refold-from-zero per case (T4) so entries quarantined by
// an older build get a fresh classification.
export const CONTRACTS_VERSION = 1;

// A single entry above this encoded size is refused (ENTRY_TOO_LARGE) but still
// advances the chain — it is a genuine, hash-linked link, just too big to keep.
export const ENTRY_MAX_BYTES = 128 * 1024;

export interface FoldReport {
  caseId: CaseId;
  applied: number;
  buffered: number;
  quarantined: number;
  halted: { reasonCode: FoldReasonCode; atSeq: DecimalSeq } | null;
}

// ---- Per-case serialization ------------------------------------------------
// Every mutation for a case runs on that case's own promise chain, so a live
// notification that fires mid-refresh cannot interleave two drains and apply an
// entry twice (SC-001 race guard).
const caseQueues = new Map<CaseId, Promise<unknown>>();

function enqueue<T>(caseId: CaseId, task: () => Promise<T>): Promise<T> {
  const prior = caseQueues.get(caseId) ?? Promise.resolve();
  const run = prior.then(task, task);
  // Keep the chain alive but swallow rejections on the stored tail so one
  // failed drain does not poison the next.
  caseQueues.set(
    caseId,
    run.catch(() => undefined)
  );
  return run;
}

export function foldEntries(
  caseId: CaseId,
  entries: readonly CaseLogEntry[]
): Promise<FoldReport> {
  return enqueue(caseId, () => drain(caseId, entries));
}

// ---- The drain -------------------------------------------------------------

interface HaltInfo {
  reasonCode: FoldReasonCode;
  atSeq: DecimalSeq;
  at: number;
  expectedSeq?: DecimalSeq;
}

async function drain(
  caseId: CaseId,
  incoming: readonly CaseLogEntry[]
): Promise<FoldReport> {
  const eventLog = getCrmEventLogStore().getState();

  // T4: a build whose contracts version outruns the stored one refolds this
  // case from zero so its quarantined entries get re-evaluated.
  const refoldFromZero = eventLog.contractsVersion !== CONTRACTS_VERSION;

  const startWatermark = refoldFromZero
    ? 0n
    : BigInt(eventLog.watermarks[caseId] ?? '0');
  const startHead = refoldFromZero
    ? { seq: '0', hash: 'genesis' }
    : (eventLog.chainHeads[caseId] ?? { seq: '0', hash: 'genesis' });
  const priorPending = refoldFromZero
    ? []
    : (eventLog.pendingByCase[caseId] ?? []);
  const priorHalt = refoldFromZero
    ? null
    : (eventLog.haltedCases[caseId] ?? null);
  const priorAnomalies = eventLog.anomalies[caseId] ?? {
    duplicateSeq: 0,
    oversize: 0,
  };

  // Merge buffered + incoming into a by-seq map, first-wins. A second arrival
  // of a seq with a DIFFERENT hash is a DUPLICATE_SEQ anomaly (never applied).
  const bySeq = new Map<string, CaseLogEntry>();
  let duplicateSeq = 0;
  for (const e of [...priorPending, ...incoming]) {
    const seen = bySeq.get(e.seq);
    if (seen) {
      if (seen.hash !== e.hash) duplicateSeq += 1;
      continue; // first-wins
    }
    bySeq.set(e.seq, e);
  }

  const ordered = [...bySeq.values()].sort((a, b) => {
    const da = BigInt(a.seq);
    const db = BigInt(b.seq);
    return da < db ? -1 : da > db ? 1 : 0;
  });

  let expected = BigInt(startHead.seq) + 1n;
  let prevHash = startHead.hash;
  let headSeq = startHead.seq;
  let advancedAt = 0;
  let oversize = 0;

  const appliedEntries: CaseLogEntry[] = [];
  const quarantineAdditions: QuarantineRecord[] = [];
  let halt: HaltInfo | null = null;
  const pending: CaseLogEntry[] = [];

  for (const e of ordered) {
    const s = BigInt(e.seq);
    if (s <= startWatermark) continue; // replay — already applied
    if (s < expected) continue; // behind the tip (shouldn't happen)

    if (s > expected) {
      // A gap: this entry and everything after it must wait for the missing
      // seq. Halt the case behind one item until the gap is filled.
      pending.push(...ordered.filter((x) => BigInt(x.seq) >= expected));
      halt = {
        reasonCode: 'FOLD_GAP',
        atSeq: String(expected),
        expectedSeq: String(expected),
        at: e.at,
      };
      break;
    }

    // s === expected — verify BOTH the back-link and the content hash before
    // trusting the entry. A stale hash on tampered content breaks here exactly
    // at the tampered seq (tamper-evidence, SC-002); a bad prevHash breaks on a
    // spliced/reordered link.
    const recomputed = await computeEntryHash(e);
    if (e.prevHash !== prevHash || recomputed !== e.hash) {
      pending.push(...ordered.filter((x) => BigInt(x.seq) >= s));
      halt = { reasonCode: 'CHAIN_BREAK', atSeq: e.seq, at: e.at };
      break;
    }

    // The link is sound from here — the chain advances no matter what we do
    // with the payload, so record head/prevHash progress up front.
    if (encodeCaseLogEntry(e).length > ENTRY_MAX_BYTES) {
      oversize += 1;
    } else if (!isKnownCaseLogEventKind(e.event.type)) {
      quarantineAdditions.push(makeQuarantineRecord(caseId, e));
    } else {
      appliedEntries.push(e);
    }

    prevHash = e.hash;
    headSeq = e.seq;
    advancedAt = e.at;
    expected = s + 1n;
  }

  const newWatermark = headSeq;
  const advanced = BigInt(newWatermark) > startWatermark;

  // ---- Apply the domain writes (precompute, then one setState per store) ----
  applyDomainWrites(caseId, appliedEntries);

  // ---- Compose the single eventLog patch ------------------------------------
  const patch: CaseFoldPatch = { caseId };
  let touched = false;

  if (refoldFromZero) {
    patch.contractsVersion = CONTRACTS_VERSION;
    patch.clearCaseQuarantine = true;
    touched = true;
  }
  if (advanced) {
    patch.watermark = newWatermark;
    patch.chainHead = { seq: newWatermark, hash: prevHash };
    patch.freshness = {
      lastFoldedAt: advancedAt,
      sourceStatus: eventLog.freshness[caseId]?.sourceStatus ?? 'live',
    };
    touched = true;
  }
  // Pending is rewritten whenever it changes (a fill empties it; a gap sets it).
  if (pending.length !== priorPending.length || halt) {
    patch.pending = pending;
    touched = true;
  }
  if (quarantineAdditions.length) {
    patch.quarantineAdditions = quarantineAdditions;
    touched = true;
  }
  const nextAnomalies = {
    duplicateSeq: priorAnomalies.duplicateSeq + duplicateSeq,
    oversize: priorAnomalies.oversize + oversize,
  };
  if (
    nextAnomalies.duplicateSeq !== priorAnomalies.duplicateSeq ||
    nextAnomalies.oversize !== priorAnomalies.oversize
  ) {
    patch.anomalies = nextAnomalies;
    touched = true;
  }

  const haltState = halt
    ? { reasonCode: halt.reasonCode, atSeq: halt.atSeq }
    : null;
  const haltChanged =
    (priorHalt?.reasonCode ?? null) !== (haltState?.reasonCode ?? null) ||
    (priorHalt?.atSeq ?? null) !== (haltState?.atSeq ?? null);
  if (haltChanged) {
    patch.halted = haltState;
    touched = true;
  }

  if (touched) getCrmEventLogStore().getState().applyCaseFold(patch);

  // A newly-raised halt gets exactly one deduplicated worklist item.
  if (halt && haltChanged) raiseHaltItem(caseId, halt);

  return {
    caseId,
    applied: appliedEntries.length,
    buffered: pending.length,
    quarantined: quarantineAdditions.length,
    halted: haltState,
  };
}

// ---- Quarantine + halt authoring -------------------------------------------

function makeQuarantineRecord(
  caseId: CaseId,
  e: CaseLogEntry
): QuarantineRecord {
  const slash = e.event.type.lastIndexOf('/');
  const artifactVersion = slash >= 0 ? e.event.type.slice(slash + 1) : '0';
  const encoded = encodeCaseLogEntry(e);
  return {
    // Deterministic id — a random id would break batch≡incremental equality.
    id: `quarantine_${caseId}_${e.seq}`,
    caseId,
    artifactId: e.origin.artifactId,
    artifactVersion,
    contentHash: e.hash,
    reasonCode: 'QUARANTINE_UNKNOWN_MAJOR',
    kindSeen: e.event.type,
    preview: encoded.slice(0, QUARANTINE_PREVIEW_MAX_BYTES),
    at: e.at,
  };
}

function raiseHaltItem(caseId: CaseId, halt: HaltInfo): void {
  const params = {
    atSeq: halt.atSeq,
    ...(halt.expectedSeq ? { expectedSeq: halt.expectedSeq } : {}),
  };
  const item: WorklistItem = {
    id: foldWorklistItemId(caseId, halt.reasonCode, halt.atSeq),
    caseId,
    kind: 'approval',
    title: formatFoldTitle(halt.reasonCode, caseId, params),
    detail: formatFoldTitle(halt.reasonCode, caseId, params),
    status: 'open',
    createdAt: halt.at,
    reasonCode: halt.reasonCode,
    reasonParams: params,
    schemaVersion: CRM_SCHEMA_VERSION,
  };
  getCrmWorkstreamStore().getState().upsertWorklistItems([item]);
}

// ---- Deterministic domain reducer ------------------------------------------

function applyDomainWrites(
  caseId: CaseId,
  entries: readonly CaseLogEntry[]
): void {
  if (entries.length === 0) return;

  const casesStore = getCrmCasesStore().getState();
  const workstream = getCrmWorkstreamStore().getState();

  const workingCases: Record<CaseId, Case> = { ...casesStore.casesById };
  const touchedCases = new Set<CaseId>();
  const workingWorklist: Record<string, WorklistItem> = {
    ...workstream.worklistItems,
  };
  const touchedWorklist = new Set<string>();

  const clientsOut: Client[] = [];
  const documentsOut: CrmDocument[] = [];
  const checklistOut: DocChecklistItem[] = [];
  const conflictOut: ConflictRecord[] = [];
  const streamOut: StreamEntry[] = [];
  const activitiesOut: Array<{ caseId: CaseId; activity: ActivityEvent }> = [];

  for (const e of entries) {
    const p = e.event.payload;
    switch (e.event.type) {
      case 'case-upsert': {
        const incoming = p.case as Case;
        workingCases[incoming.id] = mergeCase(
          workingCases[incoming.id],
          incoming
        );
        touchedCases.add(incoming.id);
        break;
      }
      case 'client-upsert':
        clientsOut.push(p.client as Client);
        break;
      case 'document-upsert':
        documentsOut.push(p.document as CrmDocument);
        break;
      case 'checklist-status':
        checklistOut.push(p.item as DocChecklistItem);
        break;
      case 'conflict-upsert':
      case 'conflict-resolve':
        conflictOut.push(p.record as ConflictRecord);
        break;
      case 'stream-entry':
        streamOut.push(p.entry as StreamEntry);
        break;
      case 'activity':
        activitiesOut.push({
          caseId: e.caseId,
          activity: p.activity as ActivityEvent,
        });
        break;
      case 'worklist-upsert': {
        const item = p.item as WorklistItem;
        workingWorklist[item.id] = {
          ...item,
          schemaVersion: CRM_SCHEMA_VERSION,
        };
        touchedWorklist.add(item.id);
        break;
      }
      case 'worklist-resolve': {
        const id = p.id as string;
        const prev = workingWorklist[id];
        if (prev && prev.status !== 'resolved') {
          workingWorklist[id] = {
            ...prev,
            status: 'resolved',
            resolvedAt: e.at,
            resolvedBy: p.resolvedBy as string,
            resolution: p.resolution as WorklistItem['resolution'],
          };
          touchedWorklist.add(id);
        }
        break;
      }
      case 'field-change': {
        const c = workingCases[e.caseId];
        if (c) {
          workingCases[e.caseId] = applyFieldChange(c, p, e.at);
          touchedCases.add(e.caseId);
        }
        break;
      }
      case 'stage-transition': {
        const c = workingCases[e.caseId];
        if (c) {
          workingCases[e.caseId] = {
            ...c,
            stage: p.stage as Stage,
            updated: e.at,
          };
          touchedCases.add(e.caseId);
        }
        break;
      }
      case 'chain-anchor':
        // A writer-side re-base — no projection change.
        break;
      default:
        break;
    }
  }

  // One setState per touched store (activities append individually — the
  // workstream store has no batch-activity action, and each is deterministic).
  if (touchedCases.size) {
    getCrmCasesStore()
      .getState()
      .upsertCases([...touchedCases].map((id) => workingCases[id]));
  }
  if (clientsOut.length) {
    getCrmClientsStore().getState().upsertClients(clientsOut);
  }
  if (documentsOut.length) {
    getCrmDocumentsStore().getState().upsertDocuments(documentsOut);
  }
  if (checklistOut.length) {
    getCrmDocumentsStore().getState().upsertChecklistItems(checklistOut);
  }
  if (conflictOut.length) {
    getCrmCasesStore().getState().upsertConflictRecords(conflictOut);
  }
  if (touchedWorklist.size) {
    getCrmWorkstreamStore()
      .getState()
      .upsertWorklistItems(
        [...touchedWorklist].map((id) => workingWorklist[id])
      );
  }
  if (streamOut.length) {
    getCrmWorkstreamStore().getState().upsertStreamEntries(streamOut);
  }
  for (const a of activitiesOut) {
    getCrmWorkstreamStore().getState().noteActivity(a.caseId, a.activity);
  }
}

// A case-upsert overlays the incoming scalar fields but preserves accumulated
// applicant fact-find (built up by field-change entries) unless the incoming
// case carries its own profile for that applicant.
function mergeCase(existing: Case | undefined, incoming: Case): Case {
  if (!existing) return incoming;
  const applicants: Applicant[] = incoming.applicants.map((inA) => {
    const exA = existing.applicants.find((a) => a.clientId === inA.clientId);
    if (!exA) return inA;
    const incomingHasProfile = Object.keys(inA.profile).length > 0;
    return incomingHasProfile
      ? { ...exA, ...inA }
      : { ...inA, profile: exA.profile, completeness: exA.completeness };
  });
  return { ...existing, ...incoming, applicants };
}

interface FieldChangePayload {
  clientId: string;
  section: string;
  fieldKey: string;
  label?: string;
  value: FieldValue;
  src?: FactFindField['src'];
}

function applyFieldChange(
  c: Case,
  payloadRaw: Record<string, unknown>,
  at: number
): Case {
  const p = payloadRaw as unknown as FieldChangePayload;
  const applicants = c.applicants.map((a) =>
    a.clientId === p.clientId ? applyFieldToApplicant(a, p) : a
  );
  return {
    ...c,
    applicants,
    completeness: computeCaseCompleteness(applicants),
    updated: at,
  };
}

// Mirrors casesStore's private applyFieldUpdate, but pure and clock-free so a
// refold reproduces the field byte-for-byte.
function applyFieldToApplicant(a: Applicant, p: FieldChangePayload): Applicant {
  const section = p.section as FactFindSectionKey;
  const currentSection = a.profile[section];
  const nextFields: FactFindField[] = currentSection
    ? [...currentSection.fields]
    : [];
  const idx = nextFields.findIndex((f) => f.k === p.fieldKey);
  const prev = idx >= 0 ? nextFields[idx] : undefined;
  const next: FactFindField = {
    k: p.fieldKey,
    label: p.label ?? prev?.label ?? p.fieldKey,
    value: p.value,
    src: p.src ?? 'det',
    hint: prev?.hint,
    flag: prev?.flag,
    conflictId: prev?.conflictId,
    mono: prev?.mono,
    confirmedAt: prev?.confirmedAt,
    confirmedBy: prev?.confirmedBy,
    origin: prev?.origin,
  };
  if (idx >= 0) nextFields[idx] = next;
  else nextFields.push(next);
  const category = categoryForApplicant(a);
  const keys = requiredKeysForSection(category, section);
  const nextProfile: Applicant['profile'] = {
    ...a.profile,
    [section]: {
      fields: nextFields,
      completeness: computeSectionCompleteness(
        { fields: nextFields, completeness: 0 },
        keys
      ),
    },
  };
  const nextApplicant: Applicant = { ...a, profile: nextProfile };
  nextApplicant.completeness = computeApplicantCompleteness(nextApplicant);
  return nextApplicant;
}

// ---- M2 rendering selectors (FR-015, SC-005) -------------------------------

export function selectCaseWatermark(caseId: CaseId): DecimalSeq {
  return getCrmEventLogStore().getState().watermarks[caseId] ?? '0';
}

export function selectCaseFreshness(caseId: CaseId): {
  lastFoldedAt: number;
  sourceStatus: 'never' | 'live' | 'stale' | 'failed' | 'no-project';
} {
  return (
    getCrmEventLogStore().getState().freshness[caseId] ?? {
      lastFoldedAt: 0,
      sourceStatus: 'never',
    }
  );
}

export function selectCaseChainStatus(
  caseId: CaseId
): 'verified' | 'broken' | 'unverified' {
  const state = getCrmEventLogStore().getState();
  const halt = state.haltedCases[caseId];
  if (halt?.reasonCode === 'CHAIN_BREAK') return 'broken';
  if (halt?.reasonCode === 'FOLD_GAP') return 'unverified';
  if (
    !state.freshness[caseId] ||
    state.freshness[caseId].sourceStatus === 'never'
  ) {
    return 'unverified';
  }
  return 'verified';
}

export function selectCaseHalt(
  caseId: CaseId
): { reasonCode: FoldReasonCode; atSeq: DecimalSeq } | null {
  return getCrmEventLogStore().getState().haltedCases[caseId] ?? null;
}

export function selectQuarantineCount(caseId?: CaseId): {
  retained: number;
  everCount: number;
} {
  const state = getCrmEventLogStore().getState();
  const retained =
    caseId === undefined
      ? state.quarantine.length
      : state.quarantine.filter((r) => r.caseId === caseId).length;
  return { retained, everCount: state.quarantineEverCount };
}

export function selectUnsettledOutbox(caseId: CaseId): number {
  return getCrmEventLogStore()
    .getState()
    .outbox.filter((r) => r.caseId === caseId && r.state !== 'settled').length;
}
