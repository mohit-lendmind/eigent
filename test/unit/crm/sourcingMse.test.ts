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

// M4 (FR-002/003/006) — the MSE adapter under CI replay. The checked-in scrubbed
// fixture replays through the PURE extractor deterministically (no browser), and
// `verified` derives TRUE only with a passing canary PLUS evidence — the MSE
// adapter at rest (no canaryPassedAt) is verified:false, and only a per-run ref
// carrying a canary timestamp flips it.

import {
  MSE_ADAPTER,
  MSE_REPLAY_VERIFICATION,
  mseBuildQuery,
  mseExtract,
} from '@/crm/connectors/adapters/mse';
import { deriveVerified } from '@/crm/connectors/assertClaimable';
import {
  getSourcingAdapter,
  registerSourcingAdapter,
  resetSourcingRegistry,
} from '@/crm/connectors/registry';
import {
  decodeReplayFixture,
  replayExtract,
} from '@/crm/connectors/replay/harness';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

function loadFixture() {
  const text = fs.readFileSync(
    path.resolve(process.cwd(), 'e2e/fixtures/mse.fixture.json'),
    'utf-8'
  );
  return decodeReplayFixture(JSON.parse(text));
}

describe('MSE adapter — replay is green over the scrubbed fixture (FR-003)', () => {
  it('the pure extractor normalizes the captured JSON deterministically', () => {
    const products = replayExtract(mseExtract, loadFixture());
    expect(products).toHaveLength(4);
    expect(products.filter((p) => p.status === 'eligible')).toHaveLength(3);
    const declined = products.filter((p) => p.status === 'declined');
    expect(declined).toHaveLength(1);
    expect(declined[0].declineReason).toBe('LTV above product maximum');

    // Two identical replays produce identical output — the purity property.
    expect(replayExtract(mseExtract, loadFixture())).toEqual(products);
  });

  it('normalizes money as pence and carries revert rate + ERC through', () => {
    const products = replayExtract(mseExtract, loadFixture());
    const fiveYear = products.find((p) => p.productName === '5 Year Fixed');
    expect(fiveYear).toBeDefined();
    expect(fiveYear?.feesPence).toBe(149900);
    expect(fiveYear?.monthlyPence).toBe(106200);
    expect(fiveYear?.revertRate).toBe(7.74);
    expect(fiveYear?.ercPence).toBe(400000);
  });

  it('buildQuery emits a declarative isolated-window plan (never drives the executor)', () => {
    const plan = mseBuildQuery({ loanAmountPence: 20_000_000, termYears: 25 });
    expect(plan[0]).toEqual({
      tool: 'browser.open',
      args: { url: expect.any(String), session: 'isolated' },
    });
    expect(plan.some((s) => s.tool === 'browser.captureJson')).toBe(true);
  });

  it('coverage is MSE Best Buys (Podium), never whole of market', () => {
    const coverage = MSE_ADAPTER.coverage();
    expect(coverage.kind).toBe('mse-best-buys');
    expect(coverage.wholeOfMarket).toBe(false);
  });
});

describe('MSE verified — derived true ONLY with a passing canary + evidence (FR-006)', () => {
  beforeEach(() => resetSourcingRegistry());
  afterEach(() => resetSourcingRegistry());

  it('the shipped MSE verification (no canary) derives verified:false', () => {
    // Honesty spine: MSE ships with replay evidence but NO baked canary — so at
    // rest it is NOT verified. Only a real canary run supplies canaryPassedAt.
    expect(MSE_REPLAY_VERIFICATION.canaryPassedAt).toBeUndefined();
    expect(deriveVerified(MSE_REPLAY_VERIFICATION)).toBe(false);

    registerSourcingAdapter(MSE_ADAPTER);
    expect(getSourcingAdapter('mse')?.verified).toBe(false);
  });

  it('adding a passing canary timestamp to the full evidence derives true', () => {
    const withCanary = {
      ...MSE_REPLAY_VERIFICATION,
      canaryPassedAt: '2026-08-22T09:05:00.000Z',
    };
    expect(deriveVerified(withCanary)).toBe(true);
  });

  it('a canary timestamp WITHOUT the rest of the evidence does not verify', () => {
    expect(
      deriveVerified({
        fixtureHash: '',
        ratesAsAt: '2026-08-22',
        rawEvidencePointer: '',
        canaryPassedAt: '2026-08-22T09:05:00.000Z',
      })
    ).toBe(false);
  });
});
