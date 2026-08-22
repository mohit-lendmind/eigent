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

// Frozen M3 — the fact-find provenance source for M4/M5 (FR-012). Additive to M1 artifactKinds.
export interface DocInsight {
  label: string;
  value: string;
  confidence: number;
  quote?: string;
  locator?: {
    page: number;
    line?: number;
    charStart?: number;
    charEnd?: number;
  };
  fieldKey?: string;
  section?: string;
  src: 'det' | 'syn'; // det ONLY if quote deterministically matched independent text; default flips to 'syn'
}
export interface DocintelExtraction {
  // lm.docintel.extraction/1 — SIDE-CAR, never a fold event kind
  kind: 'lm.docintel.extraction/1';
  documentId: string;
  contentHash: string;
  docType: string;
  docTypeInScope: boolean;
  attribution: { clientId: string | null; confidence: number; joint: boolean };
  insights: DocInsight[];
  specialCategoryFlagged: boolean; // Art 9 detected → flag, not silent-extract
  versions: {
    model: string;
    promptSha: string;
    skillSemver: string;
    skillSha: string;
  };
}
export declare function decodeDocintelExtraction(
  v: unknown
): DocintelExtraction;
/** det iff claimed quote substring-matches born-digital source text; else syn. No text layer ⇒ syn. */
export declare function classifySrc(
  quote: string | undefined,
  sourceText: string | null
): 'det' | 'syn';
/** All derived ids are pure functions of (documentId, contentHash, fieldKey) — re-processing is idempotent. */
export declare function derivedId(
  kind: 'conflict' | 'wl' | 'field' | 'checklist',
  documentId: string,
  contentHash: string,
  fieldKey: string
): string;
/** Deterministic Pence recompute at 1% materiality — never LLM-emitted. */
export declare function detectConflict(
  existingPence: number,
  incomingPence: number,
  materiality?: number
): { conflict: boolean; deltaPct: number };
export declare const INGEST_MEDIA_MAX_BYTES: 3_145_728;
