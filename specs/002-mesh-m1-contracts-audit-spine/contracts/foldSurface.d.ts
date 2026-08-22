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

// Frozen M1 contract — the fold's public surface + M2 rendering contract (FR-015, SC-005).
import type { CaseId, CaseLogEntry, DecimalSeq } from './caseLog';

export type FoldReasonCode =
  | 'FOLD_GAP'
  | 'CHAIN_BREAK'
  | 'QUARANTINE_UNKNOWN_MAJOR'
  | 'OUTBOX_QUOTA'
  | 'DUPLICATE_SEQ'
  | 'ENTRY_TOO_LARGE';

export type SourceStatus = 'never' | 'live' | 'stale' | 'failed' | 'no-project';

export interface FoldReport {
  caseId: CaseId;
  applied: number;
  buffered: number;
  quarantined: number;
  halted: { reasonCode: FoldReasonCode; atSeq: DecimalSeq } | null;
}

// --- fold entry points ---
export declare function foldEntries(
  caseId: CaseId,
  entries: readonly CaseLogEntry[]
): Promise<FoldReport>;
export declare function refreshCaseLog(caseId: CaseId): Promise<FoldReport>;
export declare function attachCaseLogLiveSource(
  projectId: string,
  caseId: CaseId
): () => void; // returns detach

// --- M2 rendering contract (stable selectors; SC-005) ---
export declare function selectCaseWatermark(caseId: CaseId): DecimalSeq;
export declare function selectCaseFreshness(caseId: CaseId): {
  lastFoldedAt: number;
  sourceStatus: SourceStatus;
};
export declare function selectCaseChainStatus(
  caseId: CaseId
): 'verified' | 'broken' | 'unverified';
export declare function selectCaseHalt(
  caseId: CaseId
): { reasonCode: FoldReasonCode; atSeq: DecimalSeq } | null;
export declare function selectQuarantineCount(caseId?: CaseId): {
  retained: number;
  everCount: number;
};
export declare function selectUnsettledOutbox(caseId: CaseId): number;

// --- outbox ---
export interface LocalEventRefusal {
  ok: false;
  reason: 'quota' | 'halted-unsupported' | (string & {});
}
export declare function recordLocalEvent(
  candidate: Omit<CaseLogEntry, 'seq' | 'prevHash' | 'hash'>
): Promise<{ ok: true; outboxId: string } | LocalEventRefusal>;
export declare function flushOutbox(
  projectId: string
): Promise<{ flushed: number; remaining: number }>;
/** M1 outbox accepts last-writer-wins kinds only (T1). */
export declare const OUTBOX_LWW_KINDS: readonly [
  'field-change',
  'checklist-status',
  'worklist-resolve',
];
