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

// Frozen M5 — criteria + affordability reasoning core. Engines are PURE/deterministic
// (no browser/login/model). Money is integer pence, no float. Outputs are indicative
// and adviser-only; assertIndicative is THE choke-point. Additive to M1-M4 contracts.

// ---- A5: criteria pack (adviser-curated; NOT a licensed DB) ----
export type RuleKey =
  | 'maxLTV'
  | 'minIncome'
  | 'maxLTI'
  | 'adverseCreditPolicy'
  | 'employmentType'
  | 'minTermYears'
  | 'maxTermYears'
  | 'propertyType';
export type RuleOp = 'lte' | 'gte' | 'eq' | 'in' | 'policy';
export interface CriteriaRule {
  key: RuleKey;
  op: RuleOp;
  value: string | number | readonly string[];
  citedText: string; // the lender's criteria text, quoted as-is
  sourceRef: string; // adviser/pack pointer — never a purchased-feed id
  asAt: string; // ISO date the criteria text was captured
}
export interface CriteriaPackLender {
  lenderId: string;
  rules: readonly CriteriaRule[];
}
export interface CriteriaPack {
  kind: 'lm.criteria.pack/1';
  firmId: string;
  packRef: string; // content-hash pin — an assessment records THIS, never "latest"
  asAt: string;
  ttlDays: number; // a rule older than this degrades its verdict to 'refer'
  lenders: readonly CriteriaPackLender[];
}

// ---- A5: assessment ----
export type Verdict = 'pass' | 'refer' | 'fail';
export type InputProvenance = 'det' | 'syn';
export interface CriteriaReason {
  ruleKey: RuleKey;
  citedText: string;
  inputValue: string | number | null; // null ⇒ input syn/absent ⇒ verdict 'refer'
  inputProvenance: InputProvenance;
  delta: string; // human + machine-readable, e.g. "LTI 4.6 vs cap 4.5"
  stale?: boolean; // rule asAt past ttl ⇒ degraded to 'refer'
}
export interface CriteriaLenderResult {
  lenderId: string;
  verdict: Verdict;
  reasons: readonly CriteriaReason[]; // fail/refer MUST carry >=1; not-assessed ⇒ 'refer'
}
export interface CriteriaAssessment {
  kind: 'lm.criteria.assessment/1';
  caseId: string;
  packRef: string;
  caseFactsHash: string;
  surfaceClass: 'adviser-only';
  results: readonly CriteriaLenderResult[]; // EXACTLY one per FirmConfig.lenderPanel member
}

// ---- A6: affordability & stress (indicative; full working; pence-exact) ----
export interface AffordabilityInput {
  key: string;
  valuePence?: number; // money is integer pence; non-money inputs use `value`
  value?: string | number;
  provenance: InputProvenance;
  sourceRef?: string; // M3 quote-locator ref where det
}
export interface WorkingStep {
  label: string;
  expression: string;
  resultPence?: number;
  note?: string; // e.g. rounding rule applied
}
export interface AffordabilityAssessment {
  kind: 'lm.affordability.assessment/1';
  caseId: string;
  indicative: true; // NEVER a guaranteed max (MCOB 11.6.2R)
  surfaceClass: 'adviser-only';
  inputs: readonly AffordabilityInput[];
  working: readonly WorkingStep[]; // full working retained for suitability/SAR
  results: {
    maxBorrowPence: number; // clamped >= 0, never NaN
    monthlyAtRatePence: number;
    monthlyAtStressPence: number;
    stressRateBps: number; // basis points — integer, no float
  };
  productSnapshotRef?: string; // M4 lm.sourcing.snapshot/1 if a real product was used
}

// ---- counterfactuals + scenario runs ----
export interface ScenarioDelta {
  depositPence?: number;
  termYears?: number;
  incomeMix?: Record<string, number>; // pence per source
  rateBps?: number;
  productSnapshotRef?: string;
}
export interface ScenarioResult {
  scenarioId: string; // pure fn of (packRef, caseFactsHash, deltaHash)
  delta: ScenarioDelta | null; // null = base scenario
  criteria: CriteriaAssessment;
  affordability: AffordabilityAssessment;
}
export interface ScenarioDiff {
  lenderFlips: readonly { lenderId: string; from: Verdict; to: Verdict }[];
  maxBorrowDeltaPence: number;
  monthlyAtRateDeltaPence: number;
}
export interface ScenarioRunPayload {
  kind: 'lm.scenario.run/1';
  caseId: string;
  adviserId: string;
  baseRef: string;
  scenarioCount: number; // <= firm-config cap (default 8)
  surfaceClass: 'adviser-only';
  workingAttachmentId: string; // full set rides as an attachment, NOT inline
  summary: {
    passCountByScenario: readonly number[];
    topMaxBorrowPence: number;
  };
}

// ---- decoders (additive to M1 artifactKinds; validate payload, not just spine) ----
export declare function decodeCriteriaPack(v: unknown): CriteriaPack;
export declare function decodeCriteriaAssessment(
  v: unknown
): CriteriaAssessment;
export declare function decodeAffordabilityAssessment(
  v: unknown
): AffordabilityAssessment;
export declare function decodeScenarioRunPayload(
  v: unknown
): ScenarioRunPayload;

// ---- pure engines (LLM-free; deterministic; integer-pence) ----
export declare function assessCriteria(
  pack: CriteriaPack,
  caseFacts: Record<string, unknown>,
  lenderPanel: readonly string[]
): CriteriaAssessment;
export declare function computeAffordability(
  inputs: readonly AffordabilityInput[],
  stressRateBps: number
): AffordabilityAssessment;
export declare function applyDelta(
  base: ScenarioResult,
  delta: ScenarioDelta
): ScenarioResult;
export declare function diffScenarios(
  a: ScenarioResult,
  b: ScenarioResult
): ScenarioDiff;

// ---- derived id (mirrors M3 derivedId): re-run is idempotent ----
export declare function scenarioDerivedId(
  packRef: string,
  caseFactsHash: string,
  deltaHash: string
): string;

/** THE choke-point: every criteria/affordability surface + export MUST call this;
 * enforced in the writer/fold, not UI hiding. */
export declare function assertIndicative(
  payload: CriteriaAssessment | AffordabilityAssessment
):
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'client-surface'
        | 'not-indicative'
        | 'g9-unverified'
        | 'wrong-surface'
        | 'stale-product';
    };

export declare const SCENARIO_CAP_DEFAULT: 8;
