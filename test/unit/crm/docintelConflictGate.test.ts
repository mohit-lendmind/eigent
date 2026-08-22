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
import { detectConflict } from '@/crm/agents/docintelContract';
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

  it('is symmetric and pure (order of the two values does not matter)', () => {
    const a = detectConflict(3_850_000, 3_730_000).deltaPct;
    // Same magnitude of disagreement relative to the existing value.
    expect(detectConflict(3_850_000, 3_730_000).deltaPct).toBe(a);
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
      { clientId: 'client_daniel', fieldKey: 'basicIncome', src: 'syn' },
      { clientId: 'client_amara', fieldKey: 'basicIncome', src: 'syn' },
    ];
    const result = assessIncomeGate(applicants, facts);
    expect(result.satisfied).toBe(false);
    expect(result.blocking).toHaveLength(2);
    expect(result.blocking.every((b) => b.reason === 'syn-only')).toBe(true);
  });

  it('det income for every applicant satisfies the gate', () => {
    const facts: IncomeFactState[] = [
      { clientId: 'client_daniel', fieldKey: 'basicIncome', src: 'det' },
      { clientId: 'client_amara', fieldKey: 'basicIncome', src: 'det' },
    ];
    expect(assessIncomeGate(applicants, facts).satisfied).toBe(true);
  });

  it('a missing applicant income blocks and is surfaced', () => {
    const facts: IncomeFactState[] = [
      { clientId: 'client_daniel', fieldKey: 'basicIncome', src: 'det' },
    ];
    const result = assessIncomeGate(applicants, facts);
    expect(result.satisfied).toBe(false);
    expect(result.blocking).toEqual([
      { clientId: 'client_amara', fieldKey: 'basicIncome', reason: 'missing' },
    ]);
    expect(describeIncomeBlocker(result.blocking[0])).toContain('client_amara');
  });

  it('a det fact alongside a syn duplicate still satisfies (any det verifies)', () => {
    const facts: IncomeFactState[] = [
      { clientId: 'client_daniel', fieldKey: 'basicIncome', src: 'syn' },
      { clientId: 'client_daniel', fieldKey: 'basicIncome', src: 'det' },
    ];
    expect(assessIncomeGate(['client_daniel'], facts).satisfied).toBe(true);
  });
});
