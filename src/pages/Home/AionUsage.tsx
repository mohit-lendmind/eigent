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

// What the tenant's runs cost, as aion reports it. Three things this surface
// refuses to do, each of them a way of quietly overstating certainty: show a
// run with no recorded figure as $0.00, show a zero cost beside real provider
// calls as if the calls were free, and present the totals as the bill while
// settled runs are still missing a figure.

import { Button } from '@/components/ui/button';
import { TooltipSimple } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  formatMicroUsd,
  runCost,
  type AionRunSpend,
  type AionUsageTotals,
} from '@/store/aionUsageStore';
import { AlertCircle, Receipt } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useHomeHub } from './context';
import { useAionUsage } from './hooks/useAionUsage';
import {
  compareHubByName,
  compareHubByTimestamp,
  formatHubRelativeAgo,
  matchesHubNameSearch,
} from './utils';

const GRID_CLASS =
  'grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_120px_88px_112px] gap-x-4 px-3';

function Banner({ message }: { message: string }) {
  return (
    <div
      className="mx-6 flex items-center gap-3 rounded-2xl bg-ds-bg-neutral-default-default px-4 py-3.5"
      role="alert"
      data-testid="aion-usage-banner"
    >
      <AlertCircle className="h-5 w-5 shrink-0 text-ds-icon-status-error-default-default" />
      <span className="text-body-sm text-ds-text-neutral-default-default">
        {message}
      </span>
    </div>
  );
}

function Stat({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl bg-ds-bg-neutral-default-default px-4 py-3">
      <span className="truncate !text-label-sm font-normal leading-none text-ds-text-neutral-muted-default">
        {label}
      </span>
      <span
        className="truncate text-body-md tabular-nums text-ds-text-neutral-default-default"
        data-testid={testId}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * The window totals. `runs_unrecorded` is rendered as a sentence and not as a
 * fourth number, because its consequence — these sums are a lower bound — is
 * the part a reader has to act on.
 */
function Totals({ totals }: { totals: AionUsageTotals }) {
  const { t } = useTranslation();
  return (
    <div className="mb-4 flex flex-col gap-2" data-testid="aion-usage-totals">
      <div className="grid grid-cols-3 gap-3">
        <Stat
          label={t('layout.usage-total-cost')}
          value={formatMicroUsd(totals.costMicroUsd)}
          testId="aion-usage-total-cost"
        />
        <Stat
          label={t('layout.usage-total-calls')}
          value={totals.providerCalls.toLocaleString('en-US')}
          testId="aion-usage-total-calls"
        />
        <Stat
          label={t('layout.usage-runs-settled')}
          value={totals.runsSettled.toLocaleString('en-US')}
          testId="aion-usage-runs-settled"
        />
      </div>
      {totals.runsUnrecorded > 0n ? (
        <div
          className="px-1 text-body-xs text-ds-text-neutral-muted-default"
          data-testid="aion-usage-floor-note"
        >
          {t('layout.usage-floor-note', {
            runs: totals.runsUnrecorded.toLocaleString('en-US'),
          })}
        </div>
      ) : null}
    </div>
  );
}

/** The cost cell, which is where the three states have to stay apart. */
function CostCell({ run }: { run: AionRunSpend }) {
  const { t } = useTranslation();
  const cost = runCost(run);
  if (cost.kind === 'pending') {
    return (
      <TooltipSimple content={t('layout.usage-cost-pending-tooltip')}>
        <span
          className="truncate text-right text-body-xs italic text-ds-text-neutral-muted-default"
          data-testid="aion-usage-cost-pending"
        >
          {t('layout.usage-cost-pending')}
        </span>
      </TooltipSimple>
    );
  }
  if (cost.kind === 'unpriced') {
    return (
      <TooltipSimple
        content={t('layout.usage-cost-unpriced-tooltip', {
          calls: cost.providerCalls.toLocaleString('en-US'),
        })}
      >
        <span
          className="text-ds-text-status-warning-strong-default truncate text-right text-body-xs"
          data-testid="aion-usage-cost-unpriced"
        >
          {t('layout.usage-cost-unpriced')}
        </span>
      </TooltipSimple>
    );
  }
  return (
    <span
      className="truncate text-right text-body-xs tabular-nums text-ds-text-neutral-default-default"
      data-testid="aion-usage-cost-amount"
    >
      {formatMicroUsd(cost.microUsd)}
    </span>
  );
}

export default function AionUsage() {
  const { t } = useTranslation();
  const { searchQuery, sortBy, sortDirection } = useHomeHub();
  const {
    mode,
    totals,
    runs,
    nextPageToken,
    loading,
    loadingMore,
    error,
    loadMore,
  } = useAionUsage();

  const visible = useMemo(() => {
    // A run is searched by the two identifiers the row shows; there is no name
    // on a run to match against.
    const filtered = runs.filter(
      (run) =>
        matchesHubNameSearch(searchQuery, run.runId) ||
        matchesHubNameSearch(searchQuery, run.projectId)
    );
    return [...filtered].sort((a, b) => {
      if (sortBy === 'name') {
        return compareHubByName(a.runId, b.runId, sortDirection);
      }
      return compareHubByTimestamp(a.endedAt, b.endedAt, sortDirection);
    });
  }, [runs, searchQuery, sortBy, sortDirection]);

  if (mode === null || loading) {
    return (
      <div className="flex w-full min-w-0 flex-col">
        <div className="pb-12 text-body-sm text-ds-text-neutral-muted-default">
          {t('layout.loading')}
        </div>
      </div>
    );
  }
  if (mode.kind === 'unsupported') {
    return (
      <Banner
        message={t('layout.usage-backend-too-old', {
          version: mode.edgeApiVersion,
        })}
      />
    );
  }
  if (mode.kind === 'error') {
    return (
      <Banner
        message={t('layout.usage-remote-error', { message: mode.message })}
      />
    );
  }
  // A page that failed with nothing loaded is the whole surface failing; a page
  // that failed while extending the list keeps the rows and reports below them.
  if (error && !totals) {
    return (
      <Banner message={t('layout.usage-remote-error', { message: error })} />
    );
  }

  return (
    <div className="flex w-full min-w-0 flex-col" data-testid="aion-usage">
      <div className="mb-12 w-full min-w-0">
        {totals ? <Totals totals={totals} /> : null}
        {runs.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-5 text-center">
            <Receipt className="mb-4 h-12 w-12 text-ds-icon-neutral-muted-default" />
            <div className="text-sm text-ds-text-neutral-muted-default">
              {t('layout.usage-empty')}
            </div>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-5 text-center">
            <div className="text-sm text-ds-text-neutral-muted-default">
              {t('layout.search-no-results')}
            </div>
          </div>
        ) : (
          <>
            <div className={cn('grid items-center py-2.5', GRID_CLASS)}>
              {[
                'layout.usage-list-run',
                'layout.usage-list-project',
                'layout.usage-list-cost',
                'layout.usage-list-calls',
                'layout.usage-list-settled',
              ].map((key, index) => (
                <span
                  key={key}
                  className={cn(
                    'truncate !text-label-sm font-normal leading-none text-ds-text-neutral-muted-default',
                    index >= 2 ? 'text-right' : 'text-left'
                  )}
                >
                  {t(key)}
                </span>
              ))}
            </div>
            <div className="flex flex-col gap-1">
              {visible.map((run) => (
                <div
                  key={run.runId}
                  data-testid="aion-usage-row"
                  data-run-id={run.runId}
                  className={cn(
                    'grid w-full items-center rounded-xl border border-solid border-transparent bg-ds-bg-neutral-default-default py-2.5',
                    GRID_CLASS
                  )}
                >
                  <span className="truncate text-body-sm text-ds-text-neutral-default-default">
                    {run.runId}
                  </span>
                  <span className="truncate text-body-xs text-ds-text-neutral-muted-default">
                    {run.projectId}
                  </span>
                  <CostCell run={run} />
                  <span
                    className="truncate text-right text-body-xs tabular-nums text-ds-text-neutral-muted-default"
                    data-testid="aion-usage-calls"
                  >
                    {run.spend
                      ? run.spend.providerCalls.toLocaleString('en-US')
                      : '—'}
                  </span>
                  <span className="truncate text-right text-body-xs tabular-nums text-ds-text-neutral-muted-default">
                    {run.endedAt > 0
                      ? formatHubRelativeAgo(run.endedAt, t)
                      : '—'}
                  </span>
                </div>
              ))}
            </div>
            {error ? (
              <div
                className="px-3 pt-3 text-body-xs text-ds-text-status-error-strong-default"
                role="alert"
                data-testid="aion-usage-error"
              >
                {t('layout.usage-remote-error', { message: error })}
              </div>
            ) : null}
            {nextPageToken ? (
              <div className="flex justify-center pt-4">
                <Button
                  variant="secondary"
                  size="sm"
                  data-testid="aion-usage-load-more"
                  disabled={loadingMore}
                  onClick={loadMore}
                >
                  {loadingMore
                    ? t('layout.loading')
                    : t('layout.usage-load-more')}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
