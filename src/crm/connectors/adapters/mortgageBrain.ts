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

// M4 (FR-002/009) — the Mortgage Brain adapter, a LICENSED-PORTAL SCAFFOLD.
//
// Mortgage Brain sits behind a firm login and exposes no interceptable JSON
// endpoint, so unlike MSE this adapter runs in a LOGGED-IN session and its plan
// SCRAPES THE DOM results table rather than capturing a network response. The
// extractor is still PURE — scraped table rows in, normalized Products out, no
// browser or model — so a recorded DOM capture replays deterministically.
//
// It ships DELIBERATELY UNVERIFIED. The definition carries NO `verification`
// field, so the registry derives verified:FALSE. This is the honesty spine: a
// licensed portal cannot be marked verified until someone records a real session
// (behind the firm's own credentials, within its ToS — see
// docs/tos-mortgage-brain.md) and stands up a live canary that earns a
// canaryPassedAt. We NEVER hand-set verified or bake a fabricated recording.
//
// Coverage is FIXED as a firm panel — explicitly not whole of market.

import type {
  Product,
  QueryStep,
  SourcingAdapterDefinition,
} from '../SourcingAdapter';
import { firmPanelCoverage } from '../coverage';

// The licensed portal and the results-table selector the plan scrapes once the
// firm's own login has been established in the logged-in session.
export const MORTGAGE_BRAIN_URL =
  'https://www.mortgage-brain.co.uk/criteria-hub/results';
export const MORTGAGE_BRAIN_RESULTS_SELECTOR =
  'table.sourcing-results tbody tr';

// The firm-panel coverage statement. A firm panel is a curated lender set the
// firm holds terms with — explicitly NOT the whole market.
export const MORTGAGE_BRAIN_COVERAGE_STATEMENT =
  'Mortgage Brain firm panel — not whole of market';

export function mortgageBrainCoverage() {
  return firmPanelCoverage(MORTGAGE_BRAIN_COVERAGE_STATEMENT);
}

function fillArgs(caseFacts: Record<string, unknown>): Record<string, unknown> {
  const pick = (key: string): unknown => caseFacts[key];
  return {
    propertyValuePence: pick('propertyValuePence'),
    loanAmountPence: pick('loanAmountPence'),
    termYears: pick('termYears'),
    repaymentType: pick('repaymentType') ?? 'repayment',
    rateType: pick('rateType') ?? 'any',
  };
}

/**
 * The declarative plan (FR-001): open Mortgage Brain in the LOGGED-IN session,
 * fill the sourcing criteria, submit, and SCRAPE the results table's rows. The
 * parked-delegation pump runs these directives; this adapter never drives the
 * browser executor. The plan assumes the firm's own login is already present in
 * the session — this framework does not automate credential entry.
 */
export function mortgageBrainBuildQuery(
  caseFacts: Record<string, unknown>
): QueryStep[] {
  return [
    {
      tool: 'browser.open',
      args: { url: MORTGAGE_BRAIN_URL, session: 'logged_in' },
    },
    { tool: 'browser.fill', args: { fields: fillArgs(caseFacts) } },
    { tool: 'browser.submit', args: {} },
    {
      tool: 'browser.readTable',
      args: { selector: MORTGAGE_BRAIN_RESULTS_SELECTOR },
    },
  ];
}

// A scraped DOM row is a bag of cell strings keyed by the portal's column
// headers. The capture step yields `{ rows: ScrapedRow[] }`; money and rates
// arrive as the DISPLAYED strings ("£1,499", "4.04%"), so the extractor parses
// them rather than trusting typed numbers.
interface ScrapedRow {
  lender?: unknown;
  product?: unknown;
  initialRate?: unknown;
  aprc?: unknown;
  productFee?: unknown;
  monthlyPayment?: unknown;
  trueCost?: unknown;
  revertRate?: unknown;
  erc?: unknown;
  status?: unknown;
  declineReason?: unknown;
}

// "£1,499.00" / "1,499" → 149900 pence. Non-numeric text → 0. Undefined stays
// undefined so an absent optional column does not become a spurious 0.
function parsePence(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return 0;
  const cleaned = value.replace(/[£,\s]/g, '');
  const pounds = Number.parseFloat(cleaned);
  return Number.isFinite(pounds) ? Math.round(pounds * 100) : 0;
}

function parseOptionalPence(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'string' && value.replace(/[£,\s]/g, '') === '')
    return undefined;
  return parsePence(value);
}

// "4.04%" / "4.04" → 4.04. Non-numeric → 0.
function parsePct(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return 0;
  const pct = Number.parseFloat(value.replace(/[%\s]/g, ''));
  return Number.isFinite(pct) ? pct : 0;
}

function parseOptionalPct(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'string' && value.replace(/[%\s]/g, '') === '')
    return undefined;
  return parsePct(value);
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

/**
 * PURE extractor (FR-003): scraped Mortgage Brain rows → normalized Products. No
 * browser, login, or model — so replaying a recorded DOM capture through this is
 * a deterministic check of THIS extractor. A row whose status reads "declined"/
 * "ineligible" becomes a `declined` product carrying its reason rather than being
 * dropped, so the evidence pack shows what was rejected.
 */
export function mortgageBrainExtract(recordedResult: unknown): Product[] {
  const root = (recordedResult ?? {}) as Record<string, unknown>;
  const rawRows = Array.isArray(root.rows)
    ? root.rows
    : Array.isArray(root.results)
      ? root.results
      : [];
  return (rawRows as ScrapedRow[]).map((row, i) => {
    const statusText =
      typeof row.status === 'string' ? row.status.toLowerCase() : '';
    const declined =
      statusText.includes('decline') || statusText.includes('ineligible');
    const product: Product = {
      lenderId: str(row.lender, `mortgage-brain-lender-${i}`),
      productName: str(row.product, 'Mortgage Brain product'),
      rate: parsePct(row.initialRate),
      aprc: parsePct(row.aprc),
      feesPence: parsePence(row.productFee),
      monthlyPence: parsePence(row.monthlyPayment),
      trueCostPence: parsePence(row.trueCost),
      status: declined ? 'declined' : 'eligible',
    };
    const revertRate = parseOptionalPct(row.revertRate);
    if (revertRate !== undefined) product.revertRate = revertRate;
    const ercPence = parseOptionalPence(row.erc);
    if (ercPence !== undefined) product.ercPence = ercPence;
    if (declined) {
      product.declineReason = str(
        row.declineReason,
        'Ineligible on Mortgage Brain panel'
      );
    }
    return product;
  });
}

// The scaffold. There is NO `verification` field, so the registry derives
// verified:FALSE — and assertClaimable blocks any snapshot built from it out of
// the evidence pack and every client surface. Wiring a real recorded session +
// live canary (per docs/tos-mortgage-brain.md and connector-mortgage-brain.eval)
// is what would later supply a VerificationRef; this module never does.
export const MORTGAGE_BRAIN_ADAPTER: SourcingAdapterDefinition = {
  id: 'mortgage-brain',
  sessionMode: 'logged_in',
  buildQuery: mortgageBrainBuildQuery,
  extract: mortgageBrainExtract,
  coverage: mortgageBrainCoverage,
};
