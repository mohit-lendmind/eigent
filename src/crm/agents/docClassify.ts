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

// FR-005 — the coded scope backstop. The model classifies the document, but
// whether that type is in the DPIA's covered set is NOT a model judgement: it is
// membership in this frozen list. A document the DPIA does not cover is
// QUARANTINED (no fields extracted), even if the model claims docTypeInScope.
// This is the classification analogue of the det/syn trust spine — the write
// path never rounds up on the model's own scope claim.

/**
 * The exact document types the DPIA (docs/dpia-docintel.md) covers. Anything
 * outside this set is out of scope ⇒ quarantined. Kept in lockstep with the
 * skill's classify step and the DPIA retention table.
 */
export const DOCINTEL_INSCOPE_TYPES = [
  'payslip',
  'p60',
  'passport',
  'employment-contract',
  'bank-statement',
  'gift-letter',
  'accounts',
] as const;

export type DocintelDocType = (typeof DOCINTEL_INSCOPE_TYPES)[number];

const IN_SCOPE = new Set<string>(DOCINTEL_INSCOPE_TYPES);

// Fold common spellings/casing onto the canonical token so a "P60" or
// "Bank Statement" or "employment contract" still matches. Deliberately narrow:
// only whitespace/underscore→hyphen and case are normalised, never a fuzzy
// synonym, so an unrecognised type stays out of scope rather than being coerced
// in.
export function normaliseDocType(docType: string): string {
  return docType
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
}

/** True iff the (normalised) type is one the DPIA covers. */
export function isDocTypeInScope(docType: string): boolean {
  return IN_SCOPE.has(normaliseDocType(docType));
}

/**
 * The coded quarantine decision. A document is quarantined when EITHER the model
 * explicitly says out-of-scope OR the type is not in the covered set. Both
 * directions round toward quarantine — the safe side (FR-005).
 */
export function shouldQuarantine(
  docType: string,
  modelClaimsInScope: boolean
): boolean {
  return !modelClaimsInScope || !isDocTypeInScope(docType);
}
