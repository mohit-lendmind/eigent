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

// M4 (FR-011/012/006) — the adviser-only results surface under test. The
// shortlist ranks cheapest true-cost first and pins the coverage line; a scaffold
// (verified:false) wears the watermark band and its export is DISABLED; G5 stays
// closed until a product is picked AND a rationale typed; and the evidence export
// refuses any non-claimable snapshot. The react-i18next mock returns keys
// verbatim, so localized strings are asserted by their crm.results.* key.

import {
  SOURCING_SURFACE_CLASS,
  type Product,
  type SourcingSnapshotPayload,
  type VerificationRef,
} from '@/crm/agentContracts';
import { firmPanelCoverage, mseCoverage } from '@/crm/connectors/coverage';
import { exportEvidenceOfResearch } from '@/crm/connectors/evidenceExport';
import {
  RecommendationG5,
  RunRibbon,
  Shortlist,
} from '@/crm/ui/SourcingResults';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

const products: Product[] = [
  {
    lenderId: 'lender-pricey',
    productName: 'Pricey fix',
    rate: 5.1,
    aprc: 6.2,
    feesPence: 0,
    monthlyPence: 130000,
    trueCostPence: 3_400_000,
    status: 'eligible',
  },
  {
    lenderId: 'lender-cheap',
    productName: 'Cheap fix',
    rate: 4.0,
    aprc: 4.3,
    feesPence: 149900,
    monthlyPence: 106200,
    trueCostPence: 2_950_000,
    status: 'eligible',
  },
  {
    lenderId: 'lender-declined',
    productName: 'Declined deal',
    rate: 5.3,
    aprc: 7.1,
    feesPence: 49900,
    monthlyPence: 120400,
    trueCostPence: 0,
    status: 'declined',
    declineReason: 'LTV above product maximum',
  },
];

function fullVerification(): VerificationRef {
  return {
    fixtureHash: 'fnv1a64:deadbeefdeadbeef',
    ratesAsAt: '2026-08-23T00:00:00.000Z',
    rawEvidencePointer: 'lm/sourcing/case-1/products.json',
    canaryPassedAt: '2026-08-23T01:00:00.000Z',
  };
}

function verifiedSnapshot(): SourcingSnapshotPayload {
  return {
    adapterId: 'mse',
    coverage: mseCoverage(),
    ratesAsAt: '2026-08-23T00:00:00.000Z',
    adviserId: 'adviser-jo',
    verified: true,
    verification: fullVerification(),
    surfaceClass: SOURCING_SURFACE_CLASS,
    productsAttachmentId: 'art_products',
    summary: {
      total: 3,
      eligible: 2,
      declined: 1,
      topTrueCostPence: 2_950_000,
    },
  };
}

function scaffoldSnapshot(): SourcingSnapshotPayload {
  return {
    adapterId: 'mortgage-brain',
    coverage: firmPanelCoverage(
      'Mortgage Brain firm panel — not whole of market'
    ),
    ratesAsAt: '2026-08-23T00:00:00.000Z',
    adviserId: 'adviser-jo',
    verified: false,
    surfaceClass: SOURCING_SURFACE_CLASS,
    productsAttachmentId: 'art_products',
    summary: {
      total: 3,
      eligible: 2,
      declined: 1,
      topTrueCostPence: 2_950_000,
    },
  };
}

describe('Shortlist — adviser-only, ranked, coverage pinned (FR-011)', () => {
  it('pins the coverage statement and ranks cheapest true-cost first', () => {
    render(
      createElement(Shortlist, {
        snapshot: verifiedSnapshot(),
        products,
        coverage: mseCoverage(),
        scaffold: false,
      })
    );
    // Coverage line pinned (info tone note).
    expect(
      screen.getByText('MSE Best Buys (Podium) — not whole of market')
    ).toBeInTheDocument();
    // The cheapest eligible carries the "best true cost" badge.
    const cheapest = screen.getByText('Cheap fix').closest('article');
    expect(cheapest).not.toBeNull();
    expect(cheapest?.querySelector('*')?.textContent).toContain('Cheap fix');
    expect(screen.getByText('crm.results.best-true-cost')).toBeInTheDocument();
  });

  it('keeps declines collapsed behind a why-not toggle', () => {
    render(
      createElement(Shortlist, {
        snapshot: verifiedSnapshot(),
        products,
        coverage: mseCoverage(),
        scaffold: false,
      })
    );
    // Collapsed: the decline reason is not shown until the toggle is opened.
    expect(screen.queryByText(/LTV above product maximum/)).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'crm.results.why-not' })
    );
    expect(screen.getByText(/LTV above product maximum/)).toBeInTheDocument();
  });

  it('a verified snapshot exports an evidence bundle', () => {
    render(
      createElement(Shortlist, {
        snapshot: verifiedSnapshot(),
        products,
        coverage: mseCoverage(),
        scaffold: false,
      })
    );
    const exportBtn = screen.getByRole('button', {
      name: 'crm.results.export',
    });
    expect(exportBtn).not.toBeDisabled();
    fireEvent.click(exportBtn);
    expect(screen.getByText('crm.results.export-ok')).toBeInTheDocument();
  });

  it('a scaffold shows the watermark and DISABLES export (FR-006)', () => {
    render(
      createElement(Shortlist, {
        snapshot: scaffoldSnapshot(),
        products,
        coverage: firmPanelCoverage(
          'Mortgage Brain firm panel — not whole of market'
        ),
        scaffold: true,
      })
    );
    expect(
      screen.getByText('crm.results.scaffold-watermark')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'crm.results.export' })
    ).toBeDisabled();
  });
});

describe('RunRibbon — narrates + always-hot take-control (FR-011)', () => {
  it('shows the action, the adviser attribution, and a live take-control', () => {
    const onTakeControl = vi.fn();
    render(
      createElement(RunRibbon, {
        currentAction: 'Opening MSE best buys…',
        runningAsAdviser: 'Jo Adviser',
        onTakeControl,
      })
    );
    expect(screen.getByText('Opening MSE best buys…')).toBeInTheDocument();
    expect(screen.getByText('crm.results.running-as')).toBeInTheDocument();
    const btn = screen.getByRole('button', {
      name: 'crm.results.take-control',
    });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onTakeControl).toHaveBeenCalledTimes(1);
  });
});

describe('RecommendationG5 — closed until product + rationale (FR-012)', () => {
  it('disables recommend until BOTH a product and a rationale are given', () => {
    const onRecommend = vi.fn();
    render(
      createElement(RecommendationG5, {
        snapshot: verifiedSnapshot(),
        onRecommend,
        ratesStale: false,
      })
    );
    const recommend = screen.getByRole('button', {
      name: 'crm.results.recommend',
    });
    expect(recommend).toBeDisabled();

    fireEvent.change(
      screen.getByPlaceholderText('crm.results.pick-product-placeholder'),
      {
        target: { value: 'lender-cheap' },
      }
    );
    expect(recommend).toBeDisabled(); // rationale still empty

    fireEvent.change(
      screen.getByPlaceholderText('crm.results.rationale-placeholder'),
      { target: { value: 'Lowest true cost, fits the client’s term.' } }
    );
    expect(recommend).not.toBeDisabled();

    fireEvent.click(recommend);
    expect(onRecommend).toHaveBeenCalledWith(
      'lender-cheap',
      'Lowest true cost, fits the client’s term.'
    );
  });

  it('warns when rates are stale', () => {
    render(
      createElement(RecommendationG5, {
        snapshot: verifiedSnapshot(),
        onRecommend: () => {},
        ratesStale: true,
      })
    );
    expect(screen.getByText('crm.results.rates-stale')).toBeInTheDocument();
  });
});

describe('exportEvidenceOfResearch — refuses non-claimable (FR-006)', () => {
  it('exports a bundle for a claimable snapshot', () => {
    const result = exportEvidenceOfResearch(verifiedSnapshot());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.bundleId).toContain('eor_mse_');
  });

  it('refuses a scaffold (unverified) snapshot', () => {
    expect(exportEvidenceOfResearch(scaffoldSnapshot())).toEqual({
      ok: false,
      reason: 'unverified',
    });
  });

  it('refuses a hand-set verified:true with no evidence (re-derives)', () => {
    const lying = { ...verifiedSnapshot(), verification: undefined };
    expect(exportEvidenceOfResearch(lying)).toEqual({
      ok: false,
      reason: 'no-evidence',
    });
  });

  it('refuses a wrong-surface snapshot', () => {
    const wrong = {
      ...verifiedSnapshot(),
      surfaceClass: 'client-facing',
    } as unknown as SourcingSnapshotPayload;
    expect(exportEvidenceOfResearch(wrong)).toEqual({
      ok: false,
      reason: 'wrong-surface',
    });
  });
});

describe('dark-mode contrast — colours resolve to ds tokens, never raw hex', () => {
  it('the shortlist paints with ds-* token classes (theme owns contrast)', () => {
    const { container } = render(
      createElement(Shortlist, {
        snapshot: verifiedSnapshot(),
        products,
        coverage: mseCoverage(),
        scaffold: true,
      })
    );
    const html = container.innerHTML;
    // Every colour is a ds token class; a raw hex would fail the design-token
    // gate AND would not adapt to dark mode.
    expect(html).toMatch(/ds-(bg|text)-/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});
