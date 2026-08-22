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

// FR-008 — the income gate (G9). A recommendation (G5) cannot proceed until each
// applicant's income is DETERMINISTICALLY verified. This is the whole reason the
// det/syn spine exists: a `syn` income fact — vision-only, or a quote that did
// not match the text layer — NEVER satisfies G9 (MCOB 11.6.8R affordability
// evidence). The check is coded here, never an LLM judgement, and surfaces the
// exact applicant + field that is blocking so the UI can say why (US3).

import type { Src } from '../domain/types';

// The income field(s) each applicant must have det-verified before a
// recommendation. Basic income is the floor; a firm policy can widen this.
export const DEFAULT_REQUIRED_INCOME_FIELDS = ['basicIncome'] as const;

/** One income fact on file, with the trust marker the write path recorded. */
export interface IncomeFactState {
  clientId: string;
  fieldKey: string;
  src: Src;
}

export interface IncomeGateBlocker {
  clientId: string;
  fieldKey: string;
  /** Why it blocks: the field is absent, or present only as unverified `syn`. */
  reason: 'missing' | 'syn-only';
}

export interface IncomeGateResult {
  /** True only when every required income field is `det` for every applicant. */
  satisfied: boolean;
  blocking: IncomeGateBlocker[];
}

/**
 * Assess G9 deterministically. For each applicant and each required income
 * field, the gate is satisfied only when a `det` fact exists for it. A `syn`
 * fact is recorded as a `syn-only` blocker (it must not round up to satisfied);
 * an absent fact is a `missing` blocker. Pure — the same inputs always yield the
 * same verdict, so it can gate a recommendation without any model call.
 */
export function assessIncomeGate(
  applicants: readonly string[],
  facts: readonly IncomeFactState[],
  requiredFieldKeys: readonly string[] = DEFAULT_REQUIRED_INCOME_FIELDS
): IncomeGateResult {
  const blocking: IncomeGateBlocker[] = [];

  for (const clientId of applicants) {
    for (const fieldKey of requiredFieldKeys) {
      const forField = facts.filter(
        (f) => f.clientId === clientId && f.fieldKey === fieldKey
      );
      if (forField.length === 0) {
        blocking.push({ clientId, fieldKey, reason: 'missing' });
        continue;
      }
      // A single det fact verifies the field; otherwise it is syn-only.
      if (!forField.some((f) => f.src === 'det')) {
        blocking.push({ clientId, fieldKey, reason: 'syn-only' });
      }
    }
  }

  return { satisfied: blocking.length === 0, blocking };
}

/** A human-readable line for the G9 card explaining why it is blocked (US3). */
export function describeIncomeBlocker(blocker: IncomeGateBlocker): string {
  const what =
    blocker.reason === 'missing'
      ? 'has no income on file'
      : 'has only unverified (syn) income — a verified document is required';
  return `${blocker.clientId} · ${blocker.fieldKey}: ${what}.`;
}
