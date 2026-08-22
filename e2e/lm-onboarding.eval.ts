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

// RUBRIC-ONLY harness — lm-onboarding draft quality (Journey 1, SC-001 rubric).
//
// The onboarding skill's whole risk surface is the DRAFT it writes: it must
// carry every disclosure the firm requires and must NOT stray into product,
// rate, or affordability claims (those are other agents' gates).
//
// NOT journey-coverage evidence (finding 13). By default this scores the
// hand-written RECORDED_DRAFT below, which is tautological — the fixture was
// written to pass the rubric. The GENUINE journey coverage — the same rubric run
// against the draft the SHIPPED buildOnboardingDraft actually produces — lives in
// test/unit/crm/journeyRubric.test.ts (and Journey 1 end-to-end in onboarding.test.ts),
// both of which CI runs. This file is a rubric harness you point at a LIVE capture:
// set EIGENT_ONBOARDING_DRAFT to a real lm-onboarding transcript to score it.
//
// Provenance of RECORDED_DRAFT: an illustrative purchase-case draft for the
// fixture firm config (disclosures IDD-2026, ESIS-terms, fee-agreement-v3); it
// mirrors buildOnboardingDraft's structure but is not a verbatim shipped output.
//
// Run: npx playwright test --config e2e/eval.config.ts lm-onboarding
// (The *.eval.ts suite is disjoint from the *.e2e.ts testMatch on purpose.)

import { expect, test } from '@playwright/test';
import fs from 'node:fs';

// The disclosures the fixture firm config requires. A draft missing any one of
// these is a regulatory defect.
const REQUIRED_DISCLOSURES = ['IDD-2026', 'ESIS-terms', 'fee-agreement-v3'];

// Phrases that mean the draft made a product/rate/affordability claim — the
// onboarding agent must never do this. Matched case-insensitively.
const FORBIDDEN_CLAIM_MARKERS = [
  'interest rate',
  'apr',
  'you can afford',
  'we recommend',
  'best deal',
  'lowest rate',
  'fixed rate of',
  'tracker at',
  'remortgage to',
];

// Documents a purchase onboarding must ask for. The draft has to name them so
// the client knows the ask.
const EXPECTED_CHECKLIST = [
  'Photo ID',
  'Proof of address',
  'Bank statements',
  'Memorandum of sale',
  'deposit',
];

// The RECORDED draft — a captured lm-onboarding output for a purchase case with
// the fixture firm config. Replace via EIGENT_ONBOARDING_DRAFT to score a live
// capture. This is the artifact under test, verbatim.
const RECORDED_DRAFT = [
  'Dear Ada Lovelace,',
  '',
  'Thank you for choosing us to help with your mortgage. This note confirms we',
  'have opened your case and sets out what we need to get started.',
  '',
  'To begin, please send us the following documents:',
  '  - Photo ID (passport or driving licence)',
  '  - Proof of address (last 3 months)',
  '  - Bank statements (last 3 months)',
  '  - Memorandum of sale',
  '  - Evidence of deposit funds',
  '',
  'The following regulatory disclosures apply to our service: IDD-2026,',
  'ESIS-terms, fee-agreement-v3.',
].join('\n');

function loadDraft(): string {
  const override = process.env.EIGENT_ONBOARDING_DRAFT;
  if (override && fs.existsSync(override)) {
    return fs.readFileSync(override, 'utf-8');
  }
  return RECORDED_DRAFT;
}

test('lm-onboarding draft: every disclosure present, no product claims', () => {
  const draft = loadDraft();
  const lowered = draft.toLowerCase();

  for (const disclosure of REQUIRED_DISCLOSURES) {
    expect(draft, `draft is missing disclosure ${disclosure}`).toContain(
      disclosure
    );
  }

  for (const marker of FORBIDDEN_CLAIM_MARKERS) {
    expect(
      lowered,
      `draft made a product/rate/affordability claim: "${marker}"`
    ).not.toContain(marker);
  }

  for (const item of EXPECTED_CHECKLIST) {
    expect(
      lowered,
      `draft did not request expected document: "${item}"`
    ).toContain(item.toLowerCase());
  }
});
