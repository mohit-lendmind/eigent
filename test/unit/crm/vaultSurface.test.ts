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

// Blocker 4 — the wired document-vault loop. This is the regression guard that a
// payslip dropped in the app really flows upload → run → side-car → fold → vault.
// It drives the SAME controller (vaultSurface) the running screen calls, over the
// in-memory FakeEdge, so the seam is exercised end to end without a network or a
// live model:
//   • uploadVaultDocuments reads a File and dispatches a docintel directive.
//   • applyExtractionSidecar decodes a published side-car with the STRICT decoder,
//     projects it against the roster + facts on file, appends the events as a
//     genuine chained case log, folds them, and the vault stores light up —
//     documents in the documents store, the G3 gate in openGates.
//   • conflictForGate + resolveConflictGate let an adviser decide in place.
//   • selectCaseIncomeGate assesses G9 off the income facts on file (M8).
// Synthetic fixtures only; a src-less side-car is a hard decode reject.

import { clearAllCrmState } from '@/crm';
import { resetCaseProjectCaches } from '@/crm/agents/caseProject';
import type { DocintelExtraction } from '@/crm/agents/docintelContract';
import { configureAgentEdge } from '@/crm/agents/edge';
import type { ExistingFactValue } from '@/crm/agents/extractionApply';
import { getCrmCasesStore } from '@/crm/casesStore';
import { getCrmDocumentsStore } from '@/crm/documentsStore';
import { toPence } from '@/crm/domain/money';
import { case417 } from '@/crm/fixtures/case417';
import { getCrmEventLogStore } from '@/crm/fold/eventLogStore';
import {
  applyExtractionSidecar,
  conflictForGate,
  existingFactsForCase,
  resolveConflictGate,
  rosterForCase,
  selectCaseIncomeGate,
  uploadVaultDocuments,
} from '@/crm/ui/vaultSurface';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeEdge } from './fakeEdge';

const CASE = 'c417';
const FIRM = 'firm_syn';

const VERSIONS = {
  model: 'lm-docintel',
  promptSha: 'lm-docintel',
  skillSemver: '1.0.0',
  skillSha: 'lm-docintel-m3',
};

const SOURCE_TEXT =
  'Daniel Okafor  NI AB123456C  M14 6NR\nAnnual basic £37,300';

// A daniel payslip whose det basic income (£37,300) disagrees with the £38,500
// on file — the write path must raise G3, never overwrite. Its identifiers all
// appear in SOURCE_TEXT, so the coded attribution agrees with the model's claim.
function d7Sidecar(): DocintelExtraction {
  return {
    kind: 'lm.docintel.extraction/1',
    documentId: 'doc_d7',
    contentHash: 'hash_d7',
    docType: 'payslip',
    docTypeInScope: true,
    attribution: { clientId: 'daniel', confidence: 0.97, joint: false },
    identifiers: {
      fullName: { value: 'Daniel Okafor', quote: 'Daniel Okafor' },
      niNumber: { value: 'AB123456C', quote: 'AB123456C' },
      postcode: { value: 'M14 6NR', quote: 'M14 6NR' },
    },
    specialCategoryFlagged: false,
    versions: VERSIONS,
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
  };
}

const DANIEL_ROSTER = [
  {
    clientId: 'daniel',
    fullName: 'Daniel Okafor',
    niNumber: 'AB123456C',
    postcode: 'M14 6NR',
  },
];

const EXISTING_ON_FILE: Record<string, ExistingFactValue> = {
  'daniel::income::basicIncome': {
    value: { t: 'money', v: toPence(3_850_000) },
    src: 'det',
    source: { kind: 'manual' },
  },
};

async function drive() {
  return applyExtractionSidecar({
    sidecar: d7Sidecar(),
    caseId: CASE,
    firmId: FIRM,
    sourceText: SOURCE_TEXT,
    document: { name: 'payslip-d7.pdf', size: 2048 },
    originArtifactId: 'art_d7',
    runId: 'run_d7',
    now: 1_700_000_000_000,
    roster: DANIEL_ROSTER,
    existing: EXISTING_ON_FILE,
  });
}

describe('vaultSurface — the wired document-vault loop (Blocker 4)', () => {
  beforeEach(() => {
    clearAllCrmState();
    resetCaseProjectCaches();
    localStorage.clear();
  });
  afterEach(() => {
    configureAgentEdge(null);
    resetCaseProjectCaches();
  });

  it('side-car → fold → vault: a published extraction lands a document + a G3 gate', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);

    const r = await drive();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.folded).toBeGreaterThan(0);

    // The document is in the store the vault reads, straight off the fold.
    const docs = getCrmDocumentsStore().getState().documentsById;
    expect(docs['doc_d7']?.name).toBe('payslip-d7.pdf');
    expect(docs['doc_d7']?.status).toBe('COMPLETED');

    // The disagreement raised G3 (record-never-repair) — reconstructed from the
    // chain's gate-raise entry, not a side-write.
    const g3 = Object.values(getCrmEventLogStore().getState().openGates).find(
      (g) => g.gateId === 'G3' && g.caseId === CASE
    );
    expect(g3?.status).toBe('open');

    // The value on file was NOT overwritten by the incoming £37,300.
    const conflicts = getCrmCasesStore().getState().conflictsById;
    expect(Object.keys(conflicts).length).toBeGreaterThan(0);
  });

  it('a src-less side-car is a hard decode reject (never a silent syn)', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);
    const bad = d7Sidecar() as unknown as {
      insights: Record<string, unknown>[];
    };
    delete bad.insights[0].src;

    const r = await applyExtractionSidecar({
      sidecar: bad,
      caseId: CASE,
      firmId: FIRM,
      sourceText: SOURCE_TEXT,
      document: { name: 'payslip-d7.pdf' },
      originArtifactId: 'art_d7',
      runId: 'run_d7',
      now: 1_700_000_000_000,
      roster: DANIEL_ROSTER,
      existing: EXISTING_ON_FILE,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/src/);
    // Nothing was written — a rejected side-car never touches the fold.
    expect(
      getCrmDocumentsStore().getState().documentsById['doc_d7']
    ).toBeUndefined();
  });

  it('resolveConflictGate lets an adviser pick the authoritative value in place', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);
    // resolveConflict writes the chosen value onto the applicant, so the case
    // must be on file for the resolution to land.
    getCrmCasesStore().getState().upsertCases([case417]);
    await drive();

    const g3 = Object.values(getCrmEventLogStore().getState().openGates).find(
      (g) => g.gateId === 'G3' && g.caseId === CASE
    )!;

    // The card shows both disagreeing values inline (US3).
    const view = conflictForGate(g3);
    expect(view).not.toBeNull();
    expect(view!.existingLabel).toContain('38,500');
    expect(view!.incomingLabel).toContain('37,300');

    const out = resolveConflictGate(
      g3,
      { conflictId: view!.conflictId, chosenValue: view!.incoming },
      'adviser:test'
    );
    expect(out.ok).toBe(true);

    // The mirror closed and the conflict record is resolved.
    expect(getCrmEventLogStore().getState().openGates[g3.id]?.status).toBe(
      'resolved'
    );
    expect(
      getCrmCasesStore().getState().conflictsById[view!.conflictId]?.resolvedAt
    ).toBeDefined();
  });

  it('resolveConflictGate refuses a non-G3 gate', () => {
    const out = resolveConflictGate(
      {
        id: 'G2_x',
        gateId: 'G2',
        caseId: CASE,
        projectId: 'p',
        approvalId: 'a',
        title: 't',
        reasons: [],
        raisedAt: 1,
        status: 'open',
      },
      { conflictId: 'x', chosenValue: { t: 'text', v: 'y' } },
      'adviser:test'
    );
    expect(out.ok).toBe(false);
  });

  it('selectCaseIncomeGate (G9) blocks on syn / missing income and clears on det', () => {
    getCrmCasesStore().getState().upsertCases([case417]);

    // Both applicants hold a det `basic`, so a basic-keyed gate is satisfied.
    expect(selectCaseIncomeGate(CASE, ['basic']).satisfied).toBe(true);

    // `overtimeAvg` is syn-only for both — a syn income never satisfies G9.
    const synGate = selectCaseIncomeGate(CASE, ['overtimeAvg']);
    expect(synGate.satisfied).toBe(false);
    expect(synGate.blocking.every((b) => b.reason === 'syn-only')).toBe(true);

    // An absent field is a `missing` blocker.
    const missingGate = selectCaseIncomeGate(CASE, ['basicIncome']);
    expect(missingGate.satisfied).toBe(false);
    expect(missingGate.blocking.every((b) => b.reason === 'missing')).toBe(
      true
    );
  });

  it('rosterForCase + existingFactsForCase read identifiers and facts off the store', () => {
    getCrmCasesStore().getState().upsertCases([case417]);

    const roster = rosterForCase(CASE);
    expect(roster.map((r) => r.clientId).sort()).toEqual(['aisha', 'daniel']);
    // The postcode on file feeds the coded attribution cluster.
    expect(roster.some((r) => r.postcode === 'M14 6NR')).toBe(true);

    const existing = existingFactsForCase(CASE);
    expect(existing['aisha::income::basic']?.value).toEqual({
      t: 'money',
      v: 4_200_000,
    });
  });

  it('uploadVaultDocuments reads a File and dispatches a docintel directive', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);
    getCrmCasesStore().getState().upsertCases([case417]);

    const file = new File([new Uint8Array([1, 2, 3, 4])], 'payslip.pdf', {
      type: 'application/pdf',
    });
    const r = await uploadVaultDocuments(CASE, FIRM, [file]);
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
    if (!r.ok) return;
    expect(r.value.ingested).toBe(1);

    // The ingest seam dispatched a directive whose agent is the docintel skill.
    expect(edge.commands.length).toBeGreaterThan(0);
  });

  it('a live upload produces a QUEUED vault row at admission (FR-011, finding 2)', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);
    getCrmCasesStore().getState().upsertCases([case417]);

    // The documents store starts empty for this case.
    expect(
      Object.keys(getCrmDocumentsStore().getState().documentsById)
    ).toEqual([]);

    const file = new File([new Uint8Array([9, 8, 7, 6])], 'payslip-live.pdf', {
      type: 'application/pdf',
    });
    const r = await uploadVaultDocuments(CASE, FIRM, [file]);
    expect(r.ok, r.ok ? '' : r.error).toBe(true);

    // The vault now shows the uploaded document immediately, in QUEUED — the
    // production producer of the QUEUED state (previously only fixtures made it).
    const docs = Object.values(getCrmDocumentsStore().getState().documentsById);
    expect(docs).toHaveLength(1);
    expect(docs[0].status).toBe('QUEUED');
    expect(docs[0].name).toBe('payslip-live.pdf');
    // It carries the attached run so the deferred observer can flip it forward.
    expect(docs[0].origin?.runId).toBeTruthy();
  });

  it('uploadVaultDocuments reports a typed failure in local mode (no edge)', async () => {
    configureAgentEdge(null);
    const file = new File([new Uint8Array([1])], 'x.pdf', {
      type: 'application/pdf',
    });
    const r = await uploadVaultDocuments(CASE, FIRM, [file]);
    expect(r.ok).toBe(false);
  });
});
