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

// M5 (FR-016) — a hand-tuned SYNTHETIC criteria pack: 12 fictional lenders, no
// real product / lender data. Curated so a single representative applicant lands
// at least one of every verdict, including a REFER forced by a synthetic
// (unverified) input, a REFER forced by a stale rule, a REFER on a missing
// input, a REFER on a policy rule, and a REFER for a lender with no rules. It
// drives the golden-vector tests, the eval corpus, and the demo.

import type {
  CriteriaPack,
  CriteriaPackLender,
} from '../agentContracts/criteriaAffordability';
import { computePackRef } from '../criteria/pack';

const PACK_AS_AT = '2026-08-01';
const FRESH = '2026-07-15'; // within the 180-day window
const STALE = '2025-01-01'; // older than 180 days before PACK_AS_AT
const FIRM_ID = 'lendmind';

const LENDERS: readonly CriteriaPackLender[] = [
  {
    lenderId: 'lender-aldergate',
    rules: [
      {
        key: 'maxLTV',
        op: 'lte',
        value: 80,
        citedText: 'Maximum LTV 80% for residential purchase.',
        sourceRef: 'pack:aldergate/ltv',
        asAt: FRESH,
      },
      {
        key: 'minIncome',
        op: 'gte',
        value: 3_000_000,
        citedText: 'Minimum gross income £30,000.',
        sourceRef: 'pack:aldergate/income',
        asAt: FRESH,
      },
      {
        key: 'employmentType',
        op: 'eq',
        value: 'employed',
        citedText: 'Employed applicants only on this range.',
        sourceRef: 'pack:aldergate/employment',
        asAt: FRESH,
      },
      {
        key: 'minTermYears',
        op: 'gte',
        value: 5,
        citedText: 'Minimum term 5 years.',
        sourceRef: 'pack:aldergate/term-min',
        asAt: FRESH,
      },
      {
        key: 'maxTermYears',
        op: 'lte',
        value: 40,
        citedText: 'Maximum term 40 years.',
        sourceRef: 'pack:aldergate/term-max',
        asAt: FRESH,
      },
    ],
  },
  {
    lenderId: 'lender-brookmere',
    rules: [
      {
        key: 'maxLTV',
        op: 'lte',
        value: 85,
        citedText: 'Up to 85% LTV.',
        sourceRef: 'pack:brookmere/ltv',
        asAt: FRESH,
      },
      {
        key: 'minIncome',
        op: 'gte',
        value: 2_000_000,
        citedText: 'Minimum income £20,000.',
        sourceRef: 'pack:brookmere/income',
        asAt: FRESH,
      },
    ],
  },
  {
    lenderId: 'lender-cavendish',
    rules: [
      {
        key: 'maxLTV',
        op: 'lte',
        value: 70,
        citedText: 'Conservative 70% LTV ceiling.',
        sourceRef: 'pack:cavendish/ltv',
        asAt: FRESH,
      },
    ],
  },
  {
    lenderId: 'lender-dunmore',
    rules: [
      {
        key: 'minIncome',
        op: 'gte',
        value: 10_000_000,
        citedText: 'Minimum gross income £100,000.',
        sourceRef: 'pack:dunmore/income',
        asAt: FRESH,
      },
    ],
  },
  {
    lenderId: 'lender-ellsworth',
    rules: [
      {
        key: 'employmentType',
        op: 'eq',
        value: 'self-employed',
        citedText: 'Self-employed specialist range only.',
        sourceRef: 'pack:ellsworth/employment',
        asAt: FRESH,
      },
    ],
  },
  {
    lenderId: 'lender-fenwick',
    rules: [
      {
        key: 'propertyType',
        op: 'in',
        value: ['house', 'bungalow'],
        citedText: 'Houses and bungalows only; flats excluded.',
        sourceRef: 'pack:fenwick/property',
        asAt: FRESH,
      },
    ],
  },
  {
    lenderId: 'lender-glenholt',
    rules: [
      {
        key: 'adverseCreditPolicy',
        op: 'policy',
        value: 'refer-all-adverse',
        citedText: 'All adverse credit referred to underwriting.',
        sourceRef: 'pack:glenholt/adverse',
        asAt: FRESH,
      },
    ],
  },
  {
    lenderId: 'lender-harringside',
    rules: [
      {
        key: 'maxLTV',
        op: 'lte',
        value: 90,
        citedText: 'Up to 90% LTV (high-LTV range).',
        sourceRef: 'pack:harringside/ltv',
        asAt: STALE,
      },
    ],
  },
  {
    lenderId: 'lender-ironbridge',
    rules: [
      {
        key: 'maxLTI',
        op: 'lte',
        value: 4.5,
        citedText: 'Loan-to-income capped at 4.5x.',
        sourceRef: 'pack:ironbridge/lti',
        asAt: FRESH,
      },
    ],
  },
  {
    lenderId: 'lender-jorvik',
    rules: [
      {
        key: 'minTermYears',
        op: 'gte',
        value: 10,
        citedText: 'Minimum term 10 years.',
        sourceRef: 'pack:jorvik/term-min',
        asAt: FRESH,
      },
      {
        key: 'maxTermYears',
        op: 'lte',
        value: 35,
        citedText: 'Maximum term 35 years.',
        sourceRef: 'pack:jorvik/term-max',
        asAt: FRESH,
      },
    ],
  },
  {
    // No rules on file — must read as refer / "not assessed", never pass.
    lenderId: 'lender-kelmscott',
    rules: [],
  },
  {
    lenderId: 'lender-lindquist',
    rules: [
      {
        key: 'maxTermYears',
        op: 'lte',
        value: 20,
        citedText: 'Maximum term 20 years.',
        sourceRef: 'pack:lindquist/term-max',
        asAt: FRESH,
      },
    ],
  },
];

export const SYNTHETIC_LENDER_PANEL: readonly string[] = LENDERS.map(
  (l) => l.lenderId
);

export const SYNTHETIC_CRITERIA_PACK: CriteriaPack = {
  kind: 'lm.criteria.pack/1',
  firmId: FIRM_ID,
  packRef: computePackRef(FIRM_ID, LENDERS),
  asAt: PACK_AS_AT,
  ttlDays: 180,
  lenders: LENDERS,
};

// The representative synthetic applicant. `lti` is deliberately OMITTED (drives
// ironbridge to a missing-input refer) and `propertyType` is deliberately
// synthetic/unverified (drives fenwick to a syn-forced refer). Every other fact
// is det-verified so the pass/fail lenders resolve on hard comparisons.
export const SYNTHETIC_CASE_FACTS: Record<string, unknown> = {
  ltv: { value: 75, provenance: 'det' },
  incomePence: { value: 6_000_000, provenance: 'det' },
  employmentType: { value: 'employed', provenance: 'det' },
  termYears: { value: 25, provenance: 'det' },
  adverseCredit: { value: 'none', provenance: 'det' },
  propertyType: { value: 'flat', provenance: 'syn' },
  propertyValuePence: { value: 30_000_000, provenance: 'det' },
  depositPence: { value: 7_500_000, provenance: 'det' },
};

// The expected verdict for each lender under SYNTHETIC_CASE_FACTS, with the
// reason it lands there — the known-answer key the eval corpus checks against.
export const SYNTHETIC_EXPECTED: Readonly<
  Record<string, { verdict: 'pass' | 'refer' | 'fail'; because: string }>
> = {
  'lender-aldergate': { verdict: 'pass', because: 'all det inputs satisfy' },
  'lender-brookmere': { verdict: 'pass', because: 'ltv + income satisfy' },
  'lender-cavendish': { verdict: 'fail', because: 'ltv 75 > cap 70' },
  'lender-dunmore': { verdict: 'fail', because: 'income below £100k floor' },
  'lender-ellsworth': {
    verdict: 'fail',
    because: 'employed vs self-employed only',
  },
  'lender-fenwick': {
    verdict: 'refer',
    because: 'propertyType is synthetic/unverified',
  },
  'lender-glenholt': {
    verdict: 'refer',
    because: 'policy rule needs underwriter',
  },
  'lender-harringside': {
    verdict: 'refer',
    because: 'rule is stale (past ttl)',
  },
  'lender-ironbridge': { verdict: 'refer', because: 'lti input missing' },
  'lender-jorvik': { verdict: 'pass', because: 'term 25 within 10..35' },
  'lender-kelmscott': { verdict: 'refer', because: 'no rules on file' },
  'lender-lindquist': { verdict: 'fail', because: 'term 25 > cap 20' },
};
