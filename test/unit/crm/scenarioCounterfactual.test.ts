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

// M5 (SC-004) — the counterfactual layer + the scenario-run decoder. applyDelta
// must not mutate the base; diffScenarios must report lender flips and the
// max/monthly deltas; scenarioDerivedId must be a pure function of its inputs
// (same inputs → same id AND same outputs); decodeScenarioRunPayload must require
// the folded summary + attachment + adviser-only surface and honour the cap.

import type {
  AffordabilityInput,
  ScenarioDelta,
  ScenarioRunPayload,
} from '@/crm/agentContracts/criteriaAffordability';
import { decodeScenarioRunPayload } from '@/crm/agentContracts/criteriaAffordability';
import {
  applyDelta,
  buildBaseScenario,
  diffScenarios,
  scenarioDerivedId,
  type ScenarioBasis,
} from '@/crm/criteria/counterfactual';
import {
  SYNTHETIC_CASE_FACTS,
  SYNTHETIC_CRITERIA_PACK,
  SYNTHETIC_LENDER_PANEL,
} from '@/crm/fixtures/criteriaPack';
import { describe, expect, it } from 'vitest';

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

const BASIS: ScenarioBasis = {
  pack: SYNTHETIC_CRITERIA_PACK,
  caseFacts: SYNTHETIC_CASE_FACTS,
  lenderPanel: SYNTHETIC_LENDER_PANEL,
  affordabilityInputs: AFFORDABILITY_INPUTS,
  stressRateBps: 700,
  caseId: 'c417',
};

describe('applyDelta — pure counterfactual (FR-009)', () => {
  it('does not mutate the base scenario', () => {
    const base = buildBaseScenario(BASIS);
    const snapshot = JSON.stringify(base.criteria);
    applyDelta(base, { depositPence: 9_000_000 });
    expect(JSON.stringify(base.criteria)).toBe(snapshot);
  });

  it('a larger deposit lowers the LTV and flips a lender fail→pass', () => {
    const base = buildBaseScenario(BASIS);
    // Base: value 300k, deposit 75k → loan 225k → LTV 75, so cavendish (<=70)
    // FAILs. Deposit 90k → loan 210k → LTV 70, so cavendish now PASSes.
    const next = applyDelta(base, { depositPence: 9_000_000 });
    const diff = diffScenarios(base, next);
    const cavendish = diff.lenderFlips.find(
      (f) => f.lenderId === 'lender-cavendish'
    );
    expect(cavendish).toEqual({
      lenderId: 'lender-cavendish',
      from: 'fail',
      to: 'pass',
    });
  });

  it('a rate rise moves the max-borrow / monthly deltas', () => {
    const base = buildBaseScenario(BASIS);
    const next = applyDelta(base, { rateBps: 699 });
    const diff = diffScenarios(base, next);
    expect(typeof diff.maxBorrowDeltaPence).toBe('number');
    expect(typeof diff.monthlyAtRateDeltaPence).toBe('number');
    expect(Number.isFinite(diff.maxBorrowDeltaPence)).toBe(true);
  });

  it('throws if the base was not built with buildBaseScenario (no basis)', () => {
    const base = buildBaseScenario(BASIS);
    const stripped = {
      scenarioId: base.scenarioId,
      delta: base.delta,
      criteria: base.criteria,
      affordability: base.affordability,
    };
    expect(() => applyDelta(stripped, { termYears: 30 })).toThrow(/basis/);
  });
});

describe('scenarioDerivedId — pure + idempotent (FR-011)', () => {
  it('is a pure function of (packRef, caseFactsHash, deltaHash)', () => {
    expect(scenarioDerivedId('pack_a', 'facts_b', 'delta_c')).toBe(
      scenarioDerivedId('pack_a', 'facts_b', 'delta_c')
    );
    expect(scenarioDerivedId('pack_a', 'facts_b', 'delta_c')).not.toBe(
      scenarioDerivedId('pack_z', 'facts_b', 'delta_c')
    );
  });

  it('re-running the same delta yields the same id AND the same outputs', () => {
    const base = buildBaseScenario(BASIS);
    const delta: ScenarioDelta = { depositPence: 9_000_000 };
    const a = applyDelta(base, delta);
    const b = applyDelta(base, delta);
    expect(a.scenarioId).toBe(b.scenarioId);
    expect(a.criteria).toEqual(b.criteria);
    expect(a.affordability).toEqual(b.affordability);
  });
});

describe('decodeScenarioRunPayload — folded summary + cap (FR-010)', () => {
  const good: ScenarioRunPayload = {
    kind: 'lm.scenario.run/1',
    caseId: 'c417',
    adviserId: 'adv-1',
    baseRef: SYNTHETIC_CRITERIA_PACK.packRef,
    scenarioCount: 3,
    surfaceClass: 'adviser-only',
    workingAttachmentId: 'att-working-1',
    summary: { passCountByScenario: [3, 4, 2], topMaxBorrowPence: 27_000_000 },
  };

  it('round-trips a well-formed payload', () => {
    expect(
      decodeScenarioRunPayload(JSON.parse(JSON.stringify(good)))
    ).toBeTruthy();
  });

  it('rejects a non-adviser surfaceClass', () => {
    const bad = JSON.parse(JSON.stringify(good));
    bad.surfaceClass = 'client';
    expect(() => decodeScenarioRunPayload(bad)).toThrow(/adviser-only/);
  });

  it('rejects a missing working attachment (working must never be inline)', () => {
    const bad = JSON.parse(JSON.stringify(good));
    delete bad.workingAttachmentId;
    expect(() => decodeScenarioRunPayload(bad)).toThrow(/workingAttachmentId/);
  });

  it('rejects a pass-count list whose length is not the scenario count', () => {
    const bad = JSON.parse(JSON.stringify(good));
    bad.summary.passCountByScenario = [3, 4];
    expect(() => decodeScenarioRunPayload(bad)).toThrow(
      /one entry per scenario/
    );
  });

  it('rejects a scenario count over the enforced cap', () => {
    expect(() =>
      decodeScenarioRunPayload(JSON.parse(JSON.stringify(good)), 2)
    ).toThrow(/cap|scenarioCount/);
  });
});
