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

// FR-012 — the M3 runtime is the fact-find provenance source of truth for
// M4/M5, so every export in src/crm/agents/docintelContract.ts is pinned
// type-for-type against the FROZEN declaration in
// specs/004-mesh-m3-docintel/contracts/docintel.d.ts. The pin is type-level:
// each `pin<Frozen, Runtime>(true)` fails to compile if either side drifts, in
// either direction. A few runtime smoke assertions keep this a live vitest suite.

import * as rt from '@/crm/agents/docintelContract';
import { describe, expect, it } from 'vitest';

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

// ---- docintel.d.ts (types) -------------------------------------------------
pin<
  import('../../../specs/004-mesh-m3-docintel/contracts/docintel').DocInsight,
  rt.DocInsight
>(true);
pin<
  import('../../../specs/004-mesh-m3-docintel/contracts/docintel').DocintelExtraction,
  rt.DocintelExtraction
>(true);

// ---- docintel.d.ts (callables + const) -------------------------------------
pin<
  typeof import('../../../specs/004-mesh-m3-docintel/contracts/docintel').decodeDocintelExtraction,
  typeof rt.decodeDocintelExtraction
>(true);
pin<
  typeof import('../../../specs/004-mesh-m3-docintel/contracts/docintel').classifySrc,
  typeof rt.classifySrc
>(true);
pin<
  typeof import('../../../specs/004-mesh-m3-docintel/contracts/docintel').derivedId,
  typeof rt.derivedId
>(true);
pin<
  typeof import('../../../specs/004-mesh-m3-docintel/contracts/docintel').detectConflict,
  typeof rt.detectConflict
>(true);
pin<
  typeof import('../../../specs/004-mesh-m3-docintel/contracts/docintel').INGEST_MEDIA_MAX_BYTES,
  typeof rt.INGEST_MEDIA_MAX_BYTES
>(true);

describe('m3 contract freeze (FR-012)', () => {
  it('runtime exports the pinned callables and const', () => {
    expect(typeof rt.decodeDocintelExtraction).toBe('function');
    expect(typeof rt.classifySrc).toBe('function');
    expect(typeof rt.derivedId).toBe('function');
    expect(typeof rt.detectConflict).toBe('function');
    expect(rt.INGEST_MEDIA_MAX_BYTES).toBe(3_145_728);
  });

  it('the frozen invariants still hold at runtime', () => {
    // det iff the quote substring-matches an independent text layer.
    expect(rt.classifySrc('abc', 'xx abc yy')).toBe('det');
    expect(rt.classifySrc('abc', null)).toBe('syn');
    // derived ids are pure functions of (documentId, contentHash, fieldKey).
    expect(rt.derivedId('field', 'd', 'h', 'k')).toBe(
      rt.derivedId('field', 'd', 'h', 'k')
    );
    // 1% materiality recompute, never an LLM.
    expect(rt.detectConflict(100, 100).conflict).toBe(false);
    expect(rt.detectConflict(100, 200).conflict).toBe(true);
  });
});
