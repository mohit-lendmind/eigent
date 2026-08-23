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

// M4 (FR-005/006/010) — the honesty spine under test. The dedicated decoder
// rejects a partial payload; `verified` is DERIVED (a hand-set true with no
// evidence does not pass); assertClaimable blocks unverified / evidence-less /
// stale / wrong-surface snapshots; and the writer folds a run into a small
// case-log summary with the FULL set as an attachment (never inline), stamping
// the adviser and the adviser-only surface.

import {
  decodeSourcingSnapshotPayload,
  SOURCING_SERIALIZED_PER_DESKTOP,
  SOURCING_SURFACE_CLASS,
  type Product,
  type SourcingSnapshotPayload,
  type VerificationRef,
} from '@/crm/agentContracts';
import { resetCaseProjectCaches } from '@/crm/agents/caseProject';
import { configureAgentEdge } from '@/crm/agents/edge';
import { useCrmCasesStore } from '@/crm/casesStore';
import {
  assertClaimable,
  deriveVerified,
} from '@/crm/connectors/assertClaimable';
import { mseCoverage } from '@/crm/connectors/coverage';
import {
  summarizeProducts,
  writeSourcingSnapshot,
} from '@/crm/connectors/snapshotWriter';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeEdge } from './fakeEdge';

function fullVerification(): VerificationRef {
  return {
    fixtureHash: 'fnv1a64:deadbeefdeadbeef',
    ratesAsAt: '2026-08-23T00:00:00.000Z',
    rawEvidencePointer: 'lm/sourcing/case-1/products.json',
    canaryPassedAt: '2026-08-23T01:00:00.000Z',
  };
}

function claimableSnapshot(): SourcingSnapshotPayload {
  return {
    adapterId: 'mse',
    coverage: mseCoverage(),
    ratesAsAt: '2026-08-23T00:00:00.000Z',
    adviserId: 'adviser-jo',
    verified: true,
    verification: fullVerification(),
    surfaceClass: SOURCING_SURFACE_CLASS,
    productsAttachmentId: 'art_products',
    summary: { total: 3, eligible: 2, declined: 1, topTrueCostPence: 123_456 },
  };
}

const products: Product[] = [
  {
    lenderId: 'lender-a',
    productName: '2yr fix',
    rate: 4.2,
    aprc: 4.5,
    feesPence: 99_900,
    monthlyPence: 120_000,
    trueCostPence: 3_100_000,
    status: 'eligible',
  },
  {
    lenderId: 'lender-b',
    productName: '5yr fix',
    rate: 4.0,
    aprc: 4.3,
    feesPence: 149_900,
    monthlyPence: 118_000,
    trueCostPence: 2_950_000,
    status: 'eligible',
  },
  {
    lenderId: 'lender-c',
    productName: 'tracker',
    rate: 5.1,
    aprc: 5.2,
    feesPence: 0,
    monthlyPence: 130_000,
    trueCostPence: 3_400_000,
    status: 'declined',
    declineReason: 'LTV over limit',
  },
];

describe('decodeSourcingSnapshotPayload — rejects a partial payload (FR-005)', () => {
  it('accepts a complete payload', () => {
    expect(() =>
      decodeSourcingSnapshotPayload(claimableSnapshot())
    ).not.toThrow();
  });

  it('rejects a missing coverage', () => {
    const bad = { ...claimableSnapshot() } as Record<string, unknown>;
    delete bad.coverage;
    expect(() => decodeSourcingSnapshotPayload(bad)).toThrow();
  });

  it('rejects a missing ratesAsAt', () => {
    const bad = { ...claimableSnapshot() } as Record<string, unknown>;
    delete bad.ratesAsAt;
    expect(() => decodeSourcingSnapshotPayload(bad)).toThrow();
  });

  it('rejects a missing productsAttachmentId (no inline-only set)', () => {
    const bad = { ...claimableSnapshot() } as Record<string, unknown>;
    delete bad.productsAttachmentId;
    expect(() => decodeSourcingSnapshotPayload(bad)).toThrow();
  });

  it('rejects a surfaceClass other than adviser-only', () => {
    const bad = { ...claimableSnapshot(), surfaceClass: 'client-facing' };
    expect(() => decodeSourcingSnapshotPayload(bad)).toThrow();
  });

  it('rejects a non-boolean verified', () => {
    const bad = { ...claimableSnapshot(), verified: 'yes' };
    expect(() => decodeSourcingSnapshotPayload(bad)).toThrow();
  });
});

describe('deriveVerified — verified is derived, never self-asserted (FR-006)', () => {
  it('true only with fixtureHash + ratesAsAt + rawEvidence + a passing canary', () => {
    expect(deriveVerified(fullVerification())).toBe(true);
  });

  it('false with no verification at all', () => {
    expect(deriveVerified(undefined)).toBe(false);
  });

  it('false without a passing canary', () => {
    const ref = { ...fullVerification() };
    delete ref.canaryPassedAt;
    expect(deriveVerified(ref)).toBe(false);
  });

  it('false with an empty evidence pointer', () => {
    expect(
      deriveVerified({ ...fullVerification(), rawEvidencePointer: '' })
    ).toBe(false);
  });
});

describe('assertClaimable — THE choke-point (FR-006)', () => {
  it('passes a claimable snapshot', () => {
    expect(assertClaimable(claimableSnapshot())).toEqual({ ok: true });
  });

  it('blocks a wrong surface', () => {
    const s = {
      ...claimableSnapshot(),
      surfaceClass: 'client-facing',
    } as never;
    expect(assertClaimable(s)).toEqual({ ok: false, reason: 'wrong-surface' });
  });

  it('blocks an unverified snapshot', () => {
    const s = { ...claimableSnapshot(), verified: false };
    expect(assertClaimable(s)).toEqual({ ok: false, reason: 'unverified' });
  });

  it('blocks a hand-set verified:true with no evidence (re-derives)', () => {
    const s = {
      ...claimableSnapshot(),
      verified: true,
      verification: undefined,
    };
    expect(assertClaimable(s)).toEqual({ ok: false, reason: 'no-evidence' });
  });

  it('blocks a stale snapshot when a clock is supplied', () => {
    const s = claimableSnapshot();
    const asAt = Date.parse(s.ratesAsAt);
    const verdict = assertClaimable(s, {
      now: asAt + 48 * 60 * 60 * 1000,
    });
    expect(verdict).toEqual({ ok: false, reason: 'stale' });
  });

  it('the frozen one-arg call never trips staleness', () => {
    expect(assertClaimable(claimableSnapshot())).toEqual({ ok: true });
  });
});

describe('summarizeProducts — folds counts + the cheapest eligible', () => {
  it('counts eligible/declined and picks the min eligible true-cost', () => {
    expect(summarizeProducts(products)).toEqual({
      total: 3,
      eligible: 2,
      declined: 1,
      topTrueCostPence: 2_950_000,
    });
  });
});

describe('writeSourcingSnapshot — folds small, full set as attachment (FR-004/010)', () => {
  beforeEach(() => {
    resetCaseProjectCaches();
    useCrmCasesStore.getState().resetForTests();
    localStorage.clear();
  });
  afterEach(() => configureAgentEdge(null));

  it('serialized-per-desktop is a literal true (FR-010)', () => {
    expect(SOURCING_SERIALIZED_PER_DESKTOP).toBe(true);
  });

  it('writes the full set as an attachment, folds a small summary, stamps adviser', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);
    const result = await writeSourcingSnapshot({
      caseId: 'case-1',
      firmId: 'firm-alpha',
      adviserId: 'adviser-jo',
      adapterId: 'mse',
      coverage: mseCoverage(),
      ratesAsAt: '2026-08-23T00:00:00.000Z',
      products,
      verification: fullVerification(),
      now: 1_724_400_000_000,
    });

    // verified derived true from the full ref.
    expect(result.snapshot.verified).toBe(true);
    expect(result.snapshot.surfaceClass).toBe(SOURCING_SURFACE_CLASS);
    expect(result.snapshot.adviserId).toBe('adviser-jo');
    // The full set rides as an attachment, referenced — never inline.
    expect(result.snapshot.productsAttachmentId).toBe(
      result.productsArtifactId
    );
    expect(result.snapshot).not.toHaveProperty('products');
    expect(result.snapshot.summary.total).toBe(3);

    // The full set + the snapshot both landed as named attachments.
    const projectId = edge.projects.keys().next().value as string;
    const list = await edge.listArtifacts(projectId, {});
    expect(list.artifacts.some((a) => a.name.includes('/products.json'))).toBe(
      true
    );
    expect(list.artifacts.some((a) => a.name.includes('/snapshot.json'))).toBe(
      true
    );
    expect(decodeSourcingSnapshotPayload(result.snapshot)).toEqual(
      result.snapshot
    );
  });

  it('a run without full evidence writes a verified:false scaffold snapshot', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);
    const result = await writeSourcingSnapshot({
      caseId: 'case-2',
      firmId: 'firm-alpha',
      adviserId: 'adviser-jo',
      adapterId: 'mortgage-brain',
      coverage: mseCoverage(),
      ratesAsAt: '2026-08-23T00:00:00.000Z',
      products,
      now: 1_724_400_000_000,
    });
    expect(result.snapshot.verified).toBe(false);
    expect(assertClaimable(result.snapshot)).toEqual({
      ok: false,
      reason: 'unverified',
    });
  });
});
