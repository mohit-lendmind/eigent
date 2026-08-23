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

// M4 (FR-006) — evidence of research (MCOB 4.7A). Producing an evidence bundle
// is the sharpest claim the surface can make, so it routes through the ONE
// choke-point: assertClaimable. A snapshot that is not adviser-only, not verified
// (re-derived, never trusted), evidence-less, or stale yields NO bundle and a
// machine-readable reason instead. A scaffold (verified:false) can never export —
// that is the honesty spine reaching the compliance artifact.

import type { SourcingSnapshotPayload } from '../agentContracts';
import {
  assertClaimable,
  type AssertClaimableOptions,
} from './assertClaimable';

export type EvidenceExportResult =
  { ok: true; bundleId: string } | { ok: false; reason: string };

/**
 * Export an evidence-of-research bundle for a sourcing snapshot — but ONLY if the
 * snapshot is claimable. The verdict from assertClaimable is authoritative: a
 * blocked snapshot returns its reason and no bundle id. The bundle id is derived
 * from the snapshot's own evidence pointers so the same claimable snapshot always
 * names the same bundle.
 *
 * `options` (a clock) lets a caller enforce staleness at export time; the frozen
 * one-arg call site (results.d.ts) omits it and never trips staleness.
 */
export function exportEvidenceOfResearch(
  snapshot: SourcingSnapshotPayload,
  options?: AssertClaimableOptions
): EvidenceExportResult {
  const verdict = assertClaimable(snapshot, options);
  if (!verdict.ok) {
    return { ok: false, reason: verdict.reason };
  }
  // Claimable: mint a stable bundle id from the evidence the snapshot stands on.
  const bundleId =
    `eor_${snapshot.adapterId}_${snapshot.ratesAsAt}_${snapshot.productsAttachmentId}`.replace(
      /[^A-Za-z0-9_.:-]/g,
      '-'
    );
  return { ok: true, bundleId };
}
