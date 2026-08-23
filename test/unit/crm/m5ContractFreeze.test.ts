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

// M5 (FR-001) — the M5 runtime exports are pinned against the FROZEN declarations
// in specs/006-mesh-m5-criteria-affordability/contracts/criteria-affordability.d.ts.
// The pin is type-level: each `pin<Frozen, Runtime>(true)` fails to compile if
// either side drifts, in either direction. Four runtime callables keep a
// deliberately-open seam without breaking the frozen contract — decodeCriteria
// Assessment (optional expected-panel), decodeScenarioRunPayload (optional cap),
// and assertIndicative (optional context) carry an extra optional arg on top of
// the frozen call site; a function of fewer params is assignable to one of more,
// so they stay mutually assignable. Runtime smoke assertions keep this a live
// (passing) suite.

import {
  computeAffordability,
  decodeAffordabilityAssessment,
} from '@/crm/affordability/calc';
import * as rt from '@/crm/agentContracts/criteriaAffordability';
import { assertIndicative } from '@/crm/criteria/assertIndicative';
import { assessCriteria } from '@/crm/criteria/assess';
import {
  applyDelta,
  diffScenarios,
  scenarioDerivedId,
} from '@/crm/criteria/counterfactual';
import { decodeCriteriaPack } from '@/crm/criteria/pack';
import { describe, expect, it } from 'vitest';
import type * as FZ from '../../../specs/006-mesh-m5-criteria-affordability/contracts/criteria-affordability';

// True only when A and B are assignable to each other — any drift collapses one
// arm to `never`, which fails the `true` argument.
type MutuallyAssignable<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : never
  : never;
function pin<A, B>(_proof: MutuallyAssignable<A, B>): void {
  void _proof;
}

// Value-namespace of the frozen module, for `typeof` on declared callables.
type FValue =
  typeof import('../../../specs/006-mesh-m5-criteria-affordability/contracts/criteria-affordability');

// ---- types (FZ is the frozen type-namespace) ----------------------------
pin<FZ.RuleKey, rt.RuleKey>(true);
pin<FZ.RuleOp, rt.RuleOp>(true);
pin<FZ.CriteriaRule, rt.CriteriaRule>(true);
pin<FZ.CriteriaPackLender, rt.CriteriaPackLender>(true);
pin<FZ.CriteriaPack, rt.CriteriaPack>(true);
pin<FZ.Verdict, rt.Verdict>(true);
pin<FZ.InputProvenance, rt.InputProvenance>(true);
pin<FZ.CriteriaReason, rt.CriteriaReason>(true);
pin<FZ.CriteriaLenderResult, rt.CriteriaLenderResult>(true);
pin<FZ.CriteriaAssessment, rt.CriteriaAssessment>(true);
pin<FZ.AffordabilityInput, rt.AffordabilityInput>(true);
pin<FZ.WorkingStep, rt.WorkingStep>(true);
pin<FZ.AffordabilityAssessment, rt.AffordabilityAssessment>(true);
pin<FZ.ScenarioDelta, rt.ScenarioDelta>(true);
pin<FZ.ScenarioResult, rt.ScenarioResult>(true);
pin<FZ.ScenarioDiff, rt.ScenarioDiff>(true);
pin<FZ.ScenarioRunPayload, rt.ScenarioRunPayload>(true);

// ---- decoders (optional-arg seam kept mutually assignable) --------------
pin<FValue['decodeCriteriaPack'], typeof decodeCriteriaPack>(true);
pin<FValue['decodeCriteriaAssessment'], typeof rt.decodeCriteriaAssessment>(
  true
);
pin<
  FValue['decodeAffordabilityAssessment'],
  typeof decodeAffordabilityAssessment
>(true);
pin<FValue['decodeScenarioRunPayload'], typeof rt.decodeScenarioRunPayload>(
  true
);

// ---- pure engines -------------------------------------------------------
pin<FValue['assessCriteria'], typeof assessCriteria>(true);
pin<FValue['computeAffordability'], typeof computeAffordability>(true);
pin<FValue['applyDelta'], typeof applyDelta>(true);
pin<FValue['diffScenarios'], typeof diffScenarios>(true);
pin<FValue['scenarioDerivedId'], typeof scenarioDerivedId>(true);

// ---- choke-point + const ------------------------------------------------
pin<FValue['assertIndicative'], typeof assertIndicative>(true);
pin<FValue['SCENARIO_CAP_DEFAULT'], typeof rt.SCENARIO_CAP_DEFAULT>(true);

describe('m5 contract freeze (FR-001)', () => {
  it('runtime modules export the pinned callables and constants', () => {
    expect(typeof rt.decodeCriteriaAssessment).toBe('function');
    expect(typeof rt.decodeScenarioRunPayload).toBe('function');
    expect(typeof decodeCriteriaPack).toBe('function');
    expect(typeof decodeAffordabilityAssessment).toBe('function');
    expect(typeof assessCriteria).toBe('function');
    expect(typeof computeAffordability).toBe('function');
    expect(typeof applyDelta).toBe('function');
    expect(typeof diffScenarios).toBe('function');
    expect(typeof scenarioDerivedId).toBe('function');
    expect(typeof assertIndicative).toBe('function');
    expect(rt.SCENARIO_CAP_DEFAULT).toBe(8);
  });
});
