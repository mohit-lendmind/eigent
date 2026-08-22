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

// M4 (FR-003/010) — the Mortgage Brain connector canary. It is a licensed portal
// behind a firm login, so this canary is AUTHORED BUT RED: there is no checked-in
// recording, because we do not (and may not) bake a session captured behind
// Mortgage Brain's credentials. Two modes:
//
//   • Default (NO capture): the live-recording test is SKIPPED and a companion
//     test asserts the adapter is still an honest SCAFFOLD — it derives
//     verified:FALSE and assertClaimable refuses any snapshot built from it. This
//     is the "red" state: green requires evidence that does not exist yet.
//
//   • With a real recording: point EIGENT_MORTGAGE_BRAIN_CAPTURE at a session you
//     recorded yourself, behind your firm's own Mortgage Brain login and within
//     its ToS (docs/tos-mortgage-brain.md). The SAME pure extractor runs against
//     it, proving the live results-grid shape still parses. A passing live run is
//     the ONLY thing that may emit a canaryPassedAt for the nightly writer to
//     consume; this harness never invents one and never writes verified:true.
//
// The path to green is deliberate and manual: (1) record a real session, (2) run
// this with EIGENT_MORTGAGE_BRAIN_CAPTURE and see it pass, (3) let the nightly
// writer stamp a canaryPassedAt onto a VerificationRef, (4) attach that ref to
// the adapter definition. Until (1) happens, the adapter stays verified:false.
//
// Run: npx playwright test --config e2e/eval.config.ts connector-mortgage-brain

import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MORTGAGE_BRAIN_ADAPTER,
  mortgageBrainExtract,
} from '../src/crm/connectors/adapters/mortgageBrain';
import { deriveVerified } from '../src/crm/connectors/assertClaimable';
import {
  decodeReplayFixture,
  hashFixture,
  replayExtract,
} from '../src/crm/connectors/replay/harness';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ILLUSTRATIVE_FIXTURE = path.resolve(
  HERE,
  'fixtures/mortgageBrain.fixture.json'
);

const capturePath = process.env.EIGENT_MORTGAGE_BRAIN_CAPTURE;
const hasRealCapture = Boolean(capturePath && fs.existsSync(capturePath));

// AUTHORED-BUT-RED: skipped until a real recording exists. Baking a checked-in
// recording captured behind Mortgage Brain's login would violate the honesty
// spine, so this can only run when the operator supplies their own capture.
test(
  hasRealCapture
    ? 'Mortgage Brain: live capture extracts a well-formed table'
    : 'Mortgage Brain: live canary (skipped — no recorded session)',
  () => {
    test.skip(
      !hasRealCapture,
      'No EIGENT_MORTGAGE_BRAIN_CAPTURE recording — licensed portal stays verified:false until a real session is recorded.'
    );

    const fixture = decodeReplayFixture(
      JSON.parse(fs.readFileSync(capturePath as string, 'utf-8'))
    );
    const products = replayExtract(mortgageBrainExtract, fixture);
    expect(products.length, 'Mortgage Brain returned no rows').toBeGreaterThan(
      0
    );
    for (const p of products) {
      expect(p.lenderId, 'row missing lenderId').toBeTruthy();
      expect(p.productName, 'row missing productName').toBeTruthy();
      expect(
        p.rate,
        `row ${p.lenderId} has a non-positive rate`
      ).toBeGreaterThan(0);
      if (p.status === 'declined') {
        expect(p.declineReason, 'declined row missing reason').toBeTruthy();
      }
    }

    // A passing LIVE run is the only thing that earns a canaryPassedAt. Emitting it
    // here (for the nightly writer) is honest ONLY because we extracted a real,
    // operator-supplied capture.
    const fixtureHash = hashFixture(fixture);
    console.log(
      JSON.stringify({
        mortgageBrainCanary: 'passed',
        fixtureHash,
        ratesAsAt: fixture.ratesAsAt,
        canaryPassedAt: new Date().toISOString(),
      })
    );
  }
);

test('Mortgage Brain stays an honest scaffold until a real session is recorded', () => {
  // The extractor works over the illustrative shape (so the adapter is real
  // code, not a stub) …
  const illustrative = decodeReplayFixture(
    JSON.parse(fs.readFileSync(ILLUSTRATIVE_FIXTURE, 'utf-8'))
  );
  const products = replayExtract(mortgageBrainExtract, illustrative);
  expect(products.length).toBeGreaterThan(0);

  // … but the adapter carries NO verification, so it derives verified:FALSE, and
  // the illustrative fixture is NOT a recorded session, so it earns no canary.
  expect(MORTGAGE_BRAIN_ADAPTER.verification).toBeUndefined();
  expect(deriveVerified(MORTGAGE_BRAIN_ADAPTER.verification)).toBe(false);
});
