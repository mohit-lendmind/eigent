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

// FR-006/010 — deterministic attribution + special-category detection. The
// model reads names / National Insurance numbers / addresses off the document;
// deciding WHICH applicant that is, and how confident to be, is a coded cluster
// here — not a model judgement. Ambiguity (< 0.85 or a joint document) yields a
// low/ambiguous score so the write path raises G2. A document that touches
// Article 9 signals is flagged, never silently folded into ordinary fields.

// The National-Insurance-number match is the strongest signal (a personal
// identifier), so it dominates; name + address corroborate.
const NI_WEIGHT = 0.7;
const NAME_WEIGHT = 0.2;
const ADDRESS_WEIGHT = 0.1;

/** Identifiers read off ONE document, to be matched against the case roster. */
export interface DocIdentifiers {
  fullName?: string;
  niNumber?: string;
  postcode?: string;
}

/** One applicant on the case, with the identifiers we hold on file. */
export interface ApplicantIdentity {
  clientId: string;
  fullName?: string;
  niNumber?: string;
  postcode?: string;
}

export interface AttributionScore {
  clientId: string | null;
  confidence: number;
  joint: boolean;
}

function normName(value: string | undefined): string {
  if (!value) return '';
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

// NI numbers compare on their alphanumerics only (case- and space-insensitive),
// so "AB 12 34 56 C" and "ab123456c" are the same identifier.
function normNi(value: string | undefined): string {
  if (!value) return '';
  return value.replace(/[^a-z0-9]/gi, '').toUpperCase();
}

function normPostcode(value: string | undefined): string {
  if (!value) return '';
  return value.replace(/\s+/g, '').toUpperCase();
}

// Score one applicant against the document identifiers. Each signal contributes
// only when BOTH sides carry it and they match exactly — a missing field never
// scores, so a sparse document yields low confidence (⇒ G2), never a false high.
function scoreOne(doc: DocIdentifiers, who: ApplicantIdentity): number {
  let score = 0;
  const docNi = normNi(doc.niNumber);
  if (docNi.length > 0 && docNi === normNi(who.niNumber)) score += NI_WEIGHT;

  const docName = normName(doc.fullName);
  if (docName.length > 0 && docName === normName(who.fullName)) {
    score += NAME_WEIGHT;
  }

  const docPc = normPostcode(doc.postcode);
  if (docPc.length > 0 && docPc === normPostcode(who.postcode)) {
    score += ADDRESS_WEIGHT;
  }
  return score;
}

/**
 * Deterministically attribute a document to one applicant. Returns the best
 * match and its confidence; `joint` is set when two applicants score within a
 * whisker of each other (the document does not distinguish them) or when the
 * caller already knows it is a joint document. A null/empty roster, or no
 * signal at all, yields `{ clientId: null, confidence: 0 }` ⇒ G2.
 */
export function scoreAttribution(
  doc: DocIdentifiers,
  roster: readonly ApplicantIdentity[],
  opts: { knownJoint?: boolean } = {}
): AttributionScore {
  const scored = roster
    .map((who) => ({ clientId: who.clientId, score: scoreOne(doc, who) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score === 0) {
    return { clientId: null, confidence: 0, joint: opts.knownJoint ?? false };
  }

  const runnerUp = scored[1]?.score ?? 0;
  // Two applicants the document cannot tell apart ⇒ treat as joint/ambiguous.
  const ambiguous = runnerUp > 0 && best.score - runnerUp < NAME_WEIGHT;
  const joint = (opts.knownJoint ?? false) || ambiguous;

  return {
    clientId: joint ? null : best.clientId,
    confidence: joint ? Math.min(best.score, 0.5) : best.score,
    joint,
  };
}

// Article 9 special-category signals a bank statement can incidentally reveal:
// health (pharmacy/clinic), religion (place of worship), trade-union dues,
// political donations. Deliberately a small, auditable keyword set — a match
// FLAGS for human review; it never suppresses the transaction or infers a trait.
const SPECIAL_CATEGORY_PATTERNS: readonly RegExp[] = [
  /\bpharmac(y|ies)\b/i,
  /\bchemist\b/i,
  /\bclinic\b/i,
  /\bhospital\b/i,
  /\bgp surgery\b/i,
  /\bchurch\b/i,
  /\bmosque\b/i,
  /\bsynagogue\b/i,
  /\btemple\b/i,
  /\bgurdwara\b/i,
  /\bplace of worship\b/i,
  /\btrade union\b/i,
  /\bunion (dues|subscription)\b/i,
  /\bpolitical (party|donation)\b/i,
  /\blabour party\b/i,
  /\bconservative party\b/i,
];

/**
 * Coded special-category detection over free text (a statement line, an insight
 * value). A single hit is enough to FLAG (FR-010) — the write path then raises a
 * review note rather than folding the datum into an ordinary field.
 */
export function detectSpecialCategory(texts: readonly string[]): boolean {
  return texts.some((text) =>
    SPECIAL_CATEGORY_PATTERNS.some((re) => re.test(text))
  );
}
