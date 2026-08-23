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

// M5 (FR-001) — the criteria-pack model + its strict decoder. A pack is
// adviser-curated criteria text (NOT a licensed feed): every rule quotes the
// lender's own words (citedText), points at where the adviser captured it
// (sourceRef — never a purchased-feed id), and stamps when (asAt). The decoder
// is closed: an unknown RuleKey / RuleOp, or a rule missing its cited text or
// capture date, throws rather than entering the assessment path unexplainable.
//
// packRef is a content-hash pin. An assessment records THIS ref, never "latest",
// so a later pack edit can never silently rewrite what a past assessment stood
// on (FR-011). computePackRef derives it purely from the rule set.

import type {
  CriteriaPack,
  CriteriaPackLender,
  CriteriaRule,
  RuleKey,
  RuleOp,
} from '../agentContracts/criteriaAffordability';
import {
  asRecord,
  ContractDecodeError,
  requireNumber,
  requireString,
} from '../agentContracts/errors';

const RULE_KEYS: readonly RuleKey[] = [
  'maxLTV',
  'minIncome',
  'maxLTI',
  'adverseCreditPolicy',
  'employmentType',
  'minTermYears',
  'maxTermYears',
  'propertyType',
];
const RULE_OPS: readonly RuleOp[] = ['lte', 'gte', 'eq', 'in', 'policy'];

function decodeRuleValue(
  value: unknown,
  label: string
): string | number | readonly string[] {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
    return value as readonly string[];
  }
  throw new ContractDecodeError(
    `${label}.value`,
    'must be a string, finite number, or string[]',
    value
  );
}

function decodeRule(value: unknown, label: string): CriteriaRule {
  const object = asRecord(value, label);
  const key = object.key;
  if (!RULE_KEYS.includes(key as RuleKey)) {
    throw new ContractDecodeError(
      `${label}.key`,
      `must be a known RuleKey (${RULE_KEYS.join('|')})`,
      key
    );
  }
  const op = object.op;
  if (!RULE_OPS.includes(op as RuleOp)) {
    throw new ContractDecodeError(
      `${label}.op`,
      `must be a known RuleOp (${RULE_OPS.join('|')})`,
      op
    );
  }
  return {
    key: key as RuleKey,
    op: op as RuleOp,
    value: decodeRuleValue(object.value, label),
    citedText: requireString(object, label, 'citedText'),
    sourceRef: requireString(object, label, 'sourceRef'),
    asAt: requireString(object, label, 'asAt'),
  };
}

function decodeLender(value: unknown, label: string): CriteriaPackLender {
  const object = asRecord(value, label);
  const lenderId = requireString(object, label, 'lenderId');
  if (!Array.isArray(object.rules)) {
    throw new ContractDecodeError(
      `${label}.rules`,
      'must be an array',
      object.rules
    );
  }
  const rules = object.rules.map((r, i) =>
    decodeRule(r, `${label}.rules[${i}]`)
  );
  return { lenderId, rules };
}

/**
 * Decode + validate an lm.criteria.pack/1. Rejects an unknown RuleKey/RuleOp and
 * any rule missing citedText/sourceRef/asAt so a pack can never enter assessment
 * with an unquoted or undatable rule (FR-001).
 */
export function decodeCriteriaPack(value: unknown): CriteriaPack {
  const object = asRecord(value, 'CriteriaPack');
  if (object.kind !== 'lm.criteria.pack/1') {
    throw new ContractDecodeError(
      'CriteriaPack.kind',
      "must be 'lm.criteria.pack/1'",
      object.kind
    );
  }
  const firmId = requireString(object, 'CriteriaPack', 'firmId');
  const packRef = requireString(object, 'CriteriaPack', 'packRef');
  const asAt = requireString(object, 'CriteriaPack', 'asAt');
  const ttlDays = requireNumber(object, 'CriteriaPack', 'ttlDays');
  if (!Number.isInteger(ttlDays) || ttlDays <= 0) {
    throw new ContractDecodeError(
      'CriteriaPack.ttlDays',
      'must be a positive integer (days)',
      ttlDays
    );
  }
  if (!Array.isArray(object.lenders)) {
    throw new ContractDecodeError(
      'CriteriaPack.lenders',
      'must be an array',
      object.lenders
    );
  }
  const lenders = object.lenders.map((l, i) =>
    decodeLender(l, `CriteriaPack.lenders[${i}]`)
  );
  return {
    kind: 'lm.criteria.pack/1',
    firmId,
    packRef,
    asAt,
    ttlDays,
    lenders,
  };
}

// FNV-1a over a canonical rule projection → an 8-hex content hash. Pure and
// sync, so the same rule set always mints the same ref (a content pin, not a
// mutable "latest"). packRef itself is excluded from the projection — it IS the
// output — so a pack can carry its own ref without a self-reference cycle.
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function canonicalRuleValue(v: string | number | readonly string[]): string {
  if (Array.isArray(v)) return `[${[...v].sort().join(',')}]`;
  return String(v);
}

/**
 * Derive the content-hash pin for a pack's rule set (FR-011). Lenders and their
 * rules are sorted into a canonical order first so an equivalent pack authored
 * in a different order mints the SAME ref.
 */
export function computePackRef(
  firmId: string,
  lenders: readonly CriteriaPackLender[]
): string {
  const canon = [...lenders]
    .sort((a, b) => a.lenderId.localeCompare(b.lenderId))
    .map((l) => {
      const rules = [...l.rules]
        .map(
          (r) =>
            `${r.key}\x1f${r.op}\x1f${canonicalRuleValue(r.value)}\x1f${r.citedText}\x1f${r.sourceRef}\x1f${r.asAt}`
        )
        .sort();
      return `${l.lenderId}\x1e${rules.join('\x1d')}`;
    })
    .join('\x1c');
  return `pack_${fnv1a(`${firmId}\x00${canon}`)}`;
}
