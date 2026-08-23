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

// M5 (FR-015) — the criteria board, adviser-only by construction. A per-lender
// grid: every panel member shows its indicative verdict, and every NON-pass
// verdict carries an INLINE why-not (the rule + the delta) that is keyboard-
// reachable (a native button) — an excluded lender is never silent. Expanding a
// row opens a drawer with the exact cited text and the rule's as-at date, so the
// adviser sees the provenance behind the machine call. A persistent chrome band
// and a pinned honesty line keep the whole surface reading as indicative, never
// as a lender decision.

import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  CriteriaAssessment,
  CriteriaPack,
  CriteriaReason,
  RuleKey,
  Verdict,
} from '../agentContracts/criteriaAffordability';
import { StatusPill } from './primitives/StatusPill';
import { toneClasses, type CrmTone } from './tones';

const VERDICT_TONE: Record<Verdict, CrmTone> = {
  pass: 'success',
  refer: 'warning',
  fail: 'danger',
};

/**
 * The persistent indicative + adviser-only chrome band with the pinned honesty
 * line. Every M5 surface renders it, so the panel can never be read as a lender
 * decision or as client-facing output.
 */
export function IndicativeChrome() {
  const { t } = useTranslation();
  const info = toneClasses('info');
  return (
    <div
      className={`flex flex-col gap-1 rounded-md border ${info.bg} ${info.text} ${info.border} px-3 py-2 text-sm`}
      role="note"
      aria-label={t('crm.criteria.chrome-label')}
    >
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden />
        <span className="font-medium">{t('crm.criteria.chrome-band')}</span>
      </div>
      <span className="text-xs">{t('crm.criteria.honesty-line')}</span>
    </div>
  );
}

/** Resolve the as-at date of the rule a reason cites, from the pinned pack. */
function ruleAsAt(
  pack: CriteriaPack | undefined,
  lenderId: string,
  ruleKey: RuleKey
): string | null {
  const lender = pack?.lenders.find((l) => l.lenderId === lenderId);
  return lender?.rules.find((r) => r.key === ruleKey)?.asAt ?? null;
}

interface WhyNotRowProps {
  lenderId: string;
  reason: CriteriaReason;
  asAt: string | null;
}

function WhyNotRow({ lenderId, reason, asAt }: WhyNotRowProps) {
  void lenderId;
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const drawerId = `why-${lenderId}-${reason.ruleKey}`;
  return (
    <li className="text-xs text-ds-text-neutral-default-default">
      <button
        type="button"
        className="text-left font-medium text-ds-text-brand-strong-default hover:underline"
        aria-expanded={open}
        aria-controls={drawerId}
        onClick={() => setOpen((v) => !v)}
      >
        {t('crm.criteria.rule-' + reason.ruleKey, {
          defaultValue: reason.ruleKey,
        })}
        {' — '}
        {reason.delta}
        {reason.stale ? ` · ${t('crm.criteria.stale-note')}` : ''}
      </button>
      {open && (
        <div
          id={drawerId}
          className="mt-1 rounded-md border border-ds-bg-neutral-default-default bg-ds-bg-neutral-subtle-default px-2 py-1"
        >
          <p className="text-ds-text-neutral-strong-default">
            “{reason.citedText}”
          </p>
          <p className="mt-1 text-ds-text-neutral-muted-default">
            {asAt
              ? t('crm.criteria.as-at', { date: asAt })
              : t('crm.criteria.as-at-unknown')}
          </p>
        </div>
      )}
    </li>
  );
}

export interface ScenarioBoardProps {
  assessment: CriteriaAssessment;
  /** The pinned pack, so a reason's drawer can show the rule's as-at date. */
  pack?: CriteriaPack;
}

/**
 * The per-lender criteria board (FR-015). Adviser-only by construction: it lives
 * under src/crm and no client-facing module imports it (the no-client-embed test
 * enforces that). Every non-pass verdict carries a keyboard-reachable why-not.
 */
export function ScenarioBoard({ assessment, pack }: ScenarioBoardProps) {
  const { t } = useTranslation();
  return (
    <section
      className="flex flex-col gap-3"
      aria-label={t('crm.criteria.title')}
    >
      <IndicativeChrome />
      <div className="flex flex-col gap-2">
        {assessment.results.map((r) => (
          <article
            key={r.lenderId}
            className="rounded-lg border border-ds-bg-neutral-default-default bg-ds-bg-neutral-subtle-default p-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ds-text-neutral-strong-default">
                {r.lenderId}
              </h3>
              <StatusPill
                tone={VERDICT_TONE[r.verdict]}
                label={t('crm.criteria.verdict-' + r.verdict)}
              />
            </div>
            {r.verdict !== 'pass' && r.reasons.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1">
                {r.reasons.map((reason, i) => (
                  <WhyNotRow
                    key={`${reason.ruleKey}-${i}`}
                    lenderId={r.lenderId}
                    reason={reason}
                    asAt={ruleAsAt(pack, r.lenderId, reason.ruleKey)}
                  />
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

export default ScenarioBoard;
