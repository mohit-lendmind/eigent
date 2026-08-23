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

// M4 (FR-002) — the MSE adapter. MSE's mortgage best-buy tool is PUBLIC and
// serves its table from a JSON endpoint, so this adapter runs in an ISOLATED
// window and its plan captures that JSON response (console-fetch intercept)
// rather than scraping the DOM. buildQuery emits a DECLARATIVE plan the parked-
// delegation pump runs — this module never drives the browser executor. extract
// is PURE: it turns the captured JSON into normalized Products with no browser,
// login, or model in the loop, which is exactly what makes the replay eval a
// real verification of THIS extractor.
//
// Coverage is FIXED by MCOB 4.4A: "MSE Best Buys (Podium) — not whole of
// market". It is never presented as the whole market.

import type {
  Product,
  QueryStep,
  SourcingAdapterDefinition,
  VerificationRef,
} from '../SourcingAdapter';
import { mseCoverage } from '../coverage';

// The public MSE mortgage best-buy comparison and the JSON endpoint its table is
// hydrated from. The plan opens the page and captures the response matching this
// path — the isolated window sees the fetch the page itself makes.
export const MSE_URL =
  'https://www.moneysavingexpert.com/mortgages/mortgage-best-buys/';
export const MSE_RESULTS_MATCH = '/api/mortgage-best-buys';

// The case facts the plan fills. Kept to the fields MSE's tool actually takes;
// anything absent falls to the tool's own default so a partial fact-find still
// returns a table.
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
 * The declarative plan (FR-001): open MSE in the isolated window, apply the case
 * facts, and capture the best-buys JSON. The pump runs these; the adapter does
 * not touch the executor.
 */
export function mseBuildQuery(caseFacts: Record<string, unknown>): QueryStep[] {
  return [
    { tool: 'browser.open', args: { url: MSE_URL, session: 'isolated' } },
    { tool: 'browser.fill', args: { fields: fillArgs(caseFacts) } },
    { tool: 'browser.submit', args: {} },
    { tool: 'browser.captureJson', args: { urlIncludes: MSE_RESULTS_MATCH } },
  ];
}

// The captured JSON's row shape. MSE serves money as pence and rates as percent
// numbers; declines ride with a reason so the evidence pack shows the rejected.
interface MseDealRow {
  lenderId?: unknown;
  lenderName?: unknown;
  productName?: unknown;
  initialRatePct?: unknown;
  aprcPct?: unknown;
  productFeePence?: unknown;
  monthlyPaymentPence?: unknown;
  trueCostPence?: unknown;
  revertRatePct?: unknown;
  ercPence?: unknown;
  eligible?: unknown;
  declineReason?: unknown;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function optionalNum(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

/**
 * PURE extractor (FR-003): captured MSE JSON → normalized Products. No browser,
 * login, or model — so replaying a recorded capture through this is a real,
 * deterministic verification. Reads `deals` (or `results`) and normalizes each
 * row; a row flagged not-eligible becomes a `declined` product carrying its
 * reason rather than being dropped, so the full set shows what was rejected.
 */
export function mseExtract(recordedResult: unknown): Product[] {
  const root = (recordedResult ?? {}) as Record<string, unknown>;
  const rawRows = Array.isArray(root.deals)
    ? root.deals
    : Array.isArray(root.results)
      ? root.results
      : [];
  return (rawRows as MseDealRow[]).map((row, i) => {
    const eligible = row.eligible !== false;
    const product: Product = {
      lenderId: str(row.lenderId, `mse-lender-${i}`),
      productName: str(row.productName, 'MSE best buy'),
      rate: num(row.initialRatePct),
      aprc: num(row.aprcPct),
      feesPence: num(row.productFeePence),
      monthlyPence: num(row.monthlyPaymentPence),
      trueCostPence: num(row.trueCostPence),
      status: eligible ? 'eligible' : 'declined',
    };
    const revertRate = optionalNum(row.revertRatePct);
    if (revertRate !== undefined) product.revertRate = revertRate;
    const ercPence = optionalNum(row.ercPence);
    if (ercPence !== undefined) product.ercPence = ercPence;
    if (!eligible) {
      product.declineReason = str(
        row.declineReason,
        'Not eligible on MSE panel'
      );
    }
    return product;
  });
}

// The evidence the MSE extractor's verification stands on. fixtureHash and
// rawEvidencePointer name the SCRUBBED replay fixture the CI eval verifies
// extract against; ratesAsAt is the rates date that capture was taken on.
//
// canaryPassedAt is DELIBERATELY ABSENT: it is stamped by the nightly live
// canary (e2e/connector-mse.eval.ts) when it passes against real MSE, and by
// nothing else. So at rest the adapter derives verified:FALSE — a live snapshot
// becomes claimable only once a real canary has run and supplied that timestamp.
// This is the honesty spine: `verified` is earned by a passing canary, never
// hand-set here.
export const MSE_REPLAY_VERIFICATION: VerificationRef = {
  fixtureHash: 'see:e2e/fixtures/mse.fixture.json',
  ratesAsAt: '2026-08-22',
  rawEvidencePointer: 'e2e/fixtures/mse.fixture.json',
};

export const MSE_ADAPTER: SourcingAdapterDefinition = {
  id: 'mse',
  sessionMode: 'isolated',
  buildQuery: mseBuildQuery,
  extract: mseExtract,
  coverage: mseCoverage,
  verification: MSE_REPLAY_VERIFICATION,
};
