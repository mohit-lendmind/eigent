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

// Frozen M1 contract — CaseLogEntry (lm.caselog/1), the unit of audit. See data-model.md.
export type CaseId = string;
export type DecimalSeq = string; // 64-bit-safe decimal string; compare via BigInt

export type CaseLogActorKind =
  'adviser' | 'agent' | 'watcher' | 'schedule' | 'system' | (string & {});

export type CaseLogEventKind =
  | 'field-change'
  | 'activity'
  | 'stream-entry'
  | 'worklist-upsert'
  | 'worklist-resolve'
  | 'conflict-upsert'
  | 'conflict-resolve'
  | 'checklist-status'
  | 'stage-transition'
  | 'case-upsert'
  | 'client-upsert'
  | 'document-upsert'
  | 'chain-anchor' // reserved (T3): writer-side chain re-base; fold applies as no-op re-base
  | (string & {}); // unknown members quarantine, never throw

export interface CaseLogEvent extends Record<string, unknown> {
  type: CaseLogEventKind;
  payload: Record<string, unknown>;
}

export interface CaseLogEntry extends Record<string, unknown> {
  kind: 'lm.caselog/1';
  caseId: CaseId;
  firmId: string;
  seq: DecimalSeq; // per-case monotonic, writer-assigned
  at: number; // EpochMs
  actor: { kind: CaseLogActorKind; id: string };
  event: CaseLogEvent;
  origin: { artifactId: string; runId: string };
  versions: {
    model: string;
    promptSha: string;
    skillSemver: string;
    skillSha: string;
  };
  prevHash: string; // predecessor's hash; 'genesis' at seq "1"
  hash: string; // sha256HexCanonical(entry - {hash})
}

export declare function decodeCaseLogEntry(value: unknown): CaseLogEntry;
export declare function encodeCaseLogEntry(entry: CaseLogEntry): string;
/** Hash over entry MINUS writer-assigned fields {seq, prevHash, hash} — reproducible pre-sequencing (FR-017). */
export declare function settleHashOf(
  entry: Omit<CaseLogEntry, 'seq' | 'prevHash' | 'hash'>
): Promise<string>;
export declare function verifyChain(
  entries: readonly CaseLogEntry[]
): Promise<{ ok: true } | { ok: false; brokenAtSeq: DecimalSeq }>;
