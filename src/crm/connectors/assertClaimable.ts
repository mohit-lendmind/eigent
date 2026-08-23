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

// M4 (FR-006) — the honesty spine. `verified` is DERIVED from a VerificationRef
// (a fixture hash + rates-as-at + a raw-enquiry-evidence pointer + a passing
// canary), never a self-asserted boolean. `assertClaimable` is THE single
// choke-point: the results surface, every evidence-of-research export, and any
// client-facing path route through it, and it re-derives rather than trusting
// the stored flag — a hand-set `verified:true` with no evidence does not pass.

import {
  SOURCING_SURFACE_CLASS,
  type SourcingSnapshotPayload,
  type VerificationRef,
} from '../agentContracts';

// Rates are quoted as-at a date; a snapshot older than this is stale for a live
// recommendation. Only checked when a caller supplies `now` — the frozen
// one-arg call site never trips it, but G5 (which knows the clock) can.
export const SOURCING_RATES_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Derive `verified` from the evidence, never from a caller's say-so. True only
 * when the ref carries a fixture hash, a rates-as-at, a raw-evidence pointer,
 * AND a passing canary timestamp — the full set that makes a live claim real
 * (FR-006; T013: verified true only with a passing canary + evidence).
 */
export function deriveVerified(verification?: VerificationRef): boolean {
  if (!verification) return false;
  return (
    verification.fixtureHash.length > 0 &&
    verification.ratesAsAt.length > 0 &&
    verification.rawEvidencePointer.length > 0 &&
    typeof verification.canaryPassedAt === 'string' &&
    verification.canaryPassedAt.length > 0
  );
}

export type ClaimableVerdict =
  | { ok: true }
  | {
      ok: false;
      reason: 'unverified' | 'no-evidence' | 'stale' | 'wrong-surface';
    };

export interface AssertClaimableOptions {
  /** Wall clock; when given, a rates-as-at older than maxAgeMs reads stale. */
  now?: number;
  maxAgeMs?: number;
}

/**
 * The choke-point. Blocks any snapshot that is not adviser-only, not verified
 * (re-derived, not trusted), evidence-less, or — when a clock is supplied —
 * stale, from every client-facing surface and evidence export (FR-006).
 */
export function assertClaimable(
  snapshot: SourcingSnapshotPayload,
  options?: AssertClaimableOptions
): ClaimableVerdict {
  if (snapshot.surfaceClass !== SOURCING_SURFACE_CLASS) {
    return { ok: false, reason: 'wrong-surface' };
  }
  if (!snapshot.verified) return { ok: false, reason: 'unverified' };
  // Re-derive: a snapshot that claims verified but whose evidence does not
  // support it is not claimable — the stored flag is never trusted on its own.
  if (!deriveVerified(snapshot.verification)) {
    return { ok: false, reason: 'no-evidence' };
  }
  if (options?.now !== undefined) {
    const asAt = Date.parse(snapshot.ratesAsAt);
    const maxAge = options.maxAgeMs ?? SOURCING_RATES_MAX_AGE_MS;
    if (Number.isFinite(asAt) && options.now - asAt > maxAge) {
      return { ok: false, reason: 'stale' };
    }
  }
  return { ok: true };
}
