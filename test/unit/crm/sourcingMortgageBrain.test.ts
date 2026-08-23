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

// M4 (FR-002/009) — the Mortgage Brain SCAFFOLD under test. The pure extractor
// parses the illustrative DOM-scrape shape deterministically (proving it is real
// code, not a stub), but the adapter carries NO verification, so it derives
// verified:FALSE and assertClaimable refuses any snapshot built from it out of
// the evidence pack and every client surface. This is the honesty spine for a
// licensed portal: unverified until a real session is recorded.

import { SOURCING_SURFACE_CLASS } from '@/crm/agentContracts';
import {
  MORTGAGE_BRAIN_ADAPTER,
  mortgageBrainBuildQuery,
  mortgageBrainExtract,
} from '@/crm/connectors/adapters/mortgageBrain';
import { assertClaimable } from '@/crm/connectors/assertClaimable';
import {
  getSourcingAdapter,
  registerSourcingAdapter,
  resetSourcingRegistry,
} from '@/crm/connectors/registry';
import {
  decodeReplayFixture,
  replayExtract,
} from '@/crm/connectors/replay/harness';
import { summarizeProducts } from '@/crm/connectors/snapshotWriter';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

function loadFixture() {
  const text = fs.readFileSync(
    path.resolve(process.cwd(), 'e2e/fixtures/mortgageBrain.fixture.json'),
    'utf-8'
  );
  return decodeReplayFixture(JSON.parse(text));
}

describe('Mortgage Brain scaffold — the extractor is real code (FR-002/003)', () => {
  it('parses scraped DOM rows (money/rates as displayed strings) into Products', () => {
    const products = replayExtract(mortgageBrainExtract, loadFixture());
    expect(products).toHaveLength(4);
    expect(products.filter((p) => p.status === 'eligible')).toHaveLength(3);

    const fiveYear = products.find((p) => p.productName === '5 Year Fixed');
    expect(fiveYear).toBeDefined();
    // "£1,499" → 149900 pence; "4.09%" → 4.09; "£4,000" ERC → 400000.
    expect(fiveYear?.feesPence).toBe(149900);
    expect(fiveYear?.rate).toBe(4.09);
    expect(fiveYear?.revertRate).toBe(7.74);
    expect(fiveYear?.ercPence).toBe(400000);

    // Two identical replays produce identical output — the purity property.
    expect(replayExtract(mortgageBrainExtract, loadFixture())).toEqual(
      products
    );
  });

  it('a declined row is carried with its reason, never dropped', () => {
    const products = replayExtract(mortgageBrainExtract, loadFixture());
    const declined = products.filter((p) => p.status === 'declined');
    expect(declined).toHaveLength(1);
    expect(declined[0].declineReason).toBe('LTV above product maximum');
  });

  it('buildQuery emits a LOGGED-IN DOM-scrape plan (never drives the executor)', () => {
    const plan = mortgageBrainBuildQuery({
      loanAmountPence: 20_000_000,
      termYears: 25,
    });
    expect(plan[0]).toEqual({
      tool: 'browser.open',
      args: { url: expect.any(String), session: 'logged_in' },
    });
    expect(plan.some((s) => s.tool === 'browser.readTable')).toBe(true);
    // No network capture: a licensed portal is DOM-scraped, not intercepted.
    expect(plan.some((s) => s.tool === 'browser.captureJson')).toBe(false);
  });

  it('coverage is a firm panel, never whole of market', () => {
    const coverage = MORTGAGE_BRAIN_ADAPTER.coverage();
    expect(coverage.kind).toBe('firm-panel');
    expect(coverage.wholeOfMarket).toBe(false);
  });
});

describe('Mortgage Brain — ships verified:false (honesty spine, FR-006/009)', () => {
  beforeEach(() => resetSourcingRegistry());
  afterEach(() => resetSourcingRegistry());

  it('the definition carries NO verification field', () => {
    expect(MORTGAGE_BRAIN_ADAPTER.verification).toBeUndefined();
  });

  it('the registry derives verified:false for the scaffold', () => {
    registerSourcingAdapter(MORTGAGE_BRAIN_ADAPTER);
    expect(getSourcingAdapter('mortgage-brain')?.verified).toBe(false);
  });

  it('assertClaimable blocks a snapshot built from the scaffold', () => {
    const products = replayExtract(mortgageBrainExtract, loadFixture());
    const snapshot = {
      adapterId: 'mortgage-brain',
      coverage: MORTGAGE_BRAIN_ADAPTER.coverage(),
      ratesAsAt: '2026-08-22',
      adviserId: 'adviser-jo',
      verified: false,
      surfaceClass: SOURCING_SURFACE_CLASS,
      productsAttachmentId: 'art_products',
      summary: summarizeProducts(products),
    } as const;
    // Unverified → refused from the evidence pack and every client surface.
    expect(assertClaimable(snapshot)).toEqual({
      ok: false,
      reason: 'unverified',
    });
  });

  it('a hand-set verified:true on the scaffold is re-derived away (no evidence)', () => {
    const products = replayExtract(mortgageBrainExtract, loadFixture());
    const lying = {
      adapterId: 'mortgage-brain',
      coverage: MORTGAGE_BRAIN_ADAPTER.coverage(),
      ratesAsAt: '2026-08-22',
      adviserId: 'adviser-jo',
      verified: true,
      surfaceClass: SOURCING_SURFACE_CLASS,
      productsAttachmentId: 'art_products',
      summary: summarizeProducts(products),
    } as const;
    expect(assertClaimable(lying)).toEqual({
      ok: false,
      reason: 'no-evidence',
    });
  });
});
