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

// M5 (SC-001/003) — P1 golden vectors + honesty-spine guards for the criteria
// engine, the pack + assessment decoders, and the assertIndicative choke-point.

import type { SourcingSnapshotPayload } from '@/crm/agentContracts';
import {
  decodeCriteriaAssessment,
  type AffordabilityAssessment,
  type CriteriaAssessment,
} from '@/crm/agentContracts/criteriaAffordability';
import { assertIndicative } from '@/crm/criteria/assertIndicative';
import { assessCriteria } from '@/crm/criteria/assess';
import { decodeCriteriaPack } from '@/crm/criteria/pack';
import {
  SYNTHETIC_CASE_FACTS,
  SYNTHETIC_CRITERIA_PACK,
  SYNTHETIC_EXPECTED,
  SYNTHETIC_LENDER_PANEL,
} from '@/crm/fixtures/criteriaPack';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const assessment = assessCriteria(
  SYNTHETIC_CRITERIA_PACK,
  SYNTHETIC_CASE_FACTS,
  SYNTHETIC_LENDER_PANEL
);
const byLender = new Map(assessment.results.map((r) => [r.lenderId, r]));

describe('assessCriteria — golden vectors (FR-002/003/004)', () => {
  it('emits exactly one result per panel member, in panel order', () => {
    expect(assessment.results.map((r) => r.lenderId)).toEqual([
      ...SYNTHETIC_LENDER_PANEL,
    ]);
  });

  it('lands the expected verdict for every synthetic lender', () => {
    for (const [lenderId, expected] of Object.entries(SYNTHETIC_EXPECTED)) {
      expect(
        byLender.get(lenderId)?.verdict,
        `${lenderId}: ${expected.because}`
      ).toBe(expected.verdict);
    }
  });

  it('every fail/refer carries >=1 reason with the full provenance shape', () => {
    for (const r of assessment.results) {
      if (r.verdict === 'pass') continue;
      expect(r.reasons.length).toBeGreaterThanOrEqual(1);
      for (const reason of r.reasons) {
        expect(typeof reason.ruleKey).toBe('string');
        expect(typeof reason.citedText).toBe('string');
        expect(reason.citedText.length).toBeGreaterThan(0);
        expect(['det', 'syn']).toContain(reason.inputProvenance);
        expect(typeof reason.delta).toBe('string');
      }
    }
  });

  it('a synthetic (unverified) input forces a named refer, value not null', () => {
    const fenwick = byLender.get('lender-fenwick');
    expect(fenwick?.verdict).toBe('refer');
    const reason = fenwick?.reasons[0];
    expect(reason?.inputProvenance).toBe('syn');
    expect(reason?.inputValue).not.toBeNull();
  });

  it('a stale rule degrades to refer with stale=true', () => {
    const harringside = byLender.get('lender-harringside');
    expect(harringside?.verdict).toBe('refer');
    expect(harringside?.reasons.some((r) => r.stale === true)).toBe(true);
  });

  it('a missing input refers with inputValue null', () => {
    const ironbridge = byLender.get('lender-ironbridge');
    expect(ironbridge?.verdict).toBe('refer');
    expect(ironbridge?.reasons[0]?.inputValue).toBeNull();
  });

  it('a lender with no rules is refer / not-assessed, never pass', () => {
    const kelmscott = byLender.get('lender-kelmscott');
    expect(kelmscott?.verdict).toBe('refer');
    expect(kelmscott?.reasons.length).toBeGreaterThanOrEqual(1);
  });

  it('is deterministic — same inputs give an identical assessment', () => {
    const again = assessCriteria(
      SYNTHETIC_CRITERIA_PACK,
      SYNTHETIC_CASE_FACTS,
      SYNTHETIC_LENDER_PANEL
    );
    expect(again).toEqual(assessment);
  });
});

describe('decodeCriteriaPack — closed schema (FR-001)', () => {
  const base = SYNTHETIC_CRITERIA_PACK;
  it('accepts the synthetic pack round-trip', () => {
    expect(decodeCriteriaPack(JSON.parse(JSON.stringify(base)))).toBeTruthy();
  });
  it('rejects an unknown RuleKey', () => {
    const bad = JSON.parse(JSON.stringify(base));
    bad.lenders[0].rules[0].key = 'maxMagic';
    expect(() => decodeCriteriaPack(bad)).toThrow(/RuleKey/);
  });
  it('rejects an unknown RuleOp', () => {
    const bad = JSON.parse(JSON.stringify(base));
    bad.lenders[0].rules[0].op = 'approx';
    expect(() => decodeCriteriaPack(bad)).toThrow(/RuleOp/);
  });
  it('rejects a rule missing citedText', () => {
    const bad = JSON.parse(JSON.stringify(base));
    delete bad.lenders[0].rules[0].citedText;
    expect(() => decodeCriteriaPack(bad)).toThrow(/citedText/);
  });
  it('rejects a rule missing asAt', () => {
    const bad = JSON.parse(JSON.stringify(base));
    delete bad.lenders[0].rules[0].asAt;
    expect(() => decodeCriteriaPack(bad)).toThrow(/asAt/);
  });
});

describe('decodeCriteriaAssessment — honesty invariants (FR-002)', () => {
  const good: CriteriaAssessment = { ...assessment, caseId: 'c417' };
  it('accepts a well-formed assessment and enforces panel coverage', () => {
    expect(
      decodeCriteriaAssessment(
        JSON.parse(JSON.stringify(good)),
        SYNTHETIC_LENDER_PANEL
      )
    ).toBeTruthy();
  });
  it('rejects a fail/refer verdict carrying no reason', () => {
    const bad = JSON.parse(JSON.stringify(good));
    const fail = bad.results.find((r) => r.verdict === 'fail');
    fail.reasons = [];
    expect(() => decodeCriteriaAssessment(bad)).toThrow(/at least one reason/);
  });
  it('rejects a non-adviser surfaceClass', () => {
    const bad = JSON.parse(JSON.stringify(good));
    bad.surfaceClass = 'client';
    expect(() => decodeCriteriaAssessment(bad)).toThrow(/adviser-only/);
  });
  it('rejects a result set that misses a panel member', () => {
    const bad = JSON.parse(JSON.stringify(good));
    bad.results.pop();
    expect(() => decodeCriteriaAssessment(bad, SYNTHETIC_LENDER_PANEL)).toThrow(
      /panel member|exactly one/
    );
  });
});

describe('assertIndicative — the choke-point (FR-007/008)', () => {
  const affordability: AffordabilityAssessment = {
    kind: 'lm.affordability.assessment/1',
    caseId: 'c417',
    indicative: true,
    surfaceClass: 'adviser-only',
    inputs: [],
    working: [],
    results: {
      maxBorrowPence: 1,
      monthlyAtRatePence: 1,
      monthlyAtStressPence: 1,
      stressRateBps: 700,
    },
  };
  const criteria: CriteriaAssessment = { ...assessment, caseId: 'c417' };

  it('passes an adviser-only, indicative payload', () => {
    expect(assertIndicative(criteria)).toEqual({ ok: true });
    expect(assertIndicative(affordability)).toEqual({ ok: true });
  });
  it('refuses a client-facing surface', () => {
    expect(assertIndicative(criteria, { surface: 'client' })).toEqual({
      ok: false,
      reason: 'client-surface',
    });
  });
  it('refuses a mistagged (wrong-surface) payload', () => {
    const bad = {
      ...criteria,
      surfaceClass: 'client',
    } as unknown as CriteriaAssessment;
    expect(assertIndicative(bad)).toEqual({
      ok: false,
      reason: 'wrong-surface',
    });
  });
  it('refuses a non-indicative affordability payload', () => {
    const bad = {
      ...affordability,
      indicative: false,
    } as unknown as AffordabilityAssessment;
    expect(assertIndicative(bad)).toEqual({
      ok: false,
      reason: 'not-indicative',
    });
  });
  it('refuses an affordability run when income is not G9-verified', () => {
    expect(assertIndicative(affordability, { g9Verified: false })).toEqual({
      ok: false,
      reason: 'g9-unverified',
    });
  });
  it('refuses when a referenced product is no longer claimable', () => {
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
    expect(assertIndicative(affordability, { product: staleProduct })).toEqual({
      ok: false,
      reason: 'stale-product',
    });
  });
});

describe('check-indicative-copy gate (FR-015)', () => {
  it('passes on the current M5 surface copy', () => {
    const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf-8',
    }).trim();
    expect(() =>
      execFileSync(
        'node',
        [path.join(repoRoot, 'scripts/check-indicative-copy.mjs')],
        {
          cwd: repoRoot,
          stdio: 'pipe',
        }
      )
    ).not.toThrow();
  });
});
