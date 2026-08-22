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

// T021 — the docintel vault surface. The i18n mock (test/setup.ts) returns the
// key verbatim, so every assertion is by `crm.*` key — proof the UI routes
// through t() rather than a hardcoded literal. Covers: the DocCard status machine,
// the det deep-link, the syn NON-COLOUR channel + Confirm, and the G2/G3/G9 cards.

import type { IncomeGateResult } from '@/crm/agents/incomeGate';
import type { CrmDocument, DocInsight } from '@/crm/domain/types';
import type { MirroredGate } from '@/crm/fold/eventLogStore';
import { DocCard } from '@/crm/ui/DocCard';
import {
  AttributionGateCard,
  ConflictGateCard,
  DocErrorCard,
  IncomeGateCard,
} from '@/crm/ui/DocGateCards';
import { DocInsightRow } from '@/crm/ui/DocInsightRow';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

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

function doc(over: Partial<CrmDocument> = {}): CrmDocument {
  return {
    id: 'doc_1',
    owner: 'client_daniel',
    name: 'payslip-d7.pdf',
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
}

describe('DocCard — the QUEUED → PROCESSING → COMPLETED/REJECTED machine', () => {
  it.each([
    ['QUEUED', 'crm.vault.status-queued'],
    ['PROCESSING', 'crm.vault.status-processing'],
    ['COMPLETED', 'crm.vault.status-completed'],
    ['REJECTED', 'crm.vault.status-rejected'],
  ] as const)('paints the %s status pill', (status, key) => {
    render(createElement(DocCard, { document: doc({ status }) }));
    expect(screen.getByText(key)).toBeInTheDocument();
  });

  it('shows det/syn tallies only once complete', () => {
    render(createElement(DocCard, { document: doc({ status: 'PROCESSING' }) }));
    expect(screen.queryByText('crm.vault.det-count')).toBeNull();

    cleanup();
    render(createElement(DocCard, { document: doc({ status: 'COMPLETED' }) }));
    expect(screen.getByText('crm.vault.det-count')).toBeInTheDocument();
    expect(screen.getByText('crm.vault.syn-count')).toBeInTheDocument();
  });

  it('collapses incidental (unmapped) insights into a disclosure', () => {
    const mapped = insight({ id: 'a', src: 'det', sourceQuote: 'q' });
    // No quote and not det ⇒ incidental ⇒ collapsed under a <summary>.
    const incidental = insight({
      id: 'b',
      label: 'Employer reference',
      src: 'syn',
      sourceQuote: undefined,
    });
    render(
      createElement(DocCard, {
        document: doc({ insights: [mapped, incidental] }),
      })
    );
    // The disclosure summary is present for the one incidental insight.
    expect(screen.getByText('crm.vault.more-insights')).toBeInTheDocument();
  });
});

describe('DocInsightRow — det deep-link, syn non-colour channel + Confirm', () => {
  it('a det fact with a quote deep-links to the source span', () => {
    const onOpenSource = vi.fn();
    render(
      createElement(DocInsightRow, {
        insight: insight({ src: 'det', sourceQuote: 'Annual basic £37,300' }),
        onOpenSource,
      })
    );
    expect(screen.getByText('crm.insight.verified')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: /crm\.insight\.view-source/ })
    );
    expect(onOpenSource).toHaveBeenCalledTimes(1);
  });

  it('a syn fact reads Unverified (icon + word, not colour alone) and offers Confirm', () => {
    const onConfirm = vi.fn();
    render(
      createElement(DocInsightRow, {
        insight: insight({ src: 'syn' }),
        onConfirm,
      })
    );
    // The trust is conveyed by the WORD "Unverified", not only a colour.
    expect(screen.getByText('crm.insight.unverified')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'crm.insight.confirm' })
    );
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('a det fact never shows the Confirm control (it needs no human check)', () => {
    render(
      createElement(DocInsightRow, {
        insight: insight({ src: 'det' }),
        onConfirm: vi.fn(),
      })
    );
    expect(
      screen.queryByRole('button', { name: 'crm.insight.confirm' })
    ).toBeNull();
  });
});

function gate(over: Partial<MirroredGate> = {}): MirroredGate {
  return {
    id: 'g_1',
    gateId: 'G2',
    caseId: 'c417',
    projectId: 'proj_syn',
    approvalId: 'appr_1',
    title: 'Confirm applicant',
    reasons: ['Attribution confidence 60% is below 85%.'],
    raisedAt: 1,
    status: 'open',
    ...over,
  };
}

describe('DocGateCards — decidable without opening the document (US3)', () => {
  it('G2 shows the deciding reason inline and confirms', () => {
    const onConfirm = vi.fn();
    render(createElement(AttributionGateCard, { gate: gate(), onConfirm }));
    expect(screen.getByText('crm.docgate.g2-title')).toBeInTheDocument();
    expect(
      screen.getByText('Attribution confidence 60% is below 85%.')
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'crm.docgate.g2-confirm' })
    );
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('G3 shows both disagreeing values inline so the choice needs no doc', () => {
    render(
      createElement(ConflictGateCard, {
        gate: gate({ gateId: 'G3', reasons: ['Disagree by 3.1%.'] }),
        existingLabel: '£38,500.00',
        incomingLabel: '£37,300.00',
      })
    );
    expect(screen.getByText('crm.docgate.g3-title')).toBeInTheDocument();
    expect(screen.getByText('£38,500.00')).toBeInTheDocument();
    expect(screen.getByText('£37,300.00')).toBeInTheDocument();
  });

  it('G9 names the blocking applicant + field and is null when satisfied', () => {
    const blocked: IncomeGateResult = {
      satisfied: false,
      blocking: [
        {
          clientId: 'client_amara',
          fieldKey: 'basicIncome',
          reason: 'missing',
        },
      ],
    };
    const { container } = render(
      createElement(IncomeGateCard, { result: blocked })
    );
    expect(screen.getByText('crm.docgate.g9-title')).toBeInTheDocument();
    expect(screen.getByText(/client_amara/)).toBeInTheDocument();

    cleanup();
    const satisfied = render(
      createElement(IncomeGateCard, {
        result: { satisfied: true, blocking: [] },
      })
    );
    expect(satisfied.container).toBeEmptyDOMElement();
    void container;
  });

  it('a typed error card is a live region (role=alert)', () => {
    render(
      createElement(DocErrorCard, { message: 'File exceeds 3 MB limit.' })
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('File exceeds 3 MB limit.');
  });
});
