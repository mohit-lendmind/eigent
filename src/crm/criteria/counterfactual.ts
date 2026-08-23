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

// M5 (FR-009/011) — the PURE counterfactual layer. applyDelta re-runs BOTH
// engines against a hypothetical ("what if the deposit were larger / the term
// longer / a second income added / a different rate"), WITHOUT mutating the base.
// diffScenarios reports the lender verdict flips and the max/monthly deltas.
// scenarioDerivedId makes a re-run idempotent: the same (packRef, caseFactsHash,
// deltaHash) always mints the same id AND the same outputs.
//
// The frozen ScenarioResult carries no pack/facts, so a runtime ScenarioResult
// also carries an optional `basis` (the pack + facts + inputs a re-run needs).
// It is an OPTIONAL extra field, so the frozen and runtime types stay mutually
// assignable and the freeze test is unaffected.

import { computeAffordability } from '../affordability/calc';
import type {
  AffordabilityInput,
  CriteriaPack,
  ScenarioDelta,
  ScenarioDiff,
  ScenarioResult,
  Verdict,
} from '../agentContracts/criteriaAffordability';
import { assessCriteria } from './assess';

// The re-run context a ScenarioResult carries so applyDelta can recompute from a
// hypothetical. Never serialized onto the folded payload — it is a runtime-only
// convenience for chaining counterfactuals.
export interface ScenarioBasis {
  pack: CriteriaPack;
  caseFacts: Record<string, unknown>;
  lenderPanel: readonly string[];
  affordabilityInputs: readonly AffordabilityInput[];
  stressRateBps: number;
  caseId: string;
}

export type ScenarioResultWithBasis = ScenarioResult & {
  basis?: ScenarioBasis;
};

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonical(object[k])}`)
    .join(',')}}`;
}

export function hashDelta(delta: ScenarioDelta | null): string {
  return `delta_${fnv1a(canonical(delta))}`;
}

/**
 * The scenario id: a pure function of (packRef, caseFactsHash, deltaHash)
 * (FR-011). Re-running the same hypothetical against the same pinned pack + facts
 * is idempotent — same id, same outputs.
 */
export function scenarioDerivedId(
  packRef: string,
  caseFactsHash: string,
  deltaHash: string
): string {
  return `scn_${fnv1a(`${packRef}\x00${caseFactsHash}\x00${deltaHash}`)}`;
}

const STRESS_BUFFER_TRACKS_RATE = true; // a rate delta shifts the stress rate 1:1

function factEntry(
  facts: Record<string, unknown>,
  key: string
): { value: unknown; provenance: string } | null {
  const raw = facts[key];
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    return { value: o.value, provenance: String(o.provenance ?? 'syn') };
  }
  return { value: raw, provenance: 'syn' };
}

function numFact(facts: Record<string, unknown>, key: string): number | null {
  const e = factEntry(facts, key);
  return typeof e?.value === 'number' && Number.isFinite(e.value)
    ? e.value
    : null;
}

// Build the hypothetical case facts by folding the delta over a CLONE of the
// base facts. Provenance of an adjusted existing fact is preserved (a what-if on
// a verified figure stays comparable); newly introduced facts are syn.
function deriveFacts(
  base: Record<string, unknown>,
  delta: ScenarioDelta,
  baseInputs: readonly AffordabilityInput[]
): Record<string, unknown> {
  const facts: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(base)) {
    facts[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...v } : v;
  }
  const setValue = (key: string, value: number) => {
    const existing = facts[key];
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
      facts[key] = { ...(existing as object), value };
    } else {
      facts[key] = { value, provenance: 'syn' };
    }
  };

  const propertyValue = numFact(facts, 'propertyValuePence');
  const deposit = delta.depositPence ?? numFact(facts, 'depositPence') ?? null;
  if (delta.depositPence !== undefined)
    setValue('depositPence', delta.depositPence);

  let annualIncome: number | null = null;
  if (delta.incomeMix) {
    annualIncome = Object.values(delta.incomeMix).reduce((a, b) => a + b, 0);
    setValue('incomePence', annualIncome);
  } else {
    annualIncome =
      numFact(facts, 'incomePence') ??
      baseInputs.find((i) => i.key === 'annualIncomePence')?.valuePence ??
      null;
  }

  let loan: number | null = null;
  if (propertyValue !== null && deposit !== null) {
    loan = Math.max(0, propertyValue - deposit);
    setValue('ltv', Math.round((loan / propertyValue) * 100));
  }
  if (loan !== null && annualIncome && annualIncome > 0) {
    setValue('lti', Math.round((loan / annualIncome) * 100) / 100);
  }
  if (delta.termYears !== undefined) setValue('termYears', delta.termYears);
  return facts;
}

function deriveInputs(
  base: readonly AffordabilityInput[],
  delta: ScenarioDelta
): { inputs: AffordabilityInput[]; stressShiftBps: number } {
  const inputs = base.map((i) => ({ ...i }));
  const set = (key: string, valuePence?: number, value?: number) => {
    const idx = inputs.findIndex((i) => i.key === key);
    const next: AffordabilityInput = {
      key,
      provenance: idx >= 0 ? inputs[idx].provenance : 'syn',
    };
    if (valuePence !== undefined) next.valuePence = valuePence;
    if (value !== undefined) next.value = value;
    if (idx >= 0) inputs[idx] = next;
    else inputs.push(next);
  };

  if (delta.incomeMix) {
    const annual = Object.values(delta.incomeMix).reduce((a, b) => a + b, 0);
    set('annualIncomePence', annual);
  }
  if (delta.termYears !== undefined)
    set('termYears', undefined, delta.termYears);

  let stressShiftBps = 0;
  if (delta.rateBps !== undefined) {
    const prev = base.find((i) => i.key === 'rateBps')?.value;
    const prevRate = typeof prev === 'number' ? prev : delta.rateBps;
    if (STRESS_BUFFER_TRACKS_RATE) stressShiftBps = delta.rateBps - prevRate;
    set('rateBps', undefined, delta.rateBps);
  }
  return { inputs, stressShiftBps };
}

/**
 * Build the base (delta=null) scenario from a pinned pack + case facts + panel +
 * affordability inputs. Carries the runtime `basis` so counterfactuals can chain.
 */
export function buildBaseScenario(
  basis: ScenarioBasis
): ScenarioResultWithBasis {
  const criteria = {
    ...assessCriteria(basis.pack, basis.caseFacts, basis.lenderPanel),
    caseId: basis.caseId,
  };
  const affordability = {
    ...computeAffordability(basis.affordabilityInputs, basis.stressRateBps),
    caseId: basis.caseId,
  };
  const scenarioId = scenarioDerivedId(
    basis.pack.packRef,
    criteria.caseFactsHash,
    hashDelta(null)
  );
  return { scenarioId, delta: null, criteria, affordability, basis };
}

/**
 * Re-run both engines against a hypothetical, WITHOUT mutating the base
 * (FR-009). The base must carry its runtime `basis` (buildBaseScenario / a prior
 * applyDelta produced it). The result carries the same basis so deltas chain.
 */
export function applyDelta(
  base: ScenarioResult,
  delta: ScenarioDelta
): ScenarioResult {
  const withBasis = base as ScenarioResultWithBasis;
  const basis = withBasis.basis;
  if (!basis) {
    throw new Error(
      'applyDelta: base scenario is missing its runtime basis (build it with buildBaseScenario)'
    );
  }
  const newFacts = deriveFacts(
    basis.caseFacts,
    delta,
    basis.affordabilityInputs
  );
  const { inputs, stressShiftBps } = deriveInputs(
    basis.affordabilityInputs,
    delta
  );
  const newStress = Math.max(0, basis.stressRateBps + stressShiftBps);

  const criteria = {
    ...assessCriteria(basis.pack, newFacts, basis.lenderPanel),
    caseId: basis.caseId,
  };
  const affordabilityBase = computeAffordability(inputs, newStress);
  const affordability = {
    ...affordabilityBase,
    caseId: basis.caseId,
    ...(delta.productSnapshotRef
      ? { productSnapshotRef: delta.productSnapshotRef }
      : {}),
  };
  const scenarioId = scenarioDerivedId(
    basis.pack.packRef,
    criteria.caseFactsHash,
    hashDelta(delta)
  );
  const nextBasis: ScenarioBasis = {
    ...basis,
    caseFacts: newFacts,
    affordabilityInputs: inputs,
    stressRateBps: newStress,
  };
  const out: ScenarioResultWithBasis = {
    scenarioId,
    delta,
    criteria,
    affordability,
    basis: nextBasis,
  };
  return out;
}

/**
 * Diff two scenarios (FR-009): which lenders flipped verdict, and the max-borrow
 * and monthly-at-rate deltas (b relative to a).
 */
export function diffScenarios(
  a: ScenarioResult,
  b: ScenarioResult
): ScenarioDiff {
  const aVerdict = new Map<string, Verdict>();
  for (const r of a.criteria.results) aVerdict.set(r.lenderId, r.verdict);
  const flips: { lenderId: string; from: Verdict; to: Verdict }[] = [];
  for (const r of b.criteria.results) {
    const from = aVerdict.get(r.lenderId);
    if (from !== undefined && from !== r.verdict) {
      flips.push({ lenderId: r.lenderId, from, to: r.verdict });
    }
  }
  return {
    lenderFlips: flips,
    maxBorrowDeltaPence:
      b.affordability.results.maxBorrowPence -
      a.affordability.results.maxBorrowPence,
    monthlyAtRateDeltaPence:
      b.affordability.results.monthlyAtRatePence -
      a.affordability.results.monthlyAtRatePence,
  };
}
