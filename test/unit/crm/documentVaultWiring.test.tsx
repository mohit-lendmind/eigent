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

// Blocker 4 (UI) — the DocumentVault screen is WIRED, not a dead preview. The
// controller loop is proven in vaultSurface.test.ts; this guards the two
// interactive affordances that only exist once DocumentVault mounts its own
// default handlers (no onOpenSource / no onConfirmInsight override):
//   • US1.4 deep-link: clicking "view source" on a det fact opens the in-vault
//     SourceQuoteViewer at the highlighted quote — no external ArtifactViewer.
//   • US2 syn-confirm: clicking "Confirm" on a syn fact promotes exactly that
//     applicant's fact-find field syn → det via the cases store, so G9 can clear.
// The i18n mock (test/setup.ts) returns keys verbatim, so controls are found by
// their `crm.*` key; the source quote itself renders raw and is asserted literally.

import { clearAllCrmState } from '@/crm';
import { getCrmCasesStore } from '@/crm/casesStore';
import { getCrmDocumentsStore } from '@/crm/documentsStore';
import type { CrmDocument, DocInsight } from '@/crm/domain/types';
import { case417 } from '@/crm/fixtures/case417';
import { DocumentVault } from '@/crm/ui/DocumentVault';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CASE = 'c417';

function insight(over: Partial<DocInsight> = {}): DocInsight {
  return {
    id: 'ins_1',
    label: 'Annual basic income',
    value: { t: 'money', v: 3_730_000 },
    conf: 0.98,
    src: 'det',
    sourceQuote: 'Annual basic £37,300',
    ...over,
  };
}

function seedDoc(over: Partial<CrmDocument> = {}): void {
  const document: CrmDocument = {
    id: 'doc_1',
    owner: 'aisha',
    name: 'payslip-a.pdf',
    type: 'payslip',
    status: 'COMPLETED',
    size: 1024,
    when: 1_700_000_000_000,
    iconTone: 'status-info',
    attribution: 0.97,
    insights: [insight()],
    schemaVersion: 1,
    ...over,
  };
  getCrmDocumentsStore().getState().upsertDocuments([document]);
}

function overtimeAvgField(clientId: string) {
  const applicant = getCrmCasesStore()
    .getState()
    .casesById[CASE]?.applicants.find((a) => a.clientId === clientId);
  return applicant?.profile.income?.fields.find((f) => f.k === 'overtimeAvg');
}

describe('DocumentVault — the wired screen (Blocker 4, UI)', () => {
  beforeEach(() => {
    clearAllCrmState();
    localStorage.clear();
    getCrmCasesStore().getState().upsertCases([case417]);
  });
  afterEach(cleanup);

  it('US1.4: view-source on a det fact opens the in-vault source viewer at the quote', () => {
    seedDoc({ insights: [insight({ src: 'det' })] });
    // No onOpenSource override — the screen must supply its own viewer.
    render(createElement(DocumentVault, { caseId: CASE }));

    // No dialog until the adviser deep-links.
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(
      screen.getByRole('button', { name: /crm\.insight\.view-source/ })
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    // The verbatim quote is shown HIGHLIGHTED — the trust-spine evidence, not a
    // model summary.
    expect(screen.getByText('Annual basic £37,300')).toBeInTheDocument();
  });

  it('US2: Confirm on a syn fact promotes that applicant field syn → det via the store', () => {
    // aisha's income.overtimeAvg is syn on file (fixture). A syn insight that
    // maps to it, owned by aisha, is confirmable in place.
    seedDoc({
      owner: 'aisha',
      insights: [
        insight({
          id: 'ins_ot',
          label: 'Overtime avg',
          src: 'syn',
          sourceQuote: 'Overtime £3,200',
          section: 'income',
          fieldKey: 'overtimeAvg',
        }),
      ],
    });

    expect(overtimeAvgField('aisha')?.src).toBe('syn');

    render(
      createElement(DocumentVault, { caseId: CASE, adviserId: 'adviser:test' })
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'crm.insight.confirm' })
    );

    const field = overtimeAvgField('aisha');
    expect(field?.src).toBe('det');
    expect(field?.confirmedBy).toBe('adviser:test');
  });

  it('US1.4: the source viewer shows the page/line locator context (finding 10)', () => {
    seedDoc({
      insights: [
        insight({
          src: 'det',
          locator: { page: 2, line: 5 },
        }),
      ],
    });
    render(createElement(DocumentVault, { caseId: CASE }));

    fireEvent.click(
      screen.getByRole('button', { name: /crm\.insight\.view-source/ })
    );

    // The panel surfaces WHERE the verbatim quote sits, not just the quote —
    // page/line context an adviser uses to find it in the document.
    expect(screen.getByText('Annual basic £37,300')).toBeInTheDocument();
    expect(screen.getByText(/Page 2/)).toBeInTheDocument();
    expect(screen.getByText(/Line 5/)).toBeInTheDocument();
  });

  it('finding 7: the vault lists only documents belonging to THIS case', () => {
    // A document for this case (owner is an applicant of c417) …
    seedDoc({ id: 'doc_case', owner: 'aisha', name: 'payslip-aisha.pdf' });
    // … and one owned by a client who is NOT on this case.
    seedDoc({ id: 'doc_other', owner: 'stranger_zzz', name: 'stranger.pdf' });

    render(createElement(DocumentVault, { caseId: CASE }));

    expect(screen.getByText('payslip-aisha.pdf')).toBeInTheDocument();
    // The other case's document must not leak into this vault.
    expect(screen.queryByText('stranger.pdf')).toBeNull();
  });

  it('a read-only preview (no caseId, no onFiles) offers no Confirm control', () => {
    seedDoc({
      owner: 'aisha',
      insights: [
        insight({
          id: 'ins_ot',
          label: 'Overtime avg',
          src: 'syn',
          sourceQuote: 'Overtime £3,200',
          section: 'income',
          fieldKey: 'overtimeAvg',
        }),
      ],
    });
    render(createElement(DocumentVault, {}));
    expect(
      screen.queryByRole('button', { name: 'crm.insight.confirm' })
    ).toBeNull();
  });
});
