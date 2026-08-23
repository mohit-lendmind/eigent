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

// M4 (FR-001/004) — the A4 sourcing agent under test. Its two seams stay apart:
// DISPATCH publishes the adapter's DECLARATIVE plan to the pump (fire-and-forget,
// never drives the executor), and RECORD runs the adapter's PURE extractor over a
// captured result and writes the snapshot with `verified` DERIVED. A verified
// adapter (MSE + full evidence) yields verified:true; a scaffold (Mortgage Brain,
// no evidence) yields verified:false.

import { decodeDirectiveEnvelope } from '@/crm/agentContracts';
import { resetCaseProjectCaches } from '@/crm/agents/caseProject';
import { configureAgentEdge } from '@/crm/agents/edge';
import {
  buildSourcingDirective,
  dispatchSourcingRun,
  recordSourcingRun,
  SOURCING_AGENT,
} from '@/crm/agents/sourcing';
import { useCrmCasesStore } from '@/crm/casesStore';
import { MORTGAGE_BRAIN_ADAPTER } from '@/crm/connectors/adapters/mortgageBrain';
import {
  MSE_ADAPTER,
  MSE_REPLAY_VERIFICATION,
} from '@/crm/connectors/adapters/mse';
import {
  getSourcingAdapter,
  registerSourcingAdapter,
  resetSourcingRegistry,
} from '@/crm/connectors/registry';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeEdge } from './fakeEdge';

const MSE_DEALS = {
  deals: [
    {
      lenderId: 'lender-002',
      productName: '5 Year Fixed',
      initialRatePct: 4.04,
      aprcPct: 5.9,
      productFeePence: 149900,
      monthlyPaymentPence: 106200,
      trueCostPence: 6521900,
      revertRatePct: 7.74,
      ercPence: 400000,
    },
    {
      lenderId: 'lender-004',
      productName: '95% LTV',
      initialRatePct: 5.29,
      aprcPct: 7.1,
      productFeePence: 49900,
      monthlyPaymentPence: 120400,
      trueCostPence: 0,
      eligible: false,
      declineReason: 'LTV above product maximum',
    },
  ],
};

beforeEach(() => {
  resetSourcingRegistry();
  resetCaseProjectCaches();
  useCrmCasesStore.getState().resetForTests();
  localStorage.clear();
  registerSourcingAdapter(MSE_ADAPTER);
  registerSourcingAdapter(MORTGAGE_BRAIN_ADAPTER);
});
afterEach(() => {
  configureAgentEdge(null);
  resetSourcingRegistry();
});

describe('buildSourcingDirective — carries the declarative plan (FR-001)', () => {
  it('names the sourcing agent, the adviser, and embeds the adapter plan', () => {
    const adapter = getSourcingAdapter('mse')!;
    const envelope = buildSourcingDirective({
      caseId: 'case-1',
      firmId: 'firm-alpha',
      adapter,
      caseFacts: { loanAmountPence: 20_000_000, termYears: 25 },
      adviserId: 'adviser-jo',
    });
    // A well-formed directive envelope (decoder is strict).
    expect(() => decodeDirectiveEnvelope(envelope)).not.toThrow();
    expect(envelope.agent).toBe(SOURCING_AGENT);
    expect(envelope.issuedBy).toEqual({ kind: 'adviser', id: 'adviser-jo' });
    // The plan the pump runs rides in constraints — the agent never executes it.
    const plan = (envelope.constraints as { plan: { tool: string }[] }).plan;
    expect(plan[0].tool).toBe('browser.open');
    expect(plan.some((s) => s.tool === 'browser.captureJson')).toBe(true);
  });
});

describe('dispatchSourcingRun — fire-and-forget to the pump (FR-001)', () => {
  it('admits a command that references the published directive', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);
    const adapter = getSourcingAdapter('mse')!;
    const result = await dispatchSourcingRun({
      caseId: 'case-1',
      firmId: 'firm-alpha',
      adapter,
      caseFacts: { loanAmountPence: 20_000_000 },
      adviserId: 'adviser-jo',
    });
    expect(result.commandId).toBeTruthy();
    expect(result.runId).toBeTruthy();
    expect(result.directiveArtifactId).toBeTruthy();
  });
});

describe('recordSourcingRun — pure extract + snapshot, verified derived (FR-004/006)', () => {
  it('a verified adapter with full evidence writes verified:true', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);
    const adapter = getSourcingAdapter('mse')!;
    const out = await recordSourcingRun({
      caseId: 'case-1',
      firmId: 'firm-alpha',
      adviserId: 'adviser-jo',
      adapter,
      ratesAsAt: '2026-08-23T00:00:00.000Z',
      recordedResult: MSE_DEALS,
      verification: {
        ...MSE_REPLAY_VERIFICATION,
        canaryPassedAt: '2026-08-23T01:00:00.000Z',
      },
      now: 1_724_400_000_000,
    });
    expect(out.snapshot.verified).toBe(true);
    expect(out.snapshot.adapterId).toBe('mse');
    expect(out.snapshot.adviserId).toBe('adviser-jo');
    // 1 eligible of 2 (one declined); full set rode as an attachment.
    expect(out.snapshot.summary).toEqual({
      total: 2,
      eligible: 1,
      declined: 1,
      topTrueCostPence: 6521900,
    });
    expect(out.snapshot.productsAttachmentId).toBe(out.productsArtifactId);
  });

  it('a scaffold adapter (no evidence) writes verified:false', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);
    const adapter = getSourcingAdapter('mortgage-brain')!;
    const out = await recordSourcingRun({
      caseId: 'case-2',
      firmId: 'firm-alpha',
      adviserId: 'adviser-jo',
      adapter,
      ratesAsAt: '2026-08-23T00:00:00.000Z',
      recordedResult: {
        rows: [
          {
            lender: 'panel-1',
            product: '2 Year Fixed',
            initialRate: '4.24%',
            productFee: '£999',
            monthlyPayment: '£1,081',
            trueCost: '£26,910',
            status: 'Eligible',
          },
        ],
      },
      now: 1_724_400_000_000,
    });
    expect(out.snapshot.verified).toBe(false);
    expect(out.snapshot.coverage.kind).toBe('firm-panel');
    expect(out.snapshot.coverage.wholeOfMarket).toBe(false);
  });
});
