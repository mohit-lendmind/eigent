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

// M5 (FR-015) — the side-by-side scenario comparison, adviser-only. Up to four
// scenarios sit as columns (the base first); each counterfactual highlights the
// lender verdict FLIPS and the max-borrow / monthly deltas relative to the base,
// so the adviser reads the consequence of a change at a glance. When a scenario
// yields ZERO indicative passes, the closest misses lead (a refer is closer than
// a fail, and fewer failing reasons is closer still) — the surface never dead-
// ends on "nothing works" without pointing at the nearest lever. The blocked
// states (income not verified, pack stale, no pack loaded) each render an honest
// band instead of a grid — the comparison is never shown on an unsafe basis.

import { AlertTriangle } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  CriteriaLenderResult,
  ScenarioResult,
  Verdict,
} from '../agentContracts/criteriaAffordability';
import { diffScenarios } from '../criteria/counterfactual';
import { StatusPill } from './primitives/StatusPill';
import { IndicativeChrome } from './ScenarioBoard';
import { toneClasses, type CrmTone } from './tones';

const MAX_VISIBLE = 4;

const VERDICT_TONE: Record<Verdict, CrmTone> = {
  pass: 'success',
  refer: 'warning',
  fail: 'danger',
};

const VERDICT_RANK: Record<Verdict, number> = { pass: 0, refer: 1, fail: 2 };

function formatDeltaPence(pence: number): string {
  const sign = pence > 0 ? '+' : pence < 0 ? '−' : '';
  const abs = Math.abs(pence) / 100;
  return `${sign}${new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0,
  }).format(abs)}`;
}

/** Closest-miss-first: a refer is closer to a pass than a fail; among equals,
 * fewer failing reasons is closer. Pure + stable. */
export function closestMissFirst(
  results: readonly CriteriaLenderResult[]
): CriteriaLenderResult[] {
  return [...results].sort((a, b) => {
    const byVerdict = VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict];
    if (byVerdict !== 0) return byVerdict;
    return a.reasons.length - b.reasons.length;
  });
}

export type ComparisonBlock = 'g9-blocked' | 'stale-pack' | 'no-sourcing';

export interface ScenarioComparisonProps {
  scenarios: readonly ScenarioResult[];
  /** A blocked state renders an honest band instead of the grid. */
  block?: ComparisonBlock;
  /** The G9 steps that must be verified first (when block === 'g9-blocked'). */
  blockingSteps?: readonly string[];
  /** The pack's as-at date (when block === 'stale-pack'). */
  packAsAt?: string;
}

function BlockedBand({
  block,
  blockingSteps,
  packAsAt,
}: {
  block: ComparisonBlock;
  blockingSteps?: readonly string[];
  packAsAt?: string;
}) {
  const { t } = useTranslation();
  const warning = toneClasses('warning');
  const message =
    block === 'g9-blocked'
      ? t('crm.scenario.blocked-g9')
      : block === 'stale-pack'
        ? t('crm.scenario.blocked-stale', { date: packAsAt ?? '' })
        : t('crm.scenario.blocked-no-sourcing');
  return (
    <div
      className={`flex flex-col gap-1 rounded-md border ${warning.bg} ${warning.text} ${warning.border} px-3 py-2 text-sm`}
      role="alert"
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
        <span>{message}</span>
      </div>
      {block === 'g9-blocked' && blockingSteps && blockingSteps.length > 0 && (
        <ul className="ml-6 list-disc text-xs">
          {blockingSteps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function passCount(s: ScenarioResult): number {
  return s.criteria.results.filter((r) => r.verdict === 'pass').length;
}

function ScenarioColumn({
  scenario,
  base,
  index,
}: {
  scenario: ScenarioResult;
  base: ScenarioResult;
  index: number;
}) {
  const { t } = useTranslation();
  const isBase = index === 0;
  const diff = useMemo(
    () => (isBase ? null : diffScenarios(base, scenario)),
    [isBase, base, scenario]
  );
  const passes = passCount(scenario);
  const zeroPass = passes === 0;
  const ordered = useMemo(
    () => (zeroPass ? closestMissFirst(scenario.criteria.results) : null),
    [zeroPass, scenario]
  );

  return (
    <div className="flex min-w-[180px] flex-1 flex-col gap-2 rounded-lg border border-ds-bg-neutral-default-default bg-ds-bg-neutral-subtle-default p-3">
      <h3 className="text-sm font-semibold text-ds-text-neutral-strong-default">
        {isBase
          ? t('crm.scenario.base')
          : t('crm.scenario.what-if', { n: index })}
      </h3>

      <div className="text-xs text-ds-text-neutral-default-default">
        {t('crm.scenario.pass-count', { count: passes })}
      </div>

      {/* Flips vs base — highlighted so a consequence is unmissable. */}
      {diff && diff.lenderFlips.length > 0 && (
        <ul className="flex flex-col gap-1">
          {diff.lenderFlips.map((f) => (
            <li key={f.lenderId} className="flex items-center gap-1 text-xs">
              <span className="text-ds-text-neutral-strong-default">
                {f.lenderId}
              </span>
              <StatusPill
                tone={VERDICT_TONE[f.from]}
                label={t('crm.criteria.verdict-' + f.from)}
              />
              <span aria-hidden>→</span>
              <StatusPill
                tone={VERDICT_TONE[f.to]}
                label={t('crm.criteria.verdict-' + f.to)}
              />
            </li>
          ))}
        </ul>
      )}

      {/* Max / monthly deltas vs base. */}
      {diff && (
        <dl className="grid grid-cols-2 gap-1 text-xs">
          <div>
            <dt className="text-ds-text-neutral-muted-default">
              {t('crm.scenario.max-delta')}
            </dt>
            <dd className="font-medium text-ds-text-neutral-strong-default">
              {formatDeltaPence(diff.maxBorrowDeltaPence)}
            </dd>
          </div>
          <div>
            <dt className="text-ds-text-neutral-muted-default">
              {t('crm.scenario.monthly-delta')}
            </dt>
            <dd className="font-medium text-ds-text-neutral-strong-default">
              {formatDeltaPence(diff.monthlyAtRateDeltaPence)}
            </dd>
          </div>
        </dl>
      )}

      {/* Zero indicative passes: lead with the closest miss. */}
      {zeroPass && ordered && (
        <div>
          <p className="text-xs font-medium text-ds-text-warning-strong-default">
            {t('crm.scenario.zero-pass')}
          </p>
          <ol className="mt-1 flex flex-col gap-1 text-xs">
            {ordered.slice(0, 3).map((r) => (
              <li key={r.lenderId} className="flex items-center gap-1">
                <StatusPill
                  tone={VERDICT_TONE[r.verdict]}
                  label={t('crm.criteria.verdict-' + r.verdict)}
                />
                <span className="text-ds-text-neutral-strong-default">
                  {r.lenderId}
                </span>
                {r.reasons[0] && (
                  <span className="text-ds-text-neutral-muted-default">
                    {r.reasons[0].delta}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

/**
 * The side-by-side scenario comparison (FR-015). Adviser-only by construction.
 * Renders a blocked band when the basis is unsafe; otherwise up to four columns
 * with flips + deltas, and a closest-miss-first list when a scenario zero-passes.
 */
export function ScenarioComparison({
  scenarios,
  block,
  blockingSteps,
  packAsAt,
}: ScenarioComparisonProps) {
  const { t } = useTranslation();

  if (block) {
    return (
      <section
        className="flex flex-col gap-3"
        aria-label={t('crm.scenario.title')}
      >
        <IndicativeChrome />
        <BlockedBand
          block={block}
          blockingSteps={blockingSteps}
          packAsAt={packAsAt}
        />
      </section>
    );
  }

  const visible = scenarios.slice(0, MAX_VISIBLE);
  const base = visible[0];

  return (
    <section
      className="flex flex-col gap-3"
      aria-label={t('crm.scenario.title')}
    >
      <IndicativeChrome />
      {scenarios.length > MAX_VISIBLE && (
        <p className="text-xs text-ds-text-neutral-muted-default">
          {t('crm.scenario.showing-n', {
            shown: MAX_VISIBLE,
            total: scenarios.length,
          })}
        </p>
      )}
      {base ? (
        <div className="flex flex-wrap gap-2">
          {visible.map((s, i) => (
            <ScenarioColumn
              key={s.scenarioId}
              scenario={s}
              base={base}
              index={i}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-ds-text-neutral-default-default">
          {t('crm.scenario.empty')}
        </p>
      )}
    </section>
  );
}

export default ScenarioComparison;
