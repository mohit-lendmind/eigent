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

// M5 (FR-001/002/007) — the shared type spine for criteria + affordability, plus
// the two payload decoders (assessment + scenario run) that live at the leaf of
// the agentContracts layer so the pure engines (criteria/, affordability/) can
// import them without a cycle. These types mirror the FROZEN
// specs/006-mesh-m5-criteria-affordability/contracts/criteria-affordability.d.ts
// byte-for-byte; the freeze test (m5ContractFreeze) pins them.
//
// The surfaceClass is STRUCTURAL, not UI hiding: every criteria/affordability
// payload carries surfaceClass:'adviser-only', and assertIndicative refuses any
// other value. The no-client-embed CI test asserts no client-facing module
// decodes these symbols.

import { asRecord, ContractDecodeError, requireString } from './errors';

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
  citedText: string;
  sourceRef: string;
  asAt: string;
}
export interface CriteriaPackLender {
  lenderId: string;
  rules: readonly CriteriaRule[];
}
export interface CriteriaPack {
  kind: 'lm.criteria.pack/1';
  firmId: string;
  packRef: string;
  asAt: string;
  ttlDays: number;
  lenders: readonly CriteriaPackLender[];
}

// ---- A5: assessment ----
export type Verdict = 'pass' | 'refer' | 'fail';
export type InputProvenance = 'det' | 'syn';
export interface CriteriaReason {
  ruleKey: RuleKey;
  citedText: string;
  inputValue: string | number | null;
  inputProvenance: InputProvenance;
  delta: string;
  stale?: boolean;
}
export interface CriteriaLenderResult {
  lenderId: string;
  verdict: Verdict;
  reasons: readonly CriteriaReason[];
}
export interface CriteriaAssessment {
  kind: 'lm.criteria.assessment/1';
  caseId: string;
  packRef: string;
  caseFactsHash: string;
  surfaceClass: 'adviser-only';
  results: readonly CriteriaLenderResult[];
}

// ---- A6: affordability & stress ----
export interface AffordabilityInput {
  key: string;
  valuePence?: number;
  value?: string | number;
  provenance: InputProvenance;
  sourceRef?: string;
}
export interface WorkingStep {
  label: string;
  expression: string;
  resultPence?: number;
  note?: string;
}
export interface AffordabilityAssessment {
  kind: 'lm.affordability.assessment/1';
  caseId: string;
  indicative: true;
  surfaceClass: 'adviser-only';
  inputs: readonly AffordabilityInput[];
  working: readonly WorkingStep[];
  results: {
    maxBorrowPence: number;
    monthlyAtRatePence: number;
    monthlyAtStressPence: number;
    stressRateBps: number;
  };
  productSnapshotRef?: string;
}

// ---- counterfactuals + scenario runs ----
export interface ScenarioDelta {
  depositPence?: number;
  termYears?: number;
  incomeMix?: Record<string, number>;
  rateBps?: number;
  productSnapshotRef?: string;
}
export interface ScenarioResult {
  scenarioId: string;
  delta: ScenarioDelta | null;
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
  scenarioCount: number;
  surfaceClass: 'adviser-only';
  workingAttachmentId: string;
  summary: {
    passCountByScenario: readonly number[];
    topMaxBorrowPence: number;
  };
}

// Every M5 payload is adviser-only. A structural surfaceClass (not UI hiding) is
// what the no-client-embed CI test asserts against, and what assertIndicative
// refuses to override (FR-007/008).
export const CRITERIA_SURFACE_CLASS = 'adviser-only' as const;
export type CriteriaSurfaceClass = typeof CRITERIA_SURFACE_CLASS;

// The default counterfactual cap. A firm overrides it via FirmConfig.scenarioCap;
// the scenario agent enforces the effective cap BEFORE any write (FR-010).
export const SCENARIO_CAP_DEFAULT = 8 as const;

const VERDICTS: readonly Verdict[] = ['pass', 'refer', 'fail'];
function isVerdict(v: unknown): v is Verdict {
  return typeof v === 'string' && (VERDICTS as readonly string[]).includes(v);
}

function requireFiniteNumber(
  object: Record<string, unknown>,
  label: string,
  field: string
): number {
  const value = object[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ContractDecodeError(
      `${label}.${field}`,
      'must be a finite number',
      value
    );
  }
  return value;
}

function decodeReason(value: unknown, label: string): CriteriaReason {
  const object = asRecord(value, label);
  const ruleKey = requireString(object, label, 'ruleKey') as RuleKey;
  const citedText = requireString(object, label, 'citedText');
  const provenance = object.inputProvenance;
  if (provenance !== 'det' && provenance !== 'syn') {
    throw new ContractDecodeError(
      `${label}.inputProvenance`,
      "must be 'det' or 'syn'",
      provenance
    );
  }
  const rawInput = object.inputValue;
  if (
    rawInput !== null &&
    typeof rawInput !== 'string' &&
    typeof rawInput !== 'number'
  ) {
    throw new ContractDecodeError(
      `${label}.inputValue`,
      'must be a string, number, or null',
      rawInput
    );
  }
  const reason: CriteriaReason = {
    ruleKey,
    citedText,
    inputValue: rawInput as string | number | null,
    inputProvenance: provenance,
    delta: requireString(object, label, 'delta'),
  };
  if (object.stale !== undefined) {
    if (typeof object.stale !== 'boolean') {
      throw new ContractDecodeError(
        `${label}.stale`,
        'must be a boolean when present',
        object.stale
      );
    }
    reason.stale = object.stale;
  }
  return reason;
}

function decodeLenderResult(
  value: unknown,
  label: string
): CriteriaLenderResult {
  const object = asRecord(value, label);
  const lenderId = requireString(object, label, 'lenderId');
  if (!isVerdict(object.verdict)) {
    throw new ContractDecodeError(
      `${label}.verdict`,
      "must be 'pass', 'refer', or 'fail'",
      object.verdict
    );
  }
  if (!Array.isArray(object.reasons)) {
    throw new ContractDecodeError(
      `${label}.reasons`,
      'must be an array',
      object.reasons
    );
  }
  const reasons = object.reasons.map((r, i) =>
    decodeReason(r, `${label}.reasons[${i}]`)
  );
  // The honesty spine: a fail/refer with no reason would be an unexplained
  // exclusion. Only 'pass' may carry an empty reason list.
  if (object.verdict !== 'pass' && reasons.length === 0) {
    throw new ContractDecodeError(
      `${label}.reasons`,
      `a '${object.verdict}' verdict must carry at least one reason`,
      object.reasons
    );
  }
  return { lenderId, verdict: object.verdict, reasons };
}

/**
 * Decode + validate an lm.criteria.assessment/1 payload (FR-002). Enforces the
 * honesty invariant structurally: surfaceClass must be adviser-only, and every
 * non-pass verdict carries >=1 reason. When `expectedPanel` is supplied the
 * decoder also asserts EXACTLY one result per panel member (no gaps, no dupes,
 * no strays) — the optional second arg keeps the frozen one-arg call site
 * assignable.
 */
export function decodeCriteriaAssessment(
  value: unknown,
  expectedPanel?: readonly string[]
): CriteriaAssessment {
  const object = asRecord(value, 'CriteriaAssessment');
  if (object.kind !== 'lm.criteria.assessment/1') {
    throw new ContractDecodeError(
      'CriteriaAssessment.kind',
      "must be 'lm.criteria.assessment/1'",
      object.kind
    );
  }
  const caseId = requireString(object, 'CriteriaAssessment', 'caseId');
  const packRef = requireString(object, 'CriteriaAssessment', 'packRef');
  const caseFactsHash = requireString(
    object,
    'CriteriaAssessment',
    'caseFactsHash'
  );
  if (object.surfaceClass !== CRITERIA_SURFACE_CLASS) {
    throw new ContractDecodeError(
      'CriteriaAssessment.surfaceClass',
      `must be '${CRITERIA_SURFACE_CLASS}'`,
      object.surfaceClass
    );
  }
  if (!Array.isArray(object.results)) {
    throw new ContractDecodeError(
      'CriteriaAssessment.results',
      'must be an array',
      object.results
    );
  }
  const results = object.results.map((r, i) =>
    decodeLenderResult(r, `CriteriaAssessment.results[${i}]`)
  );
  if (expectedPanel !== undefined) {
    const seen = new Set<string>();
    for (const r of results) {
      if (seen.has(r.lenderId)) {
        throw new ContractDecodeError(
          'CriteriaAssessment.results',
          `duplicate result for lender '${r.lenderId}'`,
          r.lenderId
        );
      }
      seen.add(r.lenderId);
    }
    const panel = new Set(expectedPanel);
    if (results.length !== panel.size || seen.size !== panel.size) {
      throw new ContractDecodeError(
        'CriteriaAssessment.results',
        `must carry exactly one result per panel member (expected ${panel.size}, got ${results.length})`,
        results.map((r) => r.lenderId)
      );
    }
    for (const id of panel) {
      if (!seen.has(id)) {
        throw new ContractDecodeError(
          'CriteriaAssessment.results',
          `missing result for panel member '${id}'`,
          id
        );
      }
    }
  }
  return {
    kind: 'lm.criteria.assessment/1',
    caseId,
    packRef,
    caseFactsHash,
    surfaceClass: CRITERIA_SURFACE_CLASS,
    results,
  };
}

/**
 * Decode + validate an lm.scenario.run/1 folded summary (FR-010). The FULL
 * working rides as a referenced attachment (workingAttachmentId), never inline;
 * this decoder requires that pointer, the adviser id, the base ref, the summary,
 * and refuses any surfaceClass other than adviser-only. When `cap` is supplied
 * it also asserts scenarioCount stayed within the enforced cap.
 */
export function decodeScenarioRunPayload(
  value: unknown,
  cap?: number
): ScenarioRunPayload {
  const object = asRecord(value, 'ScenarioRunPayload');
  if (object.kind !== 'lm.scenario.run/1') {
    throw new ContractDecodeError(
      'ScenarioRunPayload.kind',
      "must be 'lm.scenario.run/1'",
      object.kind
    );
  }
  const caseId = requireString(object, 'ScenarioRunPayload', 'caseId');
  const adviserId = requireString(object, 'ScenarioRunPayload', 'adviserId');
  const baseRef = requireString(object, 'ScenarioRunPayload', 'baseRef');
  const scenarioCount = requireFiniteNumber(
    object,
    'ScenarioRunPayload',
    'scenarioCount'
  );
  if (!Number.isInteger(scenarioCount) || scenarioCount < 1) {
    throw new ContractDecodeError(
      'ScenarioRunPayload.scenarioCount',
      'must be a positive integer (>=1, base counts)',
      scenarioCount
    );
  }
  if (object.surfaceClass !== CRITERIA_SURFACE_CLASS) {
    throw new ContractDecodeError(
      'ScenarioRunPayload.surfaceClass',
      `must be '${CRITERIA_SURFACE_CLASS}'`,
      object.surfaceClass
    );
  }
  const workingAttachmentId = requireString(
    object,
    'ScenarioRunPayload',
    'workingAttachmentId'
  );
  if (cap !== undefined && scenarioCount > cap) {
    throw new ContractDecodeError(
      'ScenarioRunPayload.scenarioCount',
      `must not exceed the enforced cap of ${cap}`,
      scenarioCount
    );
  }
  const summaryObject = asRecord(object.summary, 'ScenarioRunPayload.summary');
  const rawPass = summaryObject.passCountByScenario;
  if (!Array.isArray(rawPass) || rawPass.some((n) => !Number.isFinite(n))) {
    throw new ContractDecodeError(
      'ScenarioRunPayload.summary.passCountByScenario',
      'must be an array of finite numbers',
      rawPass
    );
  }
  const summary = {
    passCountByScenario: rawPass as number[],
    topMaxBorrowPence: requireFiniteNumber(
      summaryObject,
      'ScenarioRunPayload.summary',
      'topMaxBorrowPence'
    ),
  };
  if (summary.passCountByScenario.length !== scenarioCount) {
    throw new ContractDecodeError(
      'ScenarioRunPayload.summary.passCountByScenario',
      `must carry one entry per scenario (expected ${scenarioCount})`,
      summary.passCountByScenario.length
    );
  }
  return {
    kind: 'lm.scenario.run/1',
    caseId,
    adviserId,
    baseRef,
    scenarioCount,
    surfaceClass: CRITERIA_SURFACE_CLASS,
    workingAttachmentId,
    summary,
  };
}
