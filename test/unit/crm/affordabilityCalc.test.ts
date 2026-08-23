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

// M5 (SC-002) — golden vectors + honesty guards for the affordability engine and
// its writer. The number path is PURE integer pence: the vectors below are
// byte-exact, so a rounding or platform drift fails the suite. The writer tests
// pin the G9 income precondition and the assertIndicative choke-point.

import {
  computeAffordability,
  decodeAffordabilityAssessment,
} from '@/crm/affordability/calc';
import { writeAffordabilityAssessment } from '@/crm/affordability/writer';
import type { SourcingSnapshotPayload } from '@/crm/agentContracts';
import type { AffordabilityInput } from '@/crm/agentContracts/criteriaAffordability';
import type { IncomeFactState } from '@/crm/agents/incomeGate';
import { describe, expect, it } from 'vitest';

// A representative applicant: £60,000 income, £500/mo commitments, 25-year term,
// 4.99% product rate, 4.5x income multiple, stressed at 7.00%. All det, each
// carrying its M3 quote-locator so the writer accepts them.
const BASE_INPUTS: readonly AffordabilityInput[] = [
  {
    key: 'annualIncomePence',
    valuePence: 6_000_000,
    provenance: 'det',
    sourceRef: 'doc:payslip#p1:l4',
  },
  {
    key: 'monthlyCommitmentsPence',
    valuePence: 50_000,
    provenance: 'det',
    sourceRef: 'doc:bankstmt#p2:l9',
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
const STRESS_BPS = 700;

describe('computeAffordability — golden vectors (FR-005)', () => {
  const a = computeAffordability(BASE_INPUTS, STRESS_BPS);

  it('is stamped indicative + adviser-only, never a guaranteed max', () => {
    expect(a.indicative).toBe(true);
    expect(a.surfaceClass).toBe('adviser-only');
    expect(a.kind).toBe('lm.affordability.assessment/1');
  });

  it('caps max borrow at the lower of LTI and stressed affordability', () => {
    // LTI cap = £60,000 x 4.5 = £270,000 = 27,000,000 pence.
    // Stressed affordability backs a larger principal, so LTI binds here.
    expect(a.results.maxBorrowPence).toBe(27_000_000);
    expect(a.results.stressRateBps).toBe(700);
  });

  it('is byte-identical on a re-run (pure, cross-platform-deterministic)', () => {
    const again = computeAffordability(BASE_INPUTS, STRESS_BPS);
    expect(again).toEqual(a);
  });

  it('records the rounding rule + indicative note in working[]', () => {
    const notes = a.working.map((w) => w.note ?? '').join(' | ');
    expect(notes).toMatch(/round half-up/i);
    expect(notes).toMatch(/indicative only/i);
  });

  it('monthly at stress is >= monthly at product rate (conservative)', () => {
    expect(a.results.monthlyAtStressPence).toBeGreaterThanOrEqual(
      a.results.monthlyAtRatePence
    );
  });

  it('every result figure is a finite integer number of pence', () => {
    for (const v of Object.values(a.results)) {
      expect(Number.isFinite(v)).toBe(true);
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});

describe('computeAffordability — clamps + boundaries (FR-005)', () => {
  it('zero income yields a zero max borrow, never NaN', () => {
    const a = computeAffordability(
      [
        {
          key: 'annualIncomePence',
          valuePence: 0,
          provenance: 'det',
          sourceRef: 's',
        },
        { key: 'termYears', value: 25, provenance: 'det', sourceRef: 's' },
        { key: 'rateBps', value: 499, provenance: 'det', sourceRef: 's' },
        {
          key: 'incomeMultiple',
          value: 4.5,
          provenance: 'det',
          sourceRef: 's',
        },
      ],
      STRESS_BPS
    );
    expect(a.results.maxBorrowPence).toBe(0);
    expect(Number.isNaN(a.results.maxBorrowPence)).toBe(false);
  });

  it('commitments exceeding income clamp affordability to zero (negative delta)', () => {
    const a = computeAffordability(
      [
        {
          key: 'annualIncomePence',
          valuePence: 1_200_000,
          provenance: 'det',
          sourceRef: 's',
        },
        {
          key: 'monthlyCommitmentsPence',
          valuePence: 500_000,
          provenance: 'det',
          sourceRef: 's',
        },
        { key: 'termYears', value: 25, provenance: 'det', sourceRef: 's' },
        { key: 'rateBps', value: 499, provenance: 'det', sourceRef: 's' },
        {
          key: 'incomeMultiple',
          value: 4.5,
          provenance: 'det',
          sourceRef: 's',
        },
      ],
      STRESS_BPS
    );
    expect(a.results.maxBorrowPence).toBe(0);
    expect(a.results.monthlyAtRatePence).toBe(0);
  });

  it('a zero rate amortises linearly (P/n) with no divide-by-zero', () => {
    // Income tiny so the stressed-affordability path (not LTI) binds; at rate 0
    // and stress 0 the max principal is monthly-disposable x months.
    const a = computeAffordability(
      [
        {
          key: 'annualIncomePence',
          valuePence: 1_200_000,
          provenance: 'det',
          sourceRef: 's',
        },
        { key: 'termYears', value: 25, provenance: 'det', sourceRef: 's' },
        { key: 'rateBps', value: 0, provenance: 'det', sourceRef: 's' },
        {
          key: 'incomeMultiple',
          value: 100,
          provenance: 'det',
          sourceRef: 's',
        },
      ],
      0
    );
    // monthly disposable = 1,200,000/12 = 100,000; x 300 months = 30,000,000.
    expect(a.results.maxBorrowPence).toBe(30_000_000);
  });

  it('missing term / rate never produces NaN', () => {
    const a = computeAffordability(
      [
        {
          key: 'annualIncomePence',
          valuePence: 6_000_000,
          provenance: 'det',
          sourceRef: 's',
        },
      ],
      STRESS_BPS
    );
    for (const v of Object.values(a.results)) {
      expect(Number.isNaN(v)).toBe(false);
    }
  });
});

describe('decodeAffordabilityAssessment — indicative spine (FR-005)', () => {
  const good = {
    ...computeAffordability(BASE_INPUTS, STRESS_BPS),
    caseId: 'c1',
  };
  it('round-trips a well-formed assessment', () => {
    expect(
      decodeAffordabilityAssessment(JSON.parse(JSON.stringify(good)))
    ).toBeTruthy();
  });
  it('rejects indicative:false (a claimed guaranteed max)', () => {
    const bad = JSON.parse(JSON.stringify(good));
    bad.indicative = false;
    expect(() => decodeAffordabilityAssessment(bad)).toThrow(/indicative/);
  });
  it('rejects a non-adviser surfaceClass', () => {
    const bad = JSON.parse(JSON.stringify(good));
    bad.surfaceClass = 'client';
    expect(() => decodeAffordabilityAssessment(bad)).toThrow(/adviser-only/);
  });
});

// ---- writer: G9 precondition + choke-point (FR-006/007) -----------------

const DET_INCOME: readonly IncomeFactState[] = [
  {
    clientId: 'app-1',
    fieldKey: 'basicIncome',
    src: 'det',
    valueType: 'money',
  },
];
const SYN_INCOME: readonly IncomeFactState[] = [
  {
    clientId: 'app-1',
    fieldKey: 'basicIncome',
    src: 'syn',
    valueType: 'money',
  },
];

describe('writeAffordabilityAssessment — G9 precondition (FR-006)', () => {
  it('writes an indicative assessment when income is det-verified', () => {
    const out = writeAffordabilityAssessment({
      caseId: 'c1',
      inputs: BASE_INPUTS,
      stressRateBps: STRESS_BPS,
      income: { applicants: ['app-1'], facts: DET_INCOME },
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.assessment.caseId).toBe('c1');
      expect(out.assessment.indicative).toBe(true);
    }
  });

  it('blocks the run when income is only syn, and NAMES the blocking step', () => {
    const out = writeAffordabilityAssessment({
      caseId: 'c1',
      inputs: BASE_INPUTS,
      stressRateBps: STRESS_BPS,
      income: { applicants: ['app-1'], facts: SYN_INCOME },
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe('g9-unverified');
      expect(out.blocking?.[0]).toMatchObject({
        clientId: 'app-1',
        fieldKey: 'basicIncome',
        reason: 'syn-only',
      });
      expect(out.blockingSteps?.[0]).toMatch(/app-1/);
      expect(out.blockingSteps?.[0]).toMatch(/basicIncome/);
    }
  });

  it('blocks when income is missing entirely', () => {
    const out = writeAffordabilityAssessment({
      caseId: 'c1',
      inputs: BASE_INPUTS,
      stressRateBps: STRESS_BPS,
      income: { applicants: ['app-1'], facts: [] },
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe('g9-unverified');
      expect(out.blocking?.[0]?.reason).toBe('missing');
    }
  });
});

describe('writeAffordabilityAssessment — choke-point routing (FR-007)', () => {
  it('refuses a client-facing surface', () => {
    const out = writeAffordabilityAssessment({
      caseId: 'c1',
      inputs: BASE_INPUTS,
      stressRateBps: STRESS_BPS,
      income: { applicants: ['app-1'], facts: DET_INCOME },
      surface: 'client',
    });
    expect(out).toEqual({ ok: false, reason: 'client-surface' });
  });

  it('refuses a run referencing a stale (unclaimable) product snapshot', () => {
    const staleProduct: SourcingSnapshotPayload = {
      adapterId: 'mse',
      coverage: {
        kind: 'mse-best-buys',
        statement: 'MSE best buys',
        wholeOfMarket: false,
      },
      ratesAsAt: '2020-01-01',
      adviserId: 'adv-1',
      verified: false,
      surfaceClass: 'adviser-only',
      productsAttachmentId: 'att-1',
      summary: { total: 1, eligible: 1, declined: 0, topTrueCostPence: 1 },
    };
    const out = writeAffordabilityAssessment({
      caseId: 'c1',
      inputs: BASE_INPUTS,
      stressRateBps: STRESS_BPS,
      income: { applicants: ['app-1'], facts: DET_INCOME },
      product: staleProduct,
    });
    expect(out).toEqual({ ok: false, reason: 'stale-product' });
  });

  it('throws when a det input is missing its M3 quote-locator', () => {
    expect(() =>
      writeAffordabilityAssessment({
        caseId: 'c1',
        inputs: [
          {
            key: 'annualIncomePence',
            valuePence: 6_000_000,
            provenance: 'det',
          },
        ],
        stressRateBps: STRESS_BPS,
        income: { applicants: ['app-1'], facts: DET_INCOME },
      })
    ).toThrow(/quote-locator|sourceRef/);
  });
});
