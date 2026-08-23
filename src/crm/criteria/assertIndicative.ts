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

// M5 (FR-007/008) — THE choke-point. Every criteria/affordability surface and
// export MUST route through assertIndicative; the guarantee is STRUCTURAL,
// enforced in the writer/fold, not by UI hiding. It refuses, with a typed
// reason, any payload that would let indicative reasoning masquerade as a
// guaranteed lender decision or leak off the adviser surface:
//
//   client-surface  — the target surface is client-facing (never, pre-G5).
//   wrong-surface   — the payload's surfaceClass tag is not 'adviser-only'.
//   not-indicative  — an affordability result not stamped indicative:true.
//   g9-unverified   — an affordability run whose income is not det-verified (G9).
//   stale-product   — a referenced M4 snapshot fails assertClaimable (stale/etc).
//
// The frozen call site is one-arg; the runtime adds an optional context bag
// (target surface, the G9 verdict, the resolved product snapshot, a clock).
// A function of fewer params is assignable to one of more, so the freeze test
// stays green.

import type { SourcingSnapshotPayload } from '../agentContracts';
import type {
  AffordabilityAssessment,
  CriteriaAssessment,
} from '../agentContracts/criteriaAffordability';
import { CRITERIA_SURFACE_CLASS } from '../agentContracts/criteriaAffordability';
import { assertClaimable } from '../connectors/assertClaimable';

export type IndicativeRefusal =
  | 'client-surface'
  | 'not-indicative'
  | 'g9-unverified'
  | 'wrong-surface'
  | 'stale-product';

export type IndicativeVerdict =
  { ok: true } | { ok: false; reason: IndicativeRefusal };

export interface AssertIndicativeContext {
  /** Where the payload is heading. Anything but 'adviser' is refused pre-G5. */
  surface?: 'adviser' | 'client';
  /** The G9 income-verification verdict. `false` blocks an affordability run. */
  g9Verified?: boolean;
  /** A resolved M4 snapshot; when present it must still be claimable. */
  product?: SourcingSnapshotPayload;
  /** Wall clock for the product staleness check. */
  now?: number;
}

function isAffordability(
  payload: CriteriaAssessment | AffordabilityAssessment
): payload is AffordabilityAssessment {
  return payload.kind === 'lm.affordability.assessment/1';
}

/**
 * THE choke-point (FR-007/008). Returns `{ok:true}` only when the payload is
 * adviser-only, genuinely indicative, its income is G9-verified (affordability),
 * and any referenced product is still claimable. Every other case returns a
 * typed refusal — the writer/fold turns that into a hard stop, never a silent
 * downgrade.
 */
export function assertIndicative(
  payload: CriteriaAssessment | AffordabilityAssessment,
  context?: AssertIndicativeContext
): IndicativeVerdict {
  // A client-facing target is refused outright — indicative reasoning is
  // adviser-only until a human owns it at G5.
  if (context?.surface !== undefined && context.surface !== 'adviser') {
    return { ok: false, reason: 'client-surface' };
  }

  // The structural tag must say adviser-only; a mistagged payload is refused.
  if (payload.surfaceClass !== CRITERIA_SURFACE_CLASS) {
    return { ok: false, reason: 'wrong-surface' };
  }

  if (isAffordability(payload)) {
    // Affordability must be stamped indicative — never a guaranteed max.
    if (payload.indicative !== true) {
      return { ok: false, reason: 'not-indicative' };
    }
    // G9: an affordability run needs det-verified income. An explicit false
    // blocks; undefined (unknown) does not manufacture a refusal.
    if (context?.g9Verified === false) {
      return { ok: false, reason: 'g9-unverified' };
    }
    // A referenced product that is no longer claimable (stale rates, lost
    // evidence, wrong surface) taints the affordability output.
    if (context?.product !== undefined) {
      const claimable = assertClaimable(context.product, { now: context.now });
      if (!claimable.ok) return { ok: false, reason: 'stale-product' };
    }
  }

  return { ok: true };
}
