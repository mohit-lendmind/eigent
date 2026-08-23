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

// M5 (FR-013) — the G6 criteria override control. Overruling an indicative
// verdict is a deliberate, two-step human act: the confirm step shows the
// ORIGINAL machine verdict the adviser is overruling, forces a one-line
// rationale (the confirm button stays closed until it is typed), and states in
// plain words that the override raises a compliance flag. A stale-rule override
// says so. Confirming hands the audited record up to the caller (recordCriteria-
// Override), which raises G6 and folds the original verdict + adviser + rationale.

import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Verdict } from '../agentContracts/criteriaAffordability';
import { StatusPill } from './primitives/StatusPill';
import { toneClasses, type CrmTone } from './tones';

const VERDICT_TONE: Record<Verdict, CrmTone> = {
  pass: 'success',
  refer: 'warning',
  fail: 'danger',
};

export interface CriteriaOverrideConfirm {
  lenderId: string;
  originalVerdict: Verdict;
  overrideVerdict: Verdict;
  rationale: string;
  stale?: boolean;
}

export interface CriteriaOverrideProps {
  lenderId: string;
  /** The machine verdict being overruled — shown at confirm, never dropped. */
  originalVerdict: Verdict;
  /** The verdict the adviser is asserting instead (defaults to pass). */
  overrideVerdict?: Verdict;
  /** True when the cited rule was stale — the confirm step notes it. */
  stale?: boolean;
  onConfirm: (confirm: CriteriaOverrideConfirm) => void;
}

/**
 * The G6 override control (FR-013). Two-step: an arm button, then a confirm panel
 * that shows the original verdict, forces a rationale, and warns the override
 * raises a compliance flag. The override never edits the engine — it annotates.
 */
export function CriteriaOverride({
  lenderId,
  originalVerdict,
  overrideVerdict = 'pass',
  stale,
  onConfirm,
}: CriteriaOverrideProps) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [rationale, setRationale] = useState('');
  const warning = toneClasses('warning');
  const ready = rationale.trim().length > 0;

  if (!confirming) {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={() => setConfirming(true)}
        aria-label={t('crm.criteria.override-arm', { lender: lenderId })}
      >
        {t('crm.criteria.override-arm-label')}
      </Button>
    );
  }

  return (
    <section
      className="flex flex-col gap-2 rounded-lg border border-ds-bg-neutral-default-default bg-ds-bg-neutral-subtle-default p-3"
      aria-label={t('crm.criteria.override-title', { lender: lenderId })}
    >
      <h3 className="text-sm font-semibold text-ds-text-neutral-strong-default">
        {t('crm.criteria.override-title', { lender: lenderId })}
      </h3>

      {/* The original verdict — the thing being overruled, shown explicitly. */}
      <div className="flex items-center gap-2 text-xs text-ds-text-neutral-default-default">
        <span>{t('crm.criteria.override-original')}</span>
        <StatusPill
          tone={VERDICT_TONE[originalVerdict]}
          label={t('crm.criteria.verdict-' + originalVerdict)}
        />
        <span aria-hidden>→</span>
        <StatusPill
          tone={VERDICT_TONE[overrideVerdict]}
          label={t('crm.criteria.verdict-' + overrideVerdict)}
        />
      </div>

      {/* The standing compliance flag — plain words, never softened. */}
      <div
        className={`flex items-center gap-2 rounded-md border ${warning.bg} ${warning.text} ${warning.border} px-2 py-1 text-xs`}
        role="alert"
      >
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
        <span>{t('crm.criteria.override-flag')}</span>
      </div>

      {stale && (
        <p className="text-xs text-ds-text-warning-strong-default">
          {t('crm.criteria.override-stale')}
        </p>
      )}

      <label className="text-xs text-ds-text-neutral-default-default">
        {t('crm.criteria.override-rationale')}
        <textarea
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-md border border-ds-bg-neutral-default-default bg-ds-bg-neutral-default-default px-2 py-1 text-sm text-ds-text-neutral-strong-default"
          placeholder={t('crm.criteria.override-rationale-placeholder')}
        />
      </label>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={!ready}
          title={!ready ? t('crm.criteria.override-disabled-title') : undefined}
          onClick={() =>
            onConfirm({
              lenderId,
              originalVerdict,
              overrideVerdict,
              rationale: rationale.trim(),
              ...(stale ? { stale: true } : {}),
            })
          }
        >
          {t('crm.criteria.override-confirm')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setConfirming(false);
            setRationale('');
          }}
        >
          {t('crm.criteria.override-cancel')}
        </Button>
      </div>
    </section>
  );
}

export default CriteriaOverride;
