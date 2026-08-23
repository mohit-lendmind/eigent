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

// M5 (FR-005/006/007) — the AffordabilityAssessment WRITER. The pure engine
// (computeAffordability) produces the numbers; the writer is the honesty gate
// that decides whether an affordability run may exist at all. It:
//
//   • stamps the real caseId + an optional product snapshot ref;
//   • enforces the det/syn provenance spine — a `det` input MUST carry its M3
//     quote-locator (sourceRef), otherwise it cannot prove it is deterministic
//     and the run is refused (never a silent downgrade to a claimed-verified max);
//   • runs the G9 income precondition (assessIncomeGate) and, when income is not
//     det-verified, blocks the run and NAMES the blocking applicant/field + the
//     action to unblock (US3) — the criteria grid is unaffected and still renders;
//   • routes the finished payload through assertIndicative (THE choke-point) so a
//     client surface, a mistagged payload, a non-indicative result, unverified
//     income, or a stale M4 product all become a typed hard stop.

import type { SourcingSnapshotPayload } from '../agentContracts';
import type {
  AffordabilityAssessment,
  AffordabilityInput,
} from '../agentContracts/criteriaAffordability';
import {
  assessIncomeGate,
  describeIncomeBlocker,
  type IncomeFactState,
  type IncomeGateBlocker,
} from '../agents/incomeGate';
import {
  assertIndicative,
  type IndicativeRefusal,
} from '../criteria/assertIndicative';
import { computeAffordability } from './calc';

export interface AffordabilityIncomeGateContext {
  /** The applicants whose income must be det-verified before an A6 run. */
  applicants: readonly string[];
  /** The income facts on file, with the trust marker the write path recorded. */
  facts: readonly IncomeFactState[];
  /** Which income field(s) each applicant must have det-verified (defaults to basic). */
  requiredFieldKeys?: readonly string[];
}

export interface WriteAffordabilityInput {
  caseId: string;
  inputs: readonly AffordabilityInput[];
  stressRateBps: number;
  /** G9 precondition — omit only in a context where income is proven elsewhere. */
  income?: AffordabilityIncomeGateContext;
  /** Where the payload is heading. Anything but 'adviser' is refused pre-G5. */
  surface?: 'adviser' | 'client';
  /** A resolved M4 product snapshot; when present it must still be claimable. */
  product?: SourcingSnapshotPayload;
  /** The ref recorded on the payload so a re-run pins the exact product version. */
  productSnapshotRef?: string;
  /** Wall clock for the product staleness check. */
  now?: number;
}

export type WriteAffordabilityResult =
  | { ok: true; assessment: AffordabilityAssessment }
  | {
      ok: false;
      reason: IndicativeRefusal;
      /** Present when reason==='g9-unverified': the exact blocking facts. */
      blocking?: IncomeGateBlocker[];
      /** Present when reason==='g9-unverified': one human line per blocker (US3). */
      blockingSteps?: string[];
    };

// A `det` input claims a deterministically-verified figure; the only thing that
// backs that claim is its M3 quote-locator. A det input without a sourceRef
// cannot prove it, so it is a writer precondition violation — refuse loudly
// rather than let an unproven figure ride into an indicative max as if verified.
function assertDetInputsCarryLocator(
  inputs: readonly AffordabilityInput[]
): void {
  for (const input of inputs) {
    if (input.provenance === 'det' && (input.sourceRef ?? '').length === 0) {
      throw new Error(
        `affordability writer: det input '${input.key}' is missing its M3 quote-locator (sourceRef); a det figure must carry the source that proves it`
      );
    }
  }
}

/**
 * Write an indicative affordability assessment (FR-005/006/007). Returns a typed
 * refusal — never a partial or downgraded payload — when the G9 income gate is
 * unsatisfied or the choke-point refuses. On a G9 block the result names each
 * blocking applicant/field and the action to unblock, so the surface can say why
 * while the criteria grid (which does not need G9) keeps rendering.
 */
export function writeAffordabilityAssessment(
  input: WriteAffordabilityInput
): WriteAffordabilityResult {
  assertDetInputsCarryLocator(input.inputs);

  const gate = input.income
    ? assessIncomeGate(
        input.income.applicants,
        input.income.facts,
        input.income.requiredFieldKeys
      )
    : { satisfied: true, blocking: [] };

  const base = computeAffordability(input.inputs, input.stressRateBps);
  const assessment: AffordabilityAssessment = {
    ...base,
    caseId: input.caseId,
    ...(input.productSnapshotRef
      ? { productSnapshotRef: input.productSnapshotRef }
      : {}),
  };

  const verdict = assertIndicative(assessment, {
    ...(input.surface !== undefined ? { surface: input.surface } : {}),
    g9Verified: gate.satisfied,
    ...(input.product !== undefined ? { product: input.product } : {}),
    ...(input.now !== undefined ? { now: input.now } : {}),
  });

  if (!verdict.ok) {
    if (verdict.reason === 'g9-unverified') {
      return {
        ok: false,
        reason: verdict.reason,
        blocking: gate.blocking,
        blockingSteps: gate.blocking.map(describeIncomeBlocker),
      };
    }
    return { ok: false, reason: verdict.reason };
  }

  return { ok: true, assessment };
}
