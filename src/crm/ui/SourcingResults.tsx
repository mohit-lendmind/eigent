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

// M4 (FR-011/012) — the adviser-only sourcing results surface. Three parts, all
// props-driven off the frozen results contract (specs/005/contracts/results.d.ts):
//
//   • Shortlist — ranked eligible cards (cheapest true-cost first), a COLLAPSED
//     why-not list of declines, and the coverage line PINNED to the header in an
//     info tone so the panel is never read as the whole market. A scaffold
//     (verified:false) wears a watermark band and its export is disabled.
//   • RunRibbon — a narrating ribbon with an ALWAYS-HOT, non-modal take-control
//     and a "Running as <you>" attribution.
//   • RecommendationG5 — the recommend gate: disabled until a product is picked
//     AND a one-line rationale is typed; a staleness warning when rates are stale.
//
// The whole surface is adviser-only by construction: it lives under src/crm and
// no client-facing module may import it (the no-client-embed test enforces that).

import { Button } from '@/components/ui/button';
import { AlertTriangle, Radio, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  Coverage,
  Product,
  SourcingSnapshotPayload,
} from '../agentContracts';
import { exportEvidenceOfResearch } from '../connectors/evidenceExport';
import { StatusPill } from './primitives/StatusPill';
import { toneClasses } from './tones';

// ---- money -----------------------------------------------------------------

function formatPence(pence: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0,
  }).format(pence / 100);
}

/** Eligible first, cheapest true-cost first; declines fall to the end. */
function rankProducts(products: readonly Product[]): {
  eligible: Product[];
  declined: Product[];
} {
  const eligible = products
    .filter((p) => p.status === 'eligible')
    .sort((a, b) => a.trueCostPence - b.trueCostPence);
  const declined = products.filter((p) => p.status === 'declined');
  return { eligible, declined };
}

// ---- Shortlist -------------------------------------------------------------

export interface ShortlistProps {
  snapshot: SourcingSnapshotPayload;
  products: Product[];
  coverage: Coverage;
  /** verified:false → watermark band + export/add-to-suitability disabled. */
  scaffold: boolean;
}

export function Shortlist({
  snapshot,
  products,
  coverage,
  scaffold,
}: ShortlistProps) {
  const { t } = useTranslation();
  const { eligible, declined } = useMemo(
    () => rankProducts(products),
    [products]
  );
  const [showDeclines, setShowDeclines] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const info = toneClasses('info');
  const warning = toneClasses('warning');

  const onExport = () => {
    const result = exportEvidenceOfResearch(snapshot);
    setExportMsg(
      result.ok
        ? t('crm.results.export-ok', { id: result.bundleId })
        : t('crm.results.export-blocked', { reason: result.reason })
    );
  };

  return (
    <section
      className="flex flex-col gap-3"
      aria-label={t('crm.results.title')}
    >
      {/* Coverage pinned to the header, info tone — never exceeded. */}
      <div
        className={`flex items-center gap-2 rounded-md border ${info.bg} ${info.text} ${info.border} px-3 py-2 text-sm`}
        role="note"
      >
        <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden />
        <span>{coverage.statement}</span>
      </div>

      {/* The scaffold watermark band: this run is unverified. */}
      {scaffold && (
        <div
          className={`flex items-center gap-2 rounded-md border ${warning.bg} ${warning.text} ${warning.border} px-3 py-2 text-sm`}
          role="alert"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          <span>{t('crm.results.scaffold-watermark')}</span>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {eligible.length === 0 ? (
          <p className="text-sm text-ds-text-neutral-default-default">
            {t('crm.results.empty')}
          </p>
        ) : (
          eligible.map((p, i) => (
            <article
              key={p.lenderId}
              className="rounded-lg border border-ds-bg-neutral-default-default bg-ds-bg-neutral-subtle-default p-3"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-ds-text-neutral-strong-default">
                  {p.productName}
                </h3>
                {i === 0 && (
                  <StatusPill
                    tone="success"
                    label={t('crm.results.best-true-cost')}
                  />
                )}
              </div>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-xs text-ds-text-neutral-default-default">
                <div>
                  <dt>{t('crm.results.rate')}</dt>
                  <dd className="font-medium text-ds-text-neutral-strong-default">
                    {p.rate}%
                  </dd>
                </div>
                <div>
                  <dt>{t('crm.results.monthly')}</dt>
                  <dd className="font-medium text-ds-text-neutral-strong-default">
                    {formatPence(p.monthlyPence)}
                  </dd>
                </div>
                <div>
                  <dt>{t('crm.results.true-cost')}</dt>
                  <dd className="font-medium text-ds-text-neutral-strong-default">
                    {formatPence(p.trueCostPence)}
                  </dd>
                </div>
              </dl>
            </article>
          ))
        )}
      </div>

      {/* Why-not: collapsed by default so declines are available, not loud. */}
      {declined.length > 0 && (
        <div>
          <button
            type="button"
            className="text-xs font-medium text-ds-text-brand-strong-default hover:underline"
            aria-expanded={showDeclines}
            onClick={() => setShowDeclines((v) => !v)}
          >
            {t('crm.results.why-not', { count: declined.length })}
          </button>
          {showDeclines && (
            <ul className="mt-2 flex flex-col gap-1">
              {declined.map((p) => (
                <li
                  key={p.lenderId}
                  className="text-xs text-ds-text-neutral-default-default"
                >
                  <span className="font-medium">{p.productName}</span>
                  {p.declineReason ? ` — ${p.declineReason}` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={scaffold}
          title={scaffold ? t('crm.results.export-disabled-title') : undefined}
          onClick={onExport}
        >
          {t('crm.results.export')}
        </Button>
        {exportMsg && (
          <span className="text-xs text-ds-text-neutral-default-default">
            {exportMsg}
          </span>
        )}
      </div>
    </section>
  );
}

// ---- RunRibbon -------------------------------------------------------------

export interface RunRibbonProps {
  currentAction: string;
  runningAsAdviser: string;
  onTakeControl: () => void;
}

export function RunRibbon({
  currentAction,
  runningAsAdviser,
  onTakeControl,
}: RunRibbonProps) {
  const { t } = useTranslation();
  const brand = toneClasses('brand');
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-md border ${brand.bg} ${brand.text} ${brand.border} px-3 py-2`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 text-sm">
        <Radio className="h-4 w-4 shrink-0 animate-pulse" aria-hidden />
        <span>{currentAction}</span>
        <span className="text-xs text-ds-text-neutral-default-default">
          {t('crm.results.running-as', { adviser: runningAsAdviser })}
        </span>
      </div>
      {/* Always hot, non-modal: the adviser can seize the wheel at any instant. */}
      <Button size="sm" variant="outline" onClick={onTakeControl}>
        {t('crm.results.take-control')}
      </Button>
    </div>
  );
}

// ---- RecommendationG5 ------------------------------------------------------

export interface G5Props {
  snapshot: SourcingSnapshotPayload;
  onRecommend: (productId: string, rationale: string) => void;
  ratesStale: boolean;
}

export function RecommendationG5({
  snapshot,
  onRecommend,
  ratesStale,
}: G5Props) {
  const { t } = useTranslation();
  const [productId, setProductId] = useState('');
  const [rationale, setRationale] = useState('');
  const warning = toneClasses('warning');

  // The gate is closed until BOTH a product is picked and a rationale is typed.
  const ready = productId.trim().length > 0 && rationale.trim().length > 0;

  return (
    <section
      className="flex flex-col gap-2 rounded-lg border border-ds-bg-neutral-default-default bg-ds-bg-neutral-subtle-default p-3"
      aria-label={t('crm.results.g5-title')}
    >
      <h3 className="text-sm font-semibold text-ds-text-neutral-strong-default">
        {t('crm.results.g5-title')}
      </h3>

      {ratesStale && (
        <div
          className={`flex items-center gap-2 rounded-md border ${warning.bg} ${warning.text} ${warning.border} px-3 py-2 text-xs`}
          role="alert"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          <span>{t('crm.results.rates-stale')}</span>
        </div>
      )}

      <label className="text-xs text-ds-text-neutral-default-default">
        {t('crm.results.pick-product')}
        <input
          type="text"
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          className="mt-1 w-full rounded-md border border-ds-bg-neutral-default-default bg-ds-bg-neutral-default-default px-2 py-1 text-sm text-ds-text-neutral-strong-default"
          placeholder={t('crm.results.pick-product-placeholder')}
        />
      </label>

      <label className="text-xs text-ds-text-neutral-default-default">
        {t('crm.results.rationale')}
        <textarea
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-md border border-ds-bg-neutral-default-default bg-ds-bg-neutral-default-default px-2 py-1 text-sm text-ds-text-neutral-strong-default"
          placeholder={t('crm.results.rationale-placeholder')}
        />
      </label>

      <div>
        <Button
          size="sm"
          disabled={!ready}
          title={!ready ? t('crm.results.g5-disabled-title') : undefined}
          onClick={() => onRecommend(productId.trim(), rationale.trim())}
        >
          {t('crm.results.recommend')}
        </Button>
      </div>

      <p className="text-[11px] text-ds-text-neutral-muted-default">
        {t('crm.results.adviser-only-note', { adapter: snapshot.adapterId })}
      </p>
    </section>
  );
}

// ---- route component -------------------------------------------------------

/**
 * The /crm/results route. M4 ships the surface additively next to the M2 Today
 * queue. Until a live run is wired into the store, the tab shows the empty state;
 * the presentational parts above are what a run renders (and what the tests
 * drive), all adviser-only by construction.
 */
export function SourcingResults() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4 p-6">
      <header>
        <h1 className="text-lg font-semibold text-ds-text-neutral-strong-default">
          {t('crm.results.title')}
        </h1>
        <p className="text-sm text-ds-text-neutral-default-default">
          {t('crm.results.subtitle')}
        </p>
      </header>
      <p className="text-sm text-ds-text-neutral-default-default">
        {t('crm.results.empty')}
      </p>
    </div>
  );
}

export default SourcingResults;
