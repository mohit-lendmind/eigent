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

// M4 (FR-003) — the MSE connector canary. Two modes, one extractor:
//
//   • CI / offline (default): replay the SCRUBBED checked-in fixture
//     (e2e/fixtures/mse.fixture.json) through the PURE mseExtract and assert the
//     table is well-formed. This verifies the EXTRACTOR deterministically, with
//     no browser or network — the property that makes replay a real check.
//
//   • Nightly LIVE canary: point EIGENT_MSE_CAPTURE at a fresh capture recorded
//     from real MSE (the isolated window's console-fetch JSON, scrubbed). The
//     same extractor runs against it, proving the live page shape still matches.
//     A passing live run is what earns a canaryPassedAt — and ONLY a passing
//     live run may. This harness never writes verified:true and never invents a
//     canary timestamp: the checked-in fixture is illustrative, not a live
//     recording, so an offline pass is an extractor check, NOT a verification of
//     live MSE.
//
// Run: npx playwright test --config e2e/eval.config.ts connector-mse

import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mseExtract } from '../src/crm/connectors/adapters/mse';
import {
  decodeReplayFixture,
  hashFixture,
  replayExtract,
} from '../src/crm/connectors/replay/harness';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHECKED_IN_FIXTURE = path.resolve(HERE, 'fixtures/mse.fixture.json');

function loadFixtureText(): { text: string; live: boolean } {
  const override = process.env.EIGENT_MSE_CAPTURE;
  if (override && fs.existsSync(override)) {
    return { text: fs.readFileSync(override, 'utf-8'), live: true };
  }
  return { text: fs.readFileSync(CHECKED_IN_FIXTURE, 'utf-8'), live: false };
}

test('MSE connector: pure extract yields a well-formed best-buys table', () => {
  const { text, live } = loadFixtureText();
  const fixture = decodeReplayFixture(JSON.parse(text));

  const products = replayExtract(mseExtract, fixture);
  expect(products.length, 'MSE returned no rows').toBeGreaterThan(0);

  const eligible = products.filter((p) => p.status === 'eligible');
  expect(eligible.length, 'no eligible products').toBeGreaterThan(0);

  for (const p of products) {
    expect(p.lenderId, 'row missing lenderId').toBeTruthy();
    expect(p.productName, 'row missing productName').toBeTruthy();
    expect(p.rate, `row ${p.lenderId} has a non-positive rate`).toBeGreaterThan(
      0
    );
    if (p.status === 'declined') {
      expect(p.declineReason, 'declined row missing reason').toBeTruthy();
    }
  }

  // The fixture's content hash is the fixtureHash a VerificationRef would carry.
  const fixtureHash = hashFixture(fixture);
  expect(fixtureHash).toMatch(/^fnv1a64:/);

  if (live) {
    // A passing LIVE run is the only thing that earns a canaryPassedAt. Emitting
    // it here (for the nightly writer to consume) is honest ONLY because we got
    // here by extracting a real capture.
    console.log(
      JSON.stringify({
        mseCanary: 'passed',
        fixtureHash,
        ratesAsAt: fixture.ratesAsAt,
        canaryPassedAt: new Date().toISOString(),
      })
    );
  } else {
    // Offline: extractor verified, live MSE NOT verified. No canaryPassedAt.
    console.log(
      `MSE offline replay passed (extractor check only). fixtureHash=${fixtureHash}. ` +
        'Set EIGENT_MSE_CAPTURE to a real capture to run the live canary.'
    );
  }
});
