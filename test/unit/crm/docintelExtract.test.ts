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

// T013 — classification, coded extraction trust, and attribution (G2). Pins the
// deterministic P2 helpers plus their behaviour through the write path: a det
// fact needs a verified quote, a vision-only document is syn, ambiguous
// attribution fires G2, and Article 9 data is flagged. Synthetic fixtures only.

import {
  detectSpecialCategory,
  scoreAttribution,
  type ApplicantIdentity,
} from '@/crm/agents/attribution';
import {
  isDocTypeInScope,
  normaliseDocType,
  shouldQuarantine,
} from '@/crm/agents/docClassify';
import type {
  DocintelExtraction,
  DocInsight as ExtractionInsight,
} from '@/crm/agents/docintelContract';
import {
  applyExtraction,
  type ApplyExtractionContext,
} from '@/crm/agents/extractionApply';
import { describe, expect, it } from 'vitest';

describe('docClassify — coded scope backstop', () => {
  it('folds casing/spacing/underscores onto the canonical token', () => {
    expect(normaliseDocType('P60')).toBe('p60');
    expect(normaliseDocType('Bank Statement')).toBe('bank-statement');
    expect(normaliseDocType('employment_contract')).toBe('employment-contract');
  });

  it('recognises exactly the DPIA-covered set', () => {
    for (const t of [
      'payslip',
      'P60',
      'passport',
      'employment contract',
      'bank statement',
      'gift letter',
      'accounts',
    ]) {
      expect(isDocTypeInScope(t)).toBe(true);
    }
    expect(isDocTypeInScope('lottery-ticket')).toBe(false);
    expect(isDocTypeInScope('utility bill')).toBe(false);
  });

  it('quarantines when the model OR the coded scope says out-of-scope', () => {
    // In scope + model agrees ⇒ keep.
    expect(shouldQuarantine('payslip', true)).toBe(false);
    // Model claims in-scope but the type is not covered ⇒ still quarantine.
    expect(shouldQuarantine('lottery-ticket', true)).toBe(true);
    // In-scope type but the model flagged out-of-scope ⇒ quarantine.
    expect(shouldQuarantine('payslip', false)).toBe(true);
  });
});

describe('attribution — deterministic cluster', () => {
  const roster: ApplicantIdentity[] = [
    {
      clientId: 'client_daniel',
      fullName: 'Daniel Okoro',
      niNumber: 'AB123456C',
      postcode: 'SW1A 1AA',
    },
    {
      clientId: 'client_amara',
      fullName: 'Amara Okoro',
      niNumber: 'CD654321B',
      postcode: 'SW1A 1AA',
    },
  ];

  it('an exact NI match is a confident, single-applicant attribution', () => {
    const score = scoreAttribution(
      {
        fullName: 'Daniel Okoro',
        niNumber: 'ab 12 34 56 c',
        postcode: 'SW1A1AA',
      },
      roster
    );
    expect(score.clientId).toBe('client_daniel');
    expect(score.joint).toBe(false);
    expect(score.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('a name+postcode that fits two applicants equally is ambiguous ⇒ joint', () => {
    // Only the shared surname + shared postcode; no NI to disambiguate.
    const score = scoreAttribution(
      { fullName: 'Okoro', postcode: 'SW1A 1AA' },
      roster
    );
    expect(score.joint).toBe(true);
    expect(score.clientId).toBeNull();
    expect(score.confidence).toBeLessThan(0.85);
  });

  it('no matching signal yields a null, zero-confidence score ⇒ G2', () => {
    const score = scoreAttribution(
      { fullName: 'Someone Else', niNumber: 'ZZ999999Z' },
      roster
    );
    expect(score.clientId).toBeNull();
    expect(score.confidence).toBe(0);
  });

  it('an empty roster never fabricates an attribution', () => {
    const score = scoreAttribution({ niNumber: 'AB123456C' }, []);
    expect(score.clientId).toBeNull();
    expect(score.confidence).toBe(0);
  });

  it('a caller-known joint document is always joint', () => {
    const score = scoreAttribution(
      { fullName: 'Daniel Okoro', niNumber: 'AB123456C' },
      roster,
      { knownJoint: true }
    );
    expect(score.joint).toBe(true);
    expect(score.clientId).toBeNull();
  });
});

describe('detectSpecialCategory — Article 9 signals', () => {
  it('flags health / religion / union / political signals', () => {
    expect(detectSpecialCategory(['BOOTS PHARMACY LONDON'])).toBe(true);
    expect(detectSpecialCategory(['Standing order: St Marys Church'])).toBe(
      true
    );
    expect(detectSpecialCategory(['UNISON trade union dues'])).toBe(true);
    expect(detectSpecialCategory(['Donation to Labour Party'])).toBe(true);
  });

  it('does not flag ordinary retail debits', () => {
    expect(detectSpecialCategory(['TESCO STORES', 'Salary ACME LTD'])).toBe(
      false
    );
  });
});

// --- Extraction through the write path (det / syn / G2 / Art 9) ---

const VERSIONS = {
  model: 'lm-docintel',
  promptSha: 'lm-docintel',
  skillSemver: '1.0.0',
  skillSha: 'lm-docintel-m3',
};

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
    document: { name: 'payslip.pdf' },
    originArtifactId: 'art_syn',
    runId: 'run_syn',
    now: 1_700_000_000_000,
    ...over,
  };
}

function extraction(
  over: Partial<DocintelExtraction> & { insights: ExtractionInsight[] }
): DocintelExtraction {
  return {
    kind: 'lm.docintel.extraction/1',
    documentId: 'doc_syn',
    contentHash: 'hash_syn',
    docType: 'payslip',
    docTypeInScope: true,
    attribution: { clientId: 'client_daniel', confidence: 0.97, joint: false },
    specialCategoryFlagged: false,
    versions: VERSIONS,
    ...over,
  };
}

const incomeInsight: ExtractionInsight = {
  label: 'Basic monthly income',
  value: '£3,200',
  confidence: 0.95,
  src: 'syn',
  quote: 'Basic pay £3,200',
  fieldKey: 'basicIncome',
  section: 'income',
};

describe('extraction write path — det/syn/G2/Art 9', () => {
  it('extracts a det field when the quote is verified against the text layer', () => {
    const proj = applyExtraction(
      ctx(extraction({ insights: [incomeInsight] }), {
        sourceText: 'Employer ACME\nBasic pay £3,200\nTax £410',
      })
    );
    expect(proj.detFields).toBe(1);
    const fc = proj.events.filter((e) => e.type === 'field-change');
    expect(fc[0].payload.src).toBe('det');
  });

  it('a vision-only document (no text layer) yields syn', () => {
    const proj = applyExtraction(
      ctx(extraction({ insights: [incomeInsight] }), { sourceText: null })
    );
    expect(proj.synFields).toBe(1);
    expect(proj.detFields).toBe(0);
  });

  it('ambiguous attribution fires G2 and writes no field', () => {
    const proj = applyExtraction(
      ctx(
        extraction({
          attribution: {
            clientId: 'client_daniel',
            confidence: 0.6,
            joint: false,
          },
          insights: [incomeInsight],
        }),
        { sourceText: 'Basic pay £3,200' }
      )
    );
    expect(proj.gates.map((g) => g.gateId)).toContain('G2');
    expect(proj.events.filter((e) => e.type === 'field-change')).toHaveLength(
      0
    );
  });

  it('flags special-category data detected by the coded scan even if the model did not', () => {
    const proj = applyExtraction(
      ctx(
        extraction({
          docType: 'bank-statement',
          specialCategoryFlagged: false,
          insights: [
            {
              label: 'Debit',
              value: 'BOOTS PHARMACY',
              confidence: 0.9,
              src: 'syn',
            },
          ],
        }),
        { sourceText: null }
      )
    );
    expect(
      proj.events.some(
        (e) =>
          e.type === 'activity' &&
          String(
            (e.payload as { activity?: { id?: string } }).activity?.id
          ).includes('specialcat')
      )
    ).toBe(true);
  });

  it('quarantines an out-of-scope type even when the model claims in-scope', () => {
    const proj = applyExtraction(
      ctx(
        extraction({
          docType: 'utility-bill',
          docTypeInScope: true,
          insights: [incomeInsight],
        }),
        { sourceText: 'Basic pay £3,200' }
      )
    );
    expect(proj.quarantined).toBe(true);
    expect(proj.document.status).toBe('REJECTED');
    expect(proj.events.filter((e) => e.type === 'field-change')).toHaveLength(
      0
    );
  });
});

describe('one canonical extraction decoder (finding 12)', () => {
  it('the strict decoder is the single source of truth and validates the trust spine', async () => {
    const strict = await import('@/crm/agents/docintelContract');
    expect(typeof strict.decodeDocintelExtraction).toBe('function');
    // The strict decoder REJECTS a side-car whose insight is missing `src` — the
    // trust field a loose envelope decode would have waved through.
    const missingSrc = {
      ...extraction({ insights: [] }),
      insights: [
        {
          label: 'Basic monthly income',
          value: '£3,200',
          confidence: 0.95,
          quote: 'Basic pay £3,200',
          fieldKey: 'basicIncome',
          section: 'income',
        },
      ],
    };
    expect(() => strict.decodeDocintelExtraction(missingSrc)).toThrow();
    // A well-formed side-car decodes and preserves the spine.
    expect(
      strict.decodeDocintelExtraction(extraction({ insights: [incomeInsight] }))
        .insights[0].src
    ).toBe('syn');
  });

  it('no loose decodeDocintelExtraction leaks from the agentContracts barrel', async () => {
    const barrel = (await import('@/crm/agentContracts')) as Record<
      string,
      unknown
    >;
    // The footgun envelope decoder was removed: there is exactly one decoder,
    // and it lives in docintelContract, not the generic artifact barrel.
    expect('decodeDocintelExtraction' in barrel).toBe(false);
  });
});
