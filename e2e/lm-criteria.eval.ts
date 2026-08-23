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

// KNOWN-ANSWER eval corpus — A5 criteria + A6 affordability (FR-016 / SC-001).
//
// SYNTHETIC DATA ONLY. The corpus is the hand-tuned 12-lender fixture pack + the
// representative synthetic applicant. Its known-answer key is SYNTHETIC_EXPECTED
// in the fixture: each lender's expected verdict AND the reason it lands there,
// including a syn-forced refer (fenwick), a stale-rule refer (harringside), a
// missing-input refer (ironbridge), a policy refer (glenholt), and a no-rules
// refer (kelmscott). No real lender criteria and no real client PII appear here.
//
// The two properties this corpus proves are the honesty spine's load-bearing
// promises, re-derived here as an INDEPENDENT second opinion over the engine's
// output (not a call back into the surface):
//   1. WHY-NOT COMPLETENESS — every excluded panel lender (verdict !== pass)
//      carries at least one structured reason (ruleKey + citedText + provenance).
//   2. INDICATIVE-LABEL PRESENCE — every A6/criteria output the engine can emit,
//      base and counterfactual, is surfaceClass:'adviser-only' and the
//      affordability figure is indicative:true. Nothing is ever a lender decision
//      or a guaranteed maximum.
//
// Run: npx playwright test --config e2e/eval.config.ts lm-criteria

import { expect, test } from '@playwright/test';
import type {
  AffordabilityInput,
  ScenarioResult,
} from '../src/crm/agentContracts/criteriaAffordability';
import { CRITERIA_SURFACE_CLASS } from '../src/crm/agentContracts/criteriaAffordability';
import {
  applyDelta,
  buildBaseScenario,
} from '../src/crm/criteria/counterfactual';
import {
  SYNTHETIC_CASE_FACTS,
  SYNTHETIC_CRITERIA_PACK,
  SYNTHETIC_EXPECTED,
  SYNTHETIC_LENDER_PANEL,
} from '../src/crm/fixtures/criteriaPack';

const AFFORDABILITY_INPUTS: readonly AffordabilityInput[] = [
  {
    key: 'annualIncomePence',
    valuePence: 6_000_000,
    provenance: 'det',
    sourceRef: 'doc:payslip',
  },
  { key: 'termYears', value: 25, provenance: 'det', sourceRef: 'app:term' },
  { key: 'rateBps', value: 499, provenance: 'det', sourceRef: 'product:rate' },
  {
    key: 'incomeMultiple',
    value: 4.5,
    provenance: 'det',
    sourceRef: 'product:lti',
  },
];

function base(): ScenarioResult {
  return buildBaseScenario({
    pack: SYNTHETIC_CRITERIA_PACK,
    caseFacts: SYNTHETIC_CASE_FACTS,
    lenderPanel: SYNTHETIC_LENDER_PANEL,
    affordabilityInputs: AFFORDABILITY_INPUTS,
    stressRateBps: 700,
    caseId: 'c417',
  });
}

test('lm-criteria: known-answer — every lender lands its expected verdict', () => {
  const { criteria } = base();
  // The corpus covers the whole panel — one result per panel lender.
  expect(criteria.results.length).toBe(SYNTHETIC_LENDER_PANEL.length);

  // Every verdict class is represented, so the corpus is not degenerate.
  const verdicts = new Set(criteria.results.map((r) => r.verdict));
  expect([...verdicts].sort()).toEqual(['fail', 'pass', 'refer']);

  for (const r of criteria.results) {
    const expected = SYNTHETIC_EXPECTED[r.lenderId];
    expect(expected, `no known answer for ${r.lenderId}`).toBeTruthy();
    expect(
      r.verdict,
      `${r.lenderId}: expected ${expected.verdict} (${expected.because}), got ${r.verdict}`
    ).toBe(expected.verdict);
  }
});

test('lm-criteria: why-not completeness — no excluded lender is silent', () => {
  const { criteria } = base();
  for (const r of criteria.results) {
    if (r.verdict === 'pass') continue;
    expect(
      r.reasons.length,
      `${r.lenderId} is ${r.verdict} but carries no reason`
    ).toBeGreaterThan(0);
    for (const reason of r.reasons) {
      // A reason is only useful if it names the rule, cites the text, and shows
      // what input drove it — the audit needs all three.
      expect(
        reason.ruleKey,
        `${r.lenderId}: reason missing ruleKey`
      ).toBeTruthy();
      expect(
        typeof reason.citedText,
        `${r.lenderId}: reason missing citedText`
      ).toBe('string');
      expect(
        ['det', 'syn'].includes(reason.inputProvenance),
        `${r.lenderId}: reason has no input provenance`
      ).toBe(true);
    }
  }
});

test('lm-criteria: a syn/missing input forces a NAMED refer (never a silent pass)', () => {
  const { criteria } = base();
  // fenwick refers on a synthetic propertyType; ironbridge on a missing lti.
  const fenwick = criteria.results.find((r) => r.lenderId === 'lender-fenwick');
  expect(fenwick?.verdict).toBe('refer');
  expect(fenwick?.reasons.some((x) => x.inputProvenance === 'syn')).toBe(true);

  const ironbridge = criteria.results.find(
    (r) => r.lenderId === 'lender-ironbridge'
  );
  expect(ironbridge?.verdict).toBe('refer');
  // A missing input is signalled by a null inputValue on the named reason.
  expect(ironbridge?.reasons.some((x) => x.inputValue === null)).toBe(true);

  // A lender with no rules on file reads refer / not-assessed, never pass.
  const kelmscott = criteria.results.find(
    (r) => r.lenderId === 'lender-kelmscott'
  );
  expect(kelmscott?.verdict).toBe('refer');
});

test('lm-criteria: indicative-label presence on every A6 output (base + counterfactuals)', () => {
  const b = base();
  const outputs: ScenarioResult[] = [
    b,
    applyDelta(b, { depositPence: 9_000_000 }),
    applyDelta(b, { rateBps: 699 }),
    applyDelta(b, { termYears: 35 }),
  ];

  for (const s of outputs) {
    // Criteria is adviser-only, structurally.
    expect(s.criteria.surfaceClass).toBe(CRITERIA_SURFACE_CLASS);
    expect(s.criteria.surfaceClass).toBe('adviser-only');
    // Affordability is indicative + adviser-only, and carries its full working.
    expect(s.affordability.indicative).toBe(true);
    expect(s.affordability.surfaceClass).toBe('adviser-only');
    expect(s.affordability.working.length).toBeGreaterThan(0);
    // The figure is a number of pence, never a guaranteed maximum.
    expect(Number.isFinite(s.affordability.results.maxBorrowPence)).toBe(true);
  }
});

test('lm-criteria: counterfactual is idempotent — same delta, same id + outputs', () => {
  const b = base();
  const a1 = applyDelta(b, { depositPence: 9_000_000 });
  const a2 = applyDelta(b, { depositPence: 9_000_000 });
  expect(a1.scenarioId).toBe(a2.scenarioId);
  expect(a1.affordability.results.maxBorrowPence).toBe(
    a2.affordability.results.maxBorrowPence
  );
  expect(a1.criteria.caseFactsHash).toBe(a2.criteria.caseFactsHash);
});
