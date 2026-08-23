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

// M4 (FR-014) — the M4 runtime exports are pinned against the FROZEN declarations
// in specs/005-mesh-m4-connectors/contracts/*.d.ts (sourcing framework +
// adviser-only results surface). The pin is type-level: each
// `pin<Frozen, Runtime>(true)` fails to compile if either side drifts, in either
// direction. Two seams stay deliberately open without breaking the frozen
// contract: `assertClaimable` and `exportEvidenceOfResearch` carry an optional
// options bag (a clock) on top of the frozen one-arg call site — a function of
// fewer params is assignable to one of more, so they remain mutually assignable.
// A handful of runtime smoke assertions keep the file a live (passing) suite.

import * as rtContracts from '@/crm/agentContracts';
import * as rtAdapter from '@/crm/connectors/SourcingAdapter';
import * as rtAssert from '@/crm/connectors/assertClaimable';
import * as rtEvidence from '@/crm/connectors/evidenceExport';
import * as rtResults from '@/crm/ui/SourcingResults';
import { describe, expect, it } from 'vitest';

// True only when A and B are assignable to each other — any drift collapses one
// arm to `never`, which fails the `true` argument.
type MutuallyAssignable<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : never
  : never;
function pin<A, B>(_proof: MutuallyAssignable<A, B>): void {
  void _proof;
}

// ---- sourcing.d.ts ---------------------------------------------------------
pin<
  import('../../../specs/005-mesh-m4-connectors/contracts/sourcing').QueryStep,
  rtContracts.QueryStep
>(true);
pin<
  import('../../../specs/005-mesh-m4-connectors/contracts/sourcing').Product,
  rtContracts.Product
>(true);
pin<
  import('../../../specs/005-mesh-m4-connectors/contracts/sourcing').CoverageKind,
  rtContracts.CoverageKind
>(true);
pin<
  import('../../../specs/005-mesh-m4-connectors/contracts/sourcing').Coverage,
  rtContracts.Coverage
>(true);
pin<
  import('../../../specs/005-mesh-m4-connectors/contracts/sourcing').SourcingAdapter,
  rtAdapter.SourcingAdapter
>(true);
pin<
  import('../../../specs/005-mesh-m4-connectors/contracts/sourcing').VerificationRef,
  rtContracts.VerificationRef
>(true);
pin<
  import('../../../specs/005-mesh-m4-connectors/contracts/sourcing').SourcingSnapshotPayload,
  rtContracts.SourcingSnapshotPayload
>(true);
pin<
  typeof import('../../../specs/005-mesh-m4-connectors/contracts/sourcing').decodeSourcingSnapshotPayload,
  typeof rtContracts.decodeSourcingSnapshotPayload
>(true);
// The frozen call site is one-arg; the runtime carries an optional clock and
// stays mutually assignable (fewer-param assignability) — the staleness seam.
pin<
  typeof import('../../../specs/005-mesh-m4-connectors/contracts/sourcing').assertClaimable,
  typeof rtAssert.assertClaimable
>(true);
pin<
  typeof import('../../../specs/005-mesh-m4-connectors/contracts/sourcing').SOURCING_SERIALIZED_PER_DESKTOP,
  typeof rtContracts.SOURCING_SERIALIZED_PER_DESKTOP
>(true);

// ---- results.d.ts ----------------------------------------------------------
pin<
  import('../../../specs/005-mesh-m4-connectors/contracts/results').ShortlistProps,
  rtResults.ShortlistProps
>(true);
pin<
  import('../../../specs/005-mesh-m4-connectors/contracts/results').RunRibbonProps,
  rtResults.RunRibbonProps
>(true);
pin<
  import('../../../specs/005-mesh-m4-connectors/contracts/results').G5Props,
  rtResults.G5Props
>(true);
// Same staleness seam: frozen one-arg export vs. runtime optional-clock export.
pin<
  typeof import('../../../specs/005-mesh-m4-connectors/contracts/results').exportEvidenceOfResearch,
  typeof rtEvidence.exportEvidenceOfResearch
>(true);

describe('m4 contract freeze (FR-014)', () => {
  it('runtime modules export the pinned callables and constants', () => {
    expect(typeof rtContracts.decodeSourcingSnapshotPayload).toBe('function');
    expect(typeof rtAssert.assertClaimable).toBe('function');
    expect(typeof rtEvidence.exportEvidenceOfResearch).toBe('function');
    expect(typeof rtResults.Shortlist).toBe('function');
    expect(typeof rtResults.RunRibbon).toBe('function');
    expect(typeof rtResults.RecommendationG5).toBe('function');
    expect(rtContracts.SOURCING_SERIALIZED_PER_DESKTOP).toBe(true);
  });
});
