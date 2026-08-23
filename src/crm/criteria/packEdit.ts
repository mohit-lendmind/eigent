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

// M5 (FR-014) — pack authorship, minimal + gated. A criteria pack is adviser-
// curated (NOT a licensed DB), so who changed which rule, and when, is itself an
// audit fact. Pack edits are recorded as an append-only, ordered log; folding the
// log yields the CURRENT authorship of each rule (the last editor wins, but every
// prior edit stays in the log). The reducer is pure + deterministic: the same log
// always folds to the same authorship map, so a wipe-then-refold reproduces it.

import type { RuleKey } from '../agentContracts/criteriaAffordability';

/** One gated pack edit — who changed which rule on which lender, and when. */
export interface PackEditRecord {
  kind: 'lm.criteria.packedit/1';
  packRef: string;
  lenderId: string;
  ruleKey: RuleKey;
  editedBy: string;
  at: number;
  /** The field the adviser changed, for the audit line. */
  field: 'value' | 'citedText' | 'asAt';
  before: string;
  after: string;
}

/** The current authorship of a single rule, after folding the edit log. */
export interface RuleAuthorship {
  lenderId: string;
  ruleKey: RuleKey;
  editedBy: string;
  at: number;
  editCount: number;
}

export interface RecordPackEditInput {
  packRef: string;
  lenderId: string;
  ruleKey: RuleKey;
  editedBy: string;
  field: PackEditRecord['field'];
  before: string;
  after: string;
  at: number;
}

/**
 * Append a gated pack edit to the log (FR-014). The edit is refused unless it
 * names an author and actually changes the value — an empty author or a no-op
 * (before === after) is not a recordable authorship event.
 */
export function recordPackEdit(
  log: readonly PackEditRecord[],
  input: RecordPackEditInput
):
  | { ok: true; log: PackEditRecord[]; record: PackEditRecord }
  | { ok: false; reason: 'author-required' | 'no-change' } {
  if (input.editedBy.trim().length === 0) {
    return { ok: false, reason: 'author-required' };
  }
  if (input.before === input.after) {
    return { ok: false, reason: 'no-change' };
  }
  const record: PackEditRecord = {
    kind: 'lm.criteria.packedit/1',
    packRef: input.packRef,
    lenderId: input.lenderId,
    ruleKey: input.ruleKey,
    editedBy: input.editedBy.trim(),
    at: input.at,
    field: input.field,
    before: input.before,
    after: input.after,
  };
  return { ok: true, log: [...log, record], record };
}

function ruleId(lenderId: string, ruleKey: RuleKey): string {
  return `${lenderId} ${ruleKey}`;
}

/**
 * Fold the edit log into the current authorship of each rule (FR-014). Ordered
 * by the log's own order (append order), so the last edit to a rule wins; the
 * count preserves how many times the rule was touched. Pure + deterministic.
 */
export function foldPackEdits(
  log: readonly PackEditRecord[]
): Record<string, RuleAuthorship> {
  const out: Record<string, RuleAuthorship> = {};
  for (const e of log) {
    const id = ruleId(e.lenderId, e.ruleKey);
    const prior = out[id];
    out[id] = {
      lenderId: e.lenderId,
      ruleKey: e.ruleKey,
      editedBy: e.editedBy,
      at: e.at,
      editCount: (prior?.editCount ?? 0) + 1,
    };
  }
  return out;
}
