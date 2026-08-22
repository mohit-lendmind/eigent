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

// The loudness grammar (T5, FR-014): a fixed reason-code table + a MONO title
// formatter. Titles are structured `[CODE] <caseId> <param>` strings, NOT i18n
// keys and NOT free prose — the fold must be observable without freezing copy
// at the wrong layer or tripping the i18n gate. Worklist item ids are stable
// (caseId + code + seq) so repeated folds upsert one item instead of spamming.

export type FoldReasonCode =
  | 'FOLD_GAP'
  | 'CHAIN_BREAK'
  | 'QUARANTINE_UNKNOWN_MAJOR'
  | 'OUTBOX_QUOTA'
  | 'DUPLICATE_SEQ'
  | 'ENTRY_TOO_LARGE';

export const FOLD_REASON_CODES: readonly FoldReasonCode[] = [
  'FOLD_GAP',
  'CHAIN_BREAK',
  'QUARANTINE_UNKNOWN_MAJOR',
  'OUTBOX_QUOTA',
  'DUPLICATE_SEQ',
  'ENTRY_TOO_LARGE',
];

export interface ReasonParams {
  atSeq?: string;
  expectedSeq?: string;
  kindSeen?: string;
  contentHash?: string;
  bytes?: number;
  depth?: number;
}

// The single trailing param each code carries into its mono title.
function primaryParam(code: FoldReasonCode, params: ReasonParams): string {
  switch (code) {
    case 'FOLD_GAP':
      return params.expectedSeq ?? params.atSeq ?? '-';
    case 'CHAIN_BREAK':
    case 'DUPLICATE_SEQ':
      return params.atSeq ?? '-';
    case 'QUARANTINE_UNKNOWN_MAJOR':
      return params.kindSeen ?? '-';
    case 'ENTRY_TOO_LARGE':
      return params.bytes !== undefined ? String(params.bytes) : '-';
    case 'OUTBOX_QUOTA':
      return params.depth !== undefined ? String(params.depth) : '-';
  }
}

/** Mono, i18n-free worklist title: `[CODE] <caseId> <param>`. */
export function formatFoldTitle(
  code: FoldReasonCode,
  caseId: string,
  params: ReasonParams = {}
): string {
  return `[${code}] ${caseId} ${primaryParam(code, params)}`;
}

/** Stable worklist id → upsert dedup across refolds (`-` when seq is absent). */
export function foldWorklistItemId(
  caseId: string,
  code: FoldReasonCode,
  seq?: string
): string {
  return `wl_fold_${caseId}_${code}_${seq ?? '-'}`;
}
