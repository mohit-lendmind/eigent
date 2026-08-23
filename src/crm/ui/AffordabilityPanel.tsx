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

// M5 (FR-015) — the affordability panel, adviser-only + indicative. It shows the
// indicative max-borrow and the monthly-at-rate / monthly-at-stress figures, each
// labelled indicative (never a locked-in maximum). Every input carries a small
// verified/synthetic dot: a verified (det) input's dot titles the quote-locator
// it came from, a synthetic (syn) input's dot reads synthetic. A board-level "N
// inputs synthetic" line summarises how much of the figure rests on unverified
// facts. The full working — every step of the sum — sits behind a drawer so the
// adviser can audit the arithmetic. The word "provenance" never appears in copy.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  AffordabilityAssessment,
  AffordabilityInput,
} from '../agentContracts/criteriaAffordability';
import { IndicativeChrome } from './ScenarioBoard';
import { toneClasses } from './tones';

function formatPence(pence: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0,
  }).format(pence / 100);
}

/** A verified/synthetic dot. Colour comes from ds tokens so it stays legible in
 * dark mode; the verified dot titles its quote-locator, the synthetic one reads
 * synthetic. No "provenance" wording. */
function InputDot({ input }: { input: AffordabilityInput }) {
  const { t } = useTranslation();
  const verified = input.provenance === 'det';
  const tone = verified ? toneClasses('success') : toneClasses('warning');
  const title = verified
    ? t('crm.affordability.dot-verified', {
        source: input.sourceRef ?? t('crm.affordability.dot-verified-nosrc'),
      })
    : t('crm.affordability.dot-synthetic');
  return (
    <span
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full border ${tone.bg} ${tone.border}`}
      role="img"
      aria-label={title}
      title={title}
    />
  );
}

export interface AffordabilityPanelProps {
  assessment: AffordabilityAssessment;
}

/**
 * The indicative affordability panel (FR-015). Adviser-only by construction. The
 * figures are indicative; the full working is auditable behind a drawer; the
 * synthetic-input count is surfaced so the adviser knows what the number rests on.
 */
export function AffordabilityPanel({ assessment }: AffordabilityPanelProps) {
  const { t } = useTranslation();
  const [showWorking, setShowWorking] = useState(false);
  const synCount = assessment.inputs.filter(
    (i) => i.provenance === 'syn'
  ).length;
  const results = assessment.results;

  return (
    <section
      className="flex flex-col gap-3"
      aria-label={t('crm.affordability.title')}
    >
      <IndicativeChrome />

      <div className="grid grid-cols-3 gap-2">
        <Figure
          label={t('crm.affordability.max-borrow')}
          value={formatPence(results.maxBorrowPence)}
        />
        <Figure
          label={t('crm.affordability.monthly-at-rate')}
          value={formatPence(results.monthlyAtRatePence)}
        />
        <Figure
          label={t('crm.affordability.monthly-at-stress')}
          value={formatPence(results.monthlyAtStressPence)}
        />
      </div>

      {/* The synthetic-input summary — how much of the figure is unverified. */}
      {synCount > 0 && (
        <p className="text-xs text-ds-text-warning-strong-default">
          {t('crm.affordability.n-synthetic', { count: synCount })}
        </p>
      )}

      {/* Per-input dots. */}
      <ul className="flex flex-col gap-1">
        {assessment.inputs.map((input) => (
          <li
            key={input.key}
            className="flex items-center gap-2 text-xs text-ds-text-neutral-default-default"
          >
            <InputDot input={input} />
            <span className="font-medium text-ds-text-neutral-strong-default">
              {input.key}
            </span>
          </li>
        ))}
      </ul>

      {/* The full working — behind a drawer, keyboard-reachable. */}
      <div>
        <button
          type="button"
          className="text-xs font-medium text-ds-text-brand-strong-default hover:underline"
          aria-expanded={showWorking}
          aria-controls="affordability-working"
          onClick={() => setShowWorking((v) => !v)}
        >
          {t('crm.affordability.show-working')}
        </button>
        {showWorking && (
          <ol
            id="affordability-working"
            className="mt-2 flex flex-col gap-1 rounded-md border border-ds-bg-neutral-default-default bg-ds-bg-neutral-subtle-default p-2 text-xs"
          >
            {assessment.working.map((step, i) => (
              <li key={i} className="text-ds-text-neutral-default-default">
                <span className="font-medium text-ds-text-neutral-strong-default">
                  {step.label}
                </span>
                {': '}
                <code>{step.expression}</code>
                {step.resultPence !== undefined
                  ? ` = ${formatPence(step.resultPence)}`
                  : ''}
                {step.note ? ` (${step.note})` : ''}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-ds-bg-neutral-default-default bg-ds-bg-neutral-subtle-default p-3">
      <div className="text-[11px] uppercase tracking-wide text-ds-text-neutral-muted-default">
        {t('crm.affordability.indicative-tag')}
      </div>
      <div className="text-xs text-ds-text-neutral-default-default">
        {label}
      </div>
      <div className="text-sm font-semibold text-ds-text-neutral-strong-default">
        {value}
      </div>
    </div>
  );
}

export default AffordabilityPanel;
