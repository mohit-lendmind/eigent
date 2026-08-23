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

// M5 (FR-002/003/004) — the PURE criteria rule engine. No browser, no login, no
// model: it is a coded evaluation of a pack's rules against case facts, and it
// is the honesty spine's first floor. Three invariants it can never break:
//
//   1. EXACTLY one result per FirmConfig.lenderPanel member (order preserved).
//   2. A fail/refer verdict ALWAYS carries >=1 reason naming the rule, the cited
//      text, the input value + its provenance, and the delta.
//   3. A syn/absent input, a policy rule, a stale rule, or a lender with no rules
//      NEVER passes silently — it degrades to 'refer' with a named reason. Only a
//      det input satisfying a hard comparison yields 'pass'.

import type {
  CriteriaAssessment,
  CriteriaLenderResult,
  CriteriaPack,
  CriteriaReason,
  CriteriaRule,
  InputProvenance,
  RuleKey,
  Verdict,
} from '../agentContracts/criteriaAffordability';
import { CRITERIA_SURFACE_CLASS } from '../agentContracts/criteriaAffordability';

// The case-fact key each rule reads. minTermYears/maxTermYears both read the
// single 'termYears' fact — the pack expresses the floor and ceiling as two
// rules over one input.
const RULE_FACT: Readonly<Record<RuleKey, string>> = {
  maxLTV: 'ltv',
  minIncome: 'incomePence',
  maxLTI: 'lti',
  adverseCreditPolicy: 'adverseCredit',
  employmentType: 'employmentType',
  minTermYears: 'termYears',
  maxTermYears: 'termYears',
  propertyType: 'propertyType',
};

interface ResolvedFact {
  present: boolean;
  value: string | number | null;
  provenance: InputProvenance;
}

// A case fact is either a bare primitive (treated as syn — unverified until a
// document proves it) or a typed `{ value, provenance }` carrying its M3 trust
// spine. Anything else (object without value, boolean, etc.) reads as absent.
function resolveFact(
  caseFacts: Record<string, unknown>,
  factKey: string
): ResolvedFact {
  const raw = caseFacts[factKey];
  if (raw === undefined || raw === null) {
    return { present: false, value: null, provenance: 'syn' };
  }
  if (typeof raw === 'string' || typeof raw === 'number') {
    return {
      present: true,
      value: typeof raw === 'number' && !Number.isFinite(raw) ? null : raw,
      provenance: 'syn',
    };
  }
  if (typeof raw === 'object') {
    const object = raw as Record<string, unknown>;
    const value = object.value;
    const provenance: InputProvenance =
      object.provenance === 'det' ? 'det' : 'syn';
    if (typeof value === 'string') return { present: true, value, provenance };
    if (typeof value === 'number' && Number.isFinite(value)) {
      return { present: true, value, provenance };
    }
    return { present: false, value: null, provenance };
  }
  return { present: false, value: null, provenance: 'syn' };
}

const DAY_MS = 86_400_000;

// A rule is stale when it was captured more than ttlDays before the pack's own
// asAt. Pure (the pack's asAt is the reference clock), so staleness is
// deterministic and re-computes identically on any machine.
function isStale(
  rule: CriteriaRule,
  packAsAt: string,
  ttlDays: number
): boolean {
  const ruleTime = Date.parse(rule.asAt);
  const packTime = Date.parse(packAsAt);
  if (!Number.isFinite(ruleTime) || !Number.isFinite(packTime)) return false;
  return (packTime - ruleTime) / DAY_MS > ttlDays;
}

function ruleValueText(value: CriteriaRule['value']): string {
  return Array.isArray(value) ? `[${[...value].join(', ')}]` : String(value);
}

interface RuleOutcome {
  verdict: Verdict;
  reason: CriteriaReason | null; // null only when a hard comparison passes
}

function evaluateRule(
  rule: CriteriaRule,
  caseFacts: Record<string, unknown>,
  packAsAt: string,
  ttlDays: number
): RuleOutcome {
  const fact = resolveFact(caseFacts, RULE_FACT[rule.key]);
  const base = { ruleKey: rule.key, citedText: rule.citedText } as const;

  // Stale first: we cannot trust the rule text, so degrade regardless of the
  // input. Never a silent fail on possibly-outdated criteria.
  if (isStale(rule, packAsAt, ttlDays)) {
    return {
      verdict: 'refer',
      reason: {
        ...base,
        inputValue: fact.value,
        inputProvenance: fact.provenance,
        delta: `rule captured ${rule.asAt} is older than the ${ttlDays}-day criteria window — referred`,
        stale: true,
      },
    };
  }

  // Absent input → refer, named.
  if (!fact.present) {
    return {
      verdict: 'refer',
      reason: {
        ...base,
        inputValue: null,
        inputProvenance: fact.provenance,
        delta: `no verified '${RULE_FACT[rule.key]}' on file — referred for manual check`,
      },
    };
  }

  // A synthetic (unverified) input can never satisfy a rule — refer, named.
  if (fact.provenance === 'syn') {
    return {
      verdict: 'refer',
      reason: {
        ...base,
        inputValue: fact.value,
        inputProvenance: 'syn',
        delta: `'${RULE_FACT[rule.key]}' is unverified (${ruleValueText(rule.value)} required) — referred`,
      },
    };
  }

  // A policy rule is a human judgement, never auto-decided — refer, named.
  if (rule.op === 'policy') {
    return {
      verdict: 'refer',
      reason: {
        ...base,
        inputValue: fact.value,
        inputProvenance: 'det',
        delta: `policy rule "${rule.citedText}" needs adviser judgement — referred`,
      },
    };
  }

  const fv = fact.value;
  const rv = rule.value;
  let pass = false;
  let comparable = true;
  switch (rule.op) {
    case 'lte':
      comparable = typeof fv === 'number' && typeof rv === 'number';
      pass = comparable && (fv as number) <= (rv as number);
      break;
    case 'gte':
      comparable = typeof fv === 'number' && typeof rv === 'number';
      pass = comparable && (fv as number) >= (rv as number);
      break;
    case 'eq':
      pass = fv === rv;
      break;
    case 'in':
      comparable = Array.isArray(rv);
      pass = comparable && (rv as readonly string[]).includes(String(fv));
      break;
    default:
      comparable = false;
  }

  if (!comparable) {
    return {
      verdict: 'refer',
      reason: {
        ...base,
        inputValue: fv,
        inputProvenance: 'det',
        delta: `'${RULE_FACT[rule.key]}' (${fv}) is not comparable to ${ruleValueText(rv)} for op '${rule.op}' — referred`,
      },
    };
  }

  if (pass) return { verdict: 'pass', reason: null };
  return {
    verdict: 'fail',
    reason: {
      ...base,
      inputValue: fv,
      inputProvenance: 'det',
      delta: `${RULE_FACT[rule.key]} ${fv} vs ${rule.op} ${ruleValueText(rv)}`,
    },
  };
}

const NOT_ASSESSED: CriteriaReason = {
  // No rule fired, so there is no natural RuleKey; 'adverseCreditPolicy' is the
  // pack's holistic/manual-judgement key and best connotes "needs an adviser".
  // The honest content lives in citedText + delta, not the key.
  ruleKey: 'adverseCreditPolicy',
  citedText: 'No criteria on file for this lender.',
  inputValue: null,
  inputProvenance: 'syn',
  delta: 'not assessed — lender not in the criteria pack',
};

function assessLender(
  lenderId: string,
  rules: readonly CriteriaRule[] | undefined,
  caseFacts: Record<string, unknown>,
  packAsAt: string,
  ttlDays: number
): CriteriaLenderResult {
  // A lender absent from the pack, or present with no rules, is NEVER a pass.
  if (rules === undefined || rules.length === 0) {
    return { lenderId, verdict: 'refer', reasons: [NOT_ASSESSED] };
  }
  const fails: CriteriaReason[] = [];
  const refers: CriteriaReason[] = [];
  for (const rule of rules) {
    const outcome = evaluateRule(rule, caseFacts, packAsAt, ttlDays);
    if (outcome.verdict === 'fail' && outcome.reason)
      fails.push(outcome.reason);
    else if (outcome.verdict === 'refer' && outcome.reason) {
      refers.push(outcome.reason);
    }
  }
  // A hard fail excludes; else any refer holds it back; else every rule passed.
  if (fails.length > 0) return { lenderId, verdict: 'fail', reasons: fails };
  if (refers.length > 0) return { lenderId, verdict: 'refer', reasons: refers };
  return { lenderId, verdict: 'pass', reasons: [] };
}

// FNV-1a over a canonical projection of the case facts → an 8-hex hash. Pure and
// order-independent (keys sorted) so the same facts always mint the same
// caseFactsHash and an assessment is reproducible.
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
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(object[k])}`).join(',')}}`;
}

export function hashCaseFacts(caseFacts: Record<string, unknown>): string {
  return `facts_${fnv1a(canonical(caseFacts))}`;
}

/**
 * Assess a criteria pack against case facts for a lender panel (FR-002/003/004).
 * PURE + deterministic. Emits exactly one result per panel member, in panel
 * order; every fail/refer carries >=1 named reason; nothing passes without a
 * verified (det) input satisfying a hard comparison.
 */
export function assessCriteria(
  pack: CriteriaPack,
  caseFacts: Record<string, unknown>,
  lenderPanel: readonly string[]
): CriteriaAssessment {
  const byLender = new Map<string, readonly CriteriaRule[]>();
  for (const l of pack.lenders) byLender.set(l.lenderId, l.rules);
  const results = lenderPanel.map((lenderId) =>
    assessLender(
      lenderId,
      byLender.get(lenderId),
      caseFacts,
      pack.asAt,
      pack.ttlDays
    )
  );
  return {
    kind: 'lm.criteria.assessment/1',
    caseId: '',
    packRef: pack.packRef,
    caseFactsHash: hashCaseFacts(caseFacts),
    surfaceClass: CRITERIA_SURFACE_CLASS,
    results,
  };
}
