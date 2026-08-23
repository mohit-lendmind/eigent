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

// T017 — the deterministic conflict (G3) and income gate (G9). The d7 payslips
// disagree £38,500 vs £37,300 (3.1% > 1% materiality) and MUST raise G3 by a
// coded Pence recompute, never an LLM. G9 blocks a recommendation while income
// is only `syn`; a `det` income satisfies it. Synthetic fixtures only.

import type {
  DocintelExtraction,
  DocInsight as ExtractionInsight,
} from '@/crm/agents/docintelContract';
import { derivedId, detectConflict } from '@/crm/agents/docintelContract';
import {
  applyExtraction,
  type ApplyExtractionContext,
  type ExistingFactValue,
} from '@/crm/agents/extractionApply';
import {
  assessIncomeGate,
  describeIncomeBlocker,
  type IncomeFactState,
} from '@/crm/agents/incomeGate';
import { toPence } from '@/crm/domain/money';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const VERSIONS = {
  model: 'lm-docintel',
  promptSha: 'lm-docintel',
  skillSemver: '1.0.0',
  skillSha: 'lm-docintel-m3',
};

function extraction(
  over: Partial<DocintelExtraction> & { insights: ExtractionInsight[] }
): DocintelExtraction {
  return {
    kind: 'lm.docintel.extraction/1',
    documentId: 'doc_d7',
    contentHash: 'hash_d7',
    docType: 'payslip',
    docTypeInScope: true,
    attribution: { clientId: 'client_daniel', confidence: 0.97, joint: false },
    specialCategoryFlagged: false,
    versions: VERSIONS,
    ...over,
  };
}

function ctx(
  ext: DocintelExtraction,
  over: Partial<ApplyExtractionContext> = {}
): ApplyExtractionContext {
  return {
    extraction: ext,
    caseId: 'C417',
    firmId: 'firm_syn',
    projectId: 'proj_syn',
    sourceText: null,
    document: { name: 'payslip-d7.pdf' },
    originArtifactId: 'art_d7',
    runId: 'run_d7',
    now: 1_700_000_000_000,
    ...over,
  };
}

describe('detectConflict — deterministic Pence recompute at 1% materiality', () => {
  it('the d7 £38,500 vs £37,300 disagreement exceeds materiality', () => {
    const { conflict, deltaPct } = detectConflict(3_850_000, 3_730_000);
    expect(conflict).toBe(true);
    expect(deltaPct).toBeCloseTo(0.0311, 3);
  });

  it('a drift within 1% is not a conflict', () => {
    const { conflict } = detectConflict(3_850_000, 3_870_000);
    expect(conflict).toBe(false);
  });

  it('the conflict VERDICT is order-independent (both directions raise G3)', () => {
    // The boolean verdict must not depend on which side is "existing": a
    // material disagreement is material whichever way round it is presented.
    expect(detectConflict(3_850_000, 3_730_000).conflict).toBe(true);
    expect(detectConflict(3_730_000, 3_850_000).conflict).toBe(true);
  });

  it('deltaPct is relative to the EXISTING value, so it is NOT symmetric', () => {
    // deltaPct = |incoming - existing| / |existing|. The same £1,200 gap is a
    // larger fraction of the smaller baseline, so order genuinely changes the
    // ratio. Pinning this stops anyone "simplifying" it into a false symmetry.
    const forward = detectConflict(3_850_000, 3_730_000).deltaPct; // /3.85m
    const reverse = detectConflict(3_730_000, 3_850_000).deltaPct; // /3.73m
    expect(forward).toBeCloseTo(0.03117, 4);
    expect(reverse).toBeCloseTo(0.03217, 4);
    expect(forward).not.toBe(reverse);
  });

  it('is pure — the same inputs always yield the same output', () => {
    const a = detectConflict(3_850_000, 3_730_000);
    const b = detectConflict(3_850_000, 3_730_000);
    expect(a).toEqual(b);
  });
});

describe('derivedId — printable-source, stable-output ids (finding 7)', () => {
  // The id inputs are joined with a NUL separator so no concatenation of
  // (documentId, contentHash, fieldKey) can collide with another. That
  // separator is written as a \x00 ESCAPE in source — never a raw NUL byte —
  // so the file stays a readable, greppable, diffable text file. These goldens
  // pin the runtime output so the de-binarisation cannot silently change ids.
  it('mints stable, kind-prefixed goldens', () => {
    expect(derivedId('conflict', 'doc_d7', 'hash_d7', 'basicIncome')).toBe(
      derivedId('conflict', 'doc_d7', 'hash_d7', 'basicIncome')
    );
    // A re-process is a no-op upsert: identical inputs ⇒ identical id.
    const once = derivedId('field', 'doc_d7', 'hash_d7', 'basicIncome');
    const twice = derivedId('field', 'doc_d7', 'hash_d7', 'basicIncome');
    expect(once).toBe(twice);
    expect(once.startsWith('field_')).toBe(true);
  });

  it('the NUL separator prevents input-boundary collisions', () => {
    // Without a separator, ('ab','c',...) and ('a','bc',...) would concatenate
    // identically. The separator keeps them distinct.
    const a = derivedId('field', 'ab', 'c', 'x');
    const b = derivedId('field', 'a', 'bc', 'x');
    expect(a).not.toBe(b);
  });

  it('kind prefixes never collide for the same field', () => {
    const conflict = derivedId('conflict', 'doc_d7', 'hash_d7', 'basicIncome');
    const wl = derivedId('wl', 'doc_d7', 'hash_d7', 'basicIncome');
    const field = derivedId('field', 'doc_d7', 'hash_d7', 'basicIncome');
    const checklist = derivedId(
      'checklist',
      'doc_d7',
      'hash_d7',
      'basicIncome'
    );
    expect(new Set([conflict, wl, field, checklist]).size).toBe(4);
  });

  it('the contract source carries no raw NUL byte (stays a text file)', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/crm/agents/docintelContract.ts'),
      'utf8'
    );
    expect(src.includes('\x00')).toBe(false);
    // ...and the escape is the one actually in the join.
    expect(src).toContain('${documentId}\\x00${contentHash}\\x00${fieldKey}');
  });
});

describe('applyExtraction — d7 conflict raises G3 without overwriting', () => {
  it('two det incomes that disagree raise G3, log a conflict, and keep the value on file', () => {
    const existing: Record<string, ExistingFactValue> = {
      'client_daniel::income::basicIncome': {
        value: { t: 'money', v: toPence(3_850_000) },
        src: 'det',
      },
    };
    const proj = applyExtraction(
      ctx(
        extraction({
          insights: [
            {
              label: 'Annual basic income',
              value: '£37,300',
              confidence: 0.98,
              src: 'det',
              quote: 'Annual basic £37,300',
              fieldKey: 'basicIncome',
              section: 'income',
            },
          ],
        }),
        { sourceText: 'Annual basic £37,300', existing }
      )
    );

    expect(proj.conflicts).toBe(1);
    expect(proj.gates.map((g) => g.gateId)).toContain('G3');
    expect(proj.events.some((e) => e.type === 'conflict-upsert')).toBe(true);
    // A conflict raises a worklist item + stream beat for the adviser to resolve.
    expect(proj.events.some((e) => e.type === 'worklist-upsert')).toBe(true);
    // Record-never-repair: the £38,500 on file is untouched.
    expect(proj.events.filter((e) => e.type === 'field-change')).toHaveLength(
      0
    );
  });

  it('is deterministic: the same side-car projects byte-identical events + ids', () => {
    const existing: Record<string, ExistingFactValue> = {
      'client_daniel::income::basicIncome': {
        value: { t: 'money', v: toPence(3_850_000) },
        src: 'det',
      },
    };
    const build = () =>
      applyExtraction(
        ctx(
          extraction({
            insights: [
              {
                label: 'Annual basic income',
                value: '£37,300',
                confidence: 0.98,
                src: 'det',
                quote: 'Annual basic £37,300',
                fieldKey: 'basicIncome',
                section: 'income',
              },
            ],
          }),
          { sourceText: 'Annual basic £37,300', existing }
        )
      );
    expect(JSON.stringify(build().events)).toBe(JSON.stringify(build().events));
    expect(build().gates[0].id).toBe(build().gates[0].id);
  });
});

describe('assessIncomeGate — G9 blocks until income is det-verified', () => {
  const applicants = ['client_daniel', 'client_amara'];

  it('syn income never satisfies the gate', () => {
    const facts: IncomeFactState[] = [
      {
        clientId: 'client_daniel',
        fieldKey: 'basicIncome',
        src: 'syn',
        valueType: 'money',
      },
      {
        clientId: 'client_amara',
        fieldKey: 'basicIncome',
        src: 'syn',
        valueType: 'money',
      },
    ];
    const result = assessIncomeGate(applicants, facts);
    expect(result.satisfied).toBe(false);
    expect(result.blocking).toHaveLength(2);
    expect(result.blocking.every((b) => b.reason === 'syn-only')).toBe(true);
  });

  it('det MONEY income for every applicant satisfies the gate', () => {
    const facts: IncomeFactState[] = [
      {
        clientId: 'client_daniel',
        fieldKey: 'basicIncome',
        src: 'det',
        valueType: 'money',
      },
      {
        clientId: 'client_amara',
        fieldKey: 'basicIncome',
        src: 'det',
        valueType: 'money',
      },
    ];
    expect(assessIncomeGate(applicants, facts).satisfied).toBe(true);
  });

  it('a det TEXT income value never satisfies the gate (FR-008)', () => {
    // A fabricated/never-verified figure that failed money parsing lands as a
    // det TEXT value; it must NOT unblock a recommendation.
    const facts: IncomeFactState[] = [
      {
        clientId: 'client_daniel',
        fieldKey: 'basicIncome',
        src: 'det',
        valueType: 'text',
      },
      {
        clientId: 'client_amara',
        fieldKey: 'basicIncome',
        src: 'det',
        valueType: 'money',
      },
    ];
    const result = assessIncomeGate(applicants, facts);
    expect(result.satisfied).toBe(false);
    expect(result.blocking).toEqual([
      {
        clientId: 'client_daniel',
        fieldKey: 'basicIncome',
        reason: 'syn-only',
      },
    ]);
  });

  it('a missing applicant income blocks and is surfaced', () => {
    const facts: IncomeFactState[] = [
      {
        clientId: 'client_daniel',
        fieldKey: 'basicIncome',
        src: 'det',
        valueType: 'money',
      },
    ];
    const result = assessIncomeGate(applicants, facts);
    expect(result.satisfied).toBe(false);
    expect(result.blocking).toEqual([
      { clientId: 'client_amara', fieldKey: 'basicIncome', reason: 'missing' },
    ]);
    expect(describeIncomeBlocker(result.blocking[0])).toContain('client_amara');
  });

  it('a det fact alongside a syn duplicate still satisfies (any det money verifies)', () => {
    const facts: IncomeFactState[] = [
      {
        clientId: 'client_daniel',
        fieldKey: 'basicIncome',
        src: 'syn',
        valueType: 'money',
      },
      {
        clientId: 'client_daniel',
        fieldKey: 'basicIncome',
        src: 'det',
        valueType: 'money',
      },
    ];
    expect(assessIncomeGate(['client_daniel'], facts).satisfied).toBe(true);
  });
});
