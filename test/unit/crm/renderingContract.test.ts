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

// SC-005 — the M2 rendering contract. A later surface must be able to render an
// approval card (from GATE_REGISTRY alone) and a per-case health strip (from
// the six FR-015 selectors) WITHOUT reaching into the fold internals. The proof
// is structural: this file imports ONLY the public barrel '@/crm'. If any
// symbol a renderer needs is not exported there, this file fails to compile —
// which is exactly the boundary regression we want to catch. The assertions are
// headless (plain object view-models), so no React/DOM is involved.

import {
  clearAllCrmState,
  delegableGates,
  GATE_REGISTRY,
  gateById,
  seedCrmGoldenPath,
  selectCaseChainStatus,
  selectCaseFreshness,
  selectCaseHalt,
  selectCaseWatermark,
  selectQuarantineCount,
  selectUnsettledOutbox,
  type DecimalSeq,
  type FoldReasonCode,
  type GateApprover,
  type GateDescriptor,
  type GateId,
} from '@/crm';
import { beforeEach, describe, expect, it } from 'vitest';

// ---- View-models an M2 surface would build from the public surface ----------

interface ApprovalCardModel {
  gateId: GateId;
  title: string;
  approver: GateApprover;
  regulated: boolean;
  batchable: boolean;
  delegable: boolean;
  tier: 1 | 2 | 3;
  slaMinutes: number;
  basis: string;
  autoDisarmFlags: readonly string[];
}

function buildApprovalCard(gate: GateDescriptor): ApprovalCardModel {
  return {
    gateId: gate.id,
    title: gate.name,
    approver: gate.approver,
    regulated: gate.regulated,
    batchable: gate.batchable,
    // A card's "delegate" affordance is derivable from registry data alone.
    delegable: !gate.regulated && gate.approver === 'delegate-ok',
    tier: gate.tier,
    slaMinutes: gate.slaMinutes,
    basis: gate.basis,
    autoDisarmFlags: gate.autoDisarmFlags,
  };
}

interface CaseHealthStrip {
  watermark: DecimalSeq;
  chainStatus: 'verified' | 'broken' | 'unverified';
  sourceStatus: 'never' | 'live' | 'stale' | 'failed' | 'no-project';
  lastFoldedAt: number;
  halted: { reasonCode: FoldReasonCode; atSeq: DecimalSeq } | null;
  quarantineRetained: number;
  quarantineEver: number;
  unsettledOutbox: number;
}

function buildCaseHealthStrip(caseId: string): CaseHealthStrip {
  const freshness = selectCaseFreshness(caseId);
  const quarantine = selectQuarantineCount(caseId);
  return {
    watermark: selectCaseWatermark(caseId),
    chainStatus: selectCaseChainStatus(caseId),
    sourceStatus: freshness.sourceStatus,
    lastFoldedAt: freshness.lastFoldedAt,
    halted: selectCaseHalt(caseId),
    quarantineRetained: quarantine.retained,
    quarantineEver: quarantine.everCount,
    unsettledOutbox: selectUnsettledOutbox(caseId),
  };
}

describe('M2 rendering contract — barrel-only render surface (SC-005)', () => {
  beforeEach(() => {
    clearAllCrmState();
  });

  it('renders an approval card from GATE_REGISTRY alone', () => {
    // The whole registry renders — every gate yields a well-formed card.
    const cards = GATE_REGISTRY.map(buildApprovalCard);
    expect(cards).toHaveLength(11); // G1..G10 with G4a/G4b split
    for (const card of cards) {
      expect(card.title.length).toBeGreaterThan(0);
      expect(['adviser', 'delegate-ok', 'network-supervisor']).toContain(
        card.approver
      );
      expect([1, 2, 3]).toContain(card.tier);
      expect(card.slaMinutes).toBeGreaterThan(0);
      // Invariant a card must surface: a regulated gate is never delegable.
      if (card.regulated) expect(card.delegable).toBe(false);
    }

    // A tier-1 regulated card (recommendation + suitability).
    const g5 = buildApprovalCard(gateById('G5'));
    expect(g5).toMatchObject({
      approver: 'adviser',
      regulated: true,
      batchable: false,
      delegable: false,
      tier: 1,
    });

    // The one delegable, batchable card (operational comms).
    const g4b = buildApprovalCard(gateById('G4b'));
    expect(g4b).toMatchObject({
      approver: 'delegate-ok',
      regulated: false,
      batchable: true,
      delegable: true,
    });
    expect(g4b.autoDisarmFlags.length).toBeGreaterThan(0);

    // The registry's delegable set is exactly the one card the strip flagged.
    const delegable = delegableGates().map((g) => g.id);
    expect(delegable).toEqual(['G4b']);
  });

  it('renders a verified case-health strip from the six selectors after a fold', async () => {
    await seedCrmGoldenPath({ ignoreDevGate: true, throughFold: true });

    const strip = buildCaseHealthStrip('c417');
    expect(strip.chainStatus).toBe('verified');
    expect(strip.sourceStatus).toBe('live');
    expect(BigInt(strip.watermark)).toBeGreaterThan(0n);
    expect(strip.lastFoldedAt).toBeGreaterThan(0);
    expect(strip.halted).toBeNull();
    expect(strip.unsettledOutbox).toBe(0);
  });

  it('renders a distinguishable "never fetched" strip for an unknown case', () => {
    // FR-015: the strip must tell "never fetched" apart from a broken/verified
    // chain — a surface reads this straight off the selectors, no fold needed.
    const strip = buildCaseHealthStrip('cNONE');
    expect(strip.chainStatus).toBe('unverified');
    expect(strip.sourceStatus).toBe('never');
    expect(strip.watermark).toBe('0');
    expect(strip.lastFoldedAt).toBe(0);
    expect(strip.halted).toBeNull();
    expect(strip.unsettledOutbox).toBe(0);
  });
});
