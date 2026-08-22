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

// FR-017/18/19 — the desktop write half of the two-writer world. An adviser
// edit applies to the F01 store instantly (that path is untouched) and, in the
// same beat, enqueues an outbox record here so the write is durably queued for
// the canonical log. The record survives restart and an environment-key wipe
// (it is SOURCE, see eventLogStore). A flush ships each queued record up the
// attachments plane (content-addressed, no idempotency key by contract), and
// the canonical echo — when it folds back — settles the record exactly once,
// matched by the pinned settle hash over the entry minus its writer fields.
//
// M1 accepts last-writer-wins kinds only (T1): a field edit, a checklist status
// flip, a worklist resolve. Their echoes are harmless out of position by
// construction. Should a non-LWW kind ever be detected settling out of position
// (defense in depth), that case arms a one-time refold-from-zero.

import { registerEventLogBus } from '../_bus';
import type { CaseLogEntry } from '../agentContracts/caseLog';
import {
  foldWorklistItemId,
  formatFoldTitle,
} from '../agentContracts/reasonCodes';
import type { WorklistItem } from '../domain/types';
import { CRM_SCHEMA_VERSION } from '../domain/types';
import { settleHashOf } from '../hashChain';
import { getCrmWorkstreamStore } from '../workstreamStore';
import type { OutboxRecord } from './eventLogStore';
import { getCrmEventLogStore } from './eventLogStore';

// The candidate the store hands over: a full case-log entry minus the three
// writer-assigned chain fields (the canonical writer owns seq/prevHash/hash).
export type LocalEventCandidate = Omit<
  CaseLogEntry,
  'seq' | 'prevHash' | 'hash'
>;

// M1 outbox accepts last-writer-wins kinds only (T1). A frozen tuple — the
// contract (foldSurface.d.ts) pins this exact order.
export const OUTBOX_LWW_KINDS = [
  'field-change',
  'checklist-status',
  'worklist-resolve',
] as const;

// The unsettled-record ceiling. An edit that would overflow it is refused
// synchronously (never silently dropped) and raises one OUTBOX_QUOTA item.
export const OUTBOX_MAX_UNSETTLED = 500;

const lwwKinds = new Set<string>(OUTBOX_LWW_KINDS);

export interface LocalEventRefusal {
  ok: false;
  reason: 'quota' | 'halted-unsupported' | (string & {});
}

// The flush transport, injected so tests can mock it and prod can wire the aion
// attachments plane (uploadAttachment: CAS dedupe, no idempotency key). A
// retryable failure leaves the record queued for the next flush.
export type OutboxCarrier = (
  projectId: string,
  record: OutboxRecord
) => Promise<
  { ok: true; artifactId: string } | { ok: false; retryable: boolean }
>;

let carrier: OutboxCarrier | null = null;

export function configureOutboxCarrier(next: OutboxCarrier | null): void {
  carrier = next;
}

function outboxIdFor(caseId: string, settleHash: string): string {
  return `outbox_${caseId}_${settleHash.slice(0, 16)}`;
}

function raiseQuotaItem(caseId: string, depth: number): void {
  const params = { depth };
  const item: WorklistItem = {
    id: foldWorklistItemId(caseId, 'OUTBOX_QUOTA'),
    caseId,
    kind: 'approval',
    title: formatFoldTitle('OUTBOX_QUOTA', caseId, params),
    detail: formatFoldTitle('OUTBOX_QUOTA', caseId, params),
    status: 'open',
    createdAt: Date.now(),
    reasonCode: 'OUTBOX_QUOTA',
    reasonParams: params,
    schemaVersion: CRM_SCHEMA_VERSION,
  };
  getCrmWorkstreamStore().getState().upsertWorklistItems([item]);
}

// Enqueue a desktop write. The LWW and quota gates run BEFORE any await so the
// refusal is synchronous by construction — no partial work escapes a refusal.
export async function recordLocalEvent(
  candidate: LocalEventCandidate
): Promise<{ ok: true; outboxId: string } | LocalEventRefusal> {
  // Omit over CaseLogEntry's index signature erases its field types; read the
  // candidate through a typed view for the fields we branch on.
  const view = candidate as unknown as CaseLogEntry;

  if (!lwwKinds.has(view.event.type)) {
    return { ok: false, reason: 'halted-unsupported' };
  }

  const store = getCrmEventLogStore();
  const unsettled = store
    .getState()
    .outbox.filter((r) => r.state !== 'settled');
  if (unsettled.length >= OUTBOX_MAX_UNSETTLED) {
    raiseQuotaItem(view.caseId, unsettled.length);
    return { ok: false, reason: 'quota' };
  }

  const settleHash = await settleHashOf(candidate);
  const id = outboxIdFor(view.caseId, settleHash);

  // Content-addressed dedup: an identical unsettled candidate already queued is
  // the same write — do not double-enqueue.
  const already = store
    .getState()
    .outbox.find((r) => r.id === id && r.state !== 'settled');
  if (already) return { ok: true, outboxId: id };

  store.getState().enqueueOutbox({
    id,
    caseId: view.caseId,
    entryCandidate: candidate,
    settleHash,
    state: 'queued',
    queuedAt: view.at,
  });
  return { ok: true, outboxId: id };
}

// Serialized drain: ship each queued record, mark it flushed on success, and
// leave a retryable failure queued for the next flush.
export async function flushOutbox(
  projectId: string
): Promise<{ flushed: number; remaining: number }> {
  const store = getCrmEventLogStore();
  const queued = store.getState().outbox.filter((r) => r.state === 'queued');
  let flushed = 0;

  for (const record of queued) {
    if (!carrier) {
      console.error(
        '[crm/outbox] no flush carrier configured — leaving record queued'
      );
      break;
    }
    const result = await carrier(projectId, record);
    if (result.ok) {
      store
        .getState()
        .updateOutbox(record.id, { state: 'flushed', flushedAt: Date.now() });
      flushed += 1;
    }
    // A retryable/non-retryable failure leaves the record queued (never a
    // silent drop). Retryable ones drain on the next flush.
  }

  const remaining = store
    .getState()
    .outbox.filter((r) => r.state !== 'settled').length;
  return { flushed, remaining };
}

// Settle-by-hash, called by the fold for each entry that advanced the chain.
// Exactly once: a record already settled is a referential no-op. If a non-LWW
// kind is settled out of position, arm a one-time refold-from-zero for the case
// (T1 backstop) — done by dropping the stored contracts version so the next
// fold re-evaluates from zero.
export async function settleOutboxForEntries(
  caseId: string,
  entries: readonly CaseLogEntry[]
): Promise<void> {
  const store = getCrmEventLogStore();
  const unsettled = store
    .getState()
    .outbox.filter((r) => r.caseId === caseId && r.state !== 'settled');
  if (unsettled.length === 0 || entries.length === 0) return;

  let armBackstop = false;
  for (const entry of entries) {
    const settleHash = await settleHashOf(entry);
    const match = unsettled.find(
      (r) => r.settleHash === settleHash && r.state !== 'settled'
    );
    if (!match) continue;

    // Re-read: another entry in this same pass may have settled it already.
    const current = store.getState().outbox.find((r) => r.id === match.id);
    if (!current || current.state === 'settled') continue;

    store.getState().updateOutbox(match.id, {
      state: 'settled',
      settledAt: entry.at,
    });
    match.state = 'settled';

    const candidateView = match.entryCandidate as unknown as CaseLogEntry;
    if (!lwwKinds.has(candidateView.event.type)) armBackstop = true;
  }

  if (armBackstop) {
    // Force the NEXT fold of any case through refold-from-zero exactly once;
    // the fold restores the current version when it completes.
    store.getState().setContractsVersion(0);
  }
}

// Wire the store-facing bus at import time: a desktop write dispatches here and
// we fire the enqueue. Fire-and-forget — the LWW/quota gates run synchronously
// inside recordLocalEvent, and a refusal has already raised its own item.
registerEventLogBus({
  enqueueOutbox: (candidate) => {
    void recordLocalEvent(candidate);
  },
});
