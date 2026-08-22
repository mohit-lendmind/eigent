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

// Downstream stores register write-side callbacks here at import time so
// upstream stores (which cannot import them without breaking FR-014's
// one-directional rule) can dispatch synchronously.
//
// One-way flow: cases → workstream (audit events, activity, resolve worklist);
// cases → documents (flip insight conflict); clients → cases (read-side bus).
//
// Deterministic wiring: a dispatch to an unwired bus is loud, not silent.
// In dev/test it throws (surfaces the missing registration in tests). In prod
// it console.errors + queues so the dispatch replays once the bus registers.

import type { CaseLogEntry } from './agentContracts/caseLog';
import type {
  ActivityEvent,
  CaseId,
  DocumentId,
  FieldChangeEvent,
  StreamEntry,
  WorklistId,
  WorklistResolution,
} from './domain/types';

export interface WorkstreamSideBus {
  appendFieldChangeEvent: (
    event: Omit<FieldChangeEvent, 'id' | 'schemaVersion'>
  ) => void;
  noteActivity: (caseId: CaseId, activity: ActivityEvent) => void;
  pushStreamEntry: (
    caseId: CaseId,
    entry: Omit<StreamEntry, 'id' | 'schemaVersion' | 'caseId'> & {
      caseId?: CaseId;
    }
  ) => void;
  resolveWorklistItem: (
    id: WorklistId,
    opts: { resolution: WorklistResolution; resolvedBy: string }
  ) => WorklistItemResolveResult;
  findWorklistItemByConflict: (
    conflictId: string
  ) => { id: WorklistId; status: 'open' | 'resolved' } | null;
  // Read-side probes so upstream stores can check dispatch completion state
  // without statically importing the workstream store (FR-014 preservation).
  hasFieldChangeEventForConflict: (conflictId: string) => boolean;
  hasStreamEntryForConflict: (
    caseId: CaseId,
    title: string,
    linkedWorklistId?: WorklistId
  ) => boolean;
}

export interface DocumentsSideBus {
  // Match by exact insightLabel carried on the ConflictRecord value — label
  // substring matching flipped the wrong insight when two docs shared words.
  flipInsightConflict: (
    docId: DocumentId,
    insightLabel: string,
    conflict: boolean
  ) => void;
}

export type WorklistItemResolveResult =
  'resolved' | 'already-resolved' | 'unknown';

// A desktop-originated case write hands the fold-layer outbox a candidate entry
// (the entry minus its writer-assigned chain fields — the fold owns seq/hash).
// The store never imports the fold directly (FR-018 seam); it dispatches here.
export interface EventLogSideBus {
  enqueueOutbox: (
    candidate: Omit<CaseLogEntry, 'seq' | 'prevHash' | 'hash'>
  ) => void;
}

let workstreamBus: WorkstreamSideBus | null = null;
let documentsBus: DocumentsSideBus | null = null;
let eventLogBus: EventLogSideBus | null = null;

type QueuedCall = () => void;
const queuedWorkstream: QueuedCall[] = [];
const queuedDocuments: QueuedCall[] = [];
const queuedEventLog: QueuedCall[] = [];

function isDevLike(): boolean {
  try {
    const meta = import.meta as unknown as {
      env?: { DEV?: boolean; MODE?: string };
    };
    if (meta && meta.env) {
      if (meta.env.DEV === true) return true;
      if (meta.env.MODE === 'test') return true;
    }
  } catch {
    // ignore
  }
  if (typeof process !== 'undefined' && process.env) {
    if (
      process.env.NODE_ENV === 'test' ||
      process.env.NODE_ENV === 'development'
    ) {
      return true;
    }
  }
  return false;
}

export function assertBusWired(
  bus: unknown,
  name: 'workstream' | 'documents' | 'cases-read' | 'eventlog'
): asserts bus {
  if (bus) return;
  const msg = `[crm/_bus] ${name} bus not wired at dispatch time`;
  if (isDevLike()) throw new Error(msg);
  console.error(msg);
}

export function registerWorkstreamBus(bus: WorkstreamSideBus): void {
  workstreamBus = bus;
  const drain = queuedWorkstream.splice(0);
  for (const call of drain) call();
}

export function registerDocumentsBus(bus: DocumentsSideBus): void {
  documentsBus = bus;
  const drain = queuedDocuments.splice(0);
  for (const call of drain) call();
}

export function registerEventLogBus(bus: EventLogSideBus): void {
  eventLogBus = bus;
  const drain = queuedEventLog.splice(0);
  for (const call of drain) call();
}

export function getWorkstreamBus(): WorkstreamSideBus | null {
  return workstreamBus;
}

export function getDocumentsBus(): DocumentsSideBus | null {
  return documentsBus;
}

export function getEventLogBus(): EventLogSideBus | null {
  return eventLogBus;
}

// Dispatch helper: in prod, when a bus is not yet wired, queue the call and
// replay once registration happens. In dev/test, prefer to fail loudly via
// assertBusWired instead — the queue is a safety net, not the primary path.
export function dispatchWorkstream(
  call: (bus: WorkstreamSideBus) => void
): void {
  if (workstreamBus) {
    call(workstreamBus);
    return;
  }
  if (isDevLike()) {
    assertBusWired(workstreamBus, 'workstream');
    return;
  }
  console.error('[crm/_bus] workstream dispatch queued (bus not wired yet)');
  queuedWorkstream.push(() => {
    if (workstreamBus) call(workstreamBus);
  });
}

export function dispatchDocuments(call: (bus: DocumentsSideBus) => void): void {
  if (documentsBus) {
    call(documentsBus);
    return;
  }
  if (isDevLike()) {
    assertBusWired(documentsBus, 'documents');
    return;
  }
  console.error('[crm/_bus] documents dispatch queued (bus not wired yet)');
  queuedDocuments.push(() => {
    if (documentsBus) call(documentsBus);
  });
}

// FR-020: an unwired outbox bus must be loud — never a silent no-op. A dropped
// dispatch here is a lost adviser edit, so dev/test throws and prod queues.
export function dispatchEventLog(call: (bus: EventLogSideBus) => void): void {
  if (eventLogBus) {
    call(eventLogBus);
    return;
  }
  if (isDevLike()) {
    assertBusWired(eventLogBus, 'eventlog');
    return;
  }
  console.error('[crm/_bus] eventlog dispatch queued (bus not wired yet)');
  queuedEventLog.push(() => {
    if (eventLogBus) call(eventLogBus);
  });
}

// Hydration-barrier notifier: integrity.ts registers this at import time so
// the four store modules can signal completion without importing integrity
// (which would create a cycle — integrity reads all four stores).
export type HydrationSignal = (
  store: 'clients' | 'cases' | 'documents' | 'workstream'
) => void;

let hydrationSignal: HydrationSignal | null = null;
const seenSignals: Array<Parameters<HydrationSignal>[0]> = [];

export function registerHydrationSignal(signal: HydrationSignal): void {
  hydrationSignal = signal;
  // Replay every signal received before integrity registered so nothing is lost.
  for (const s of seenSignals) signal(s);
}

export function signalStoreHydrated(
  store: Parameters<HydrationSignal>[0]
): void {
  seenSignals.push(store);
  if (hydrationSignal) hydrationSignal(store);
}

// Cases-side reads exposed to clientsStore (removeClient guard, FR-016 note).
export interface CasesReadBus {
  caseIdsReferencingClient: (clientId: string) => string[];
}

let casesReadBus: CasesReadBus | null = null;

export function registerCasesReadBus(bus: CasesReadBus): void {
  casesReadBus = bus;
}

export function getCasesReadBus(): CasesReadBus | null {
  return casesReadBus;
}

// Test-only: reset all bus registrations. NOT exported from the barrel.
export function _resetBusesForTests(): void {
  workstreamBus = null;
  documentsBus = null;
  eventLogBus = null;
  casesReadBus = null;
  hydrationSignal = null;
  queuedWorkstream.length = 0;
  queuedDocuments.length = 0;
  queuedEventLog.length = 0;
  seenSignals.length = 0;
}
