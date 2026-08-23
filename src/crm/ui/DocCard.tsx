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

// FR-011 (US1) — one document in the vault. The card reads the QUEUED → PROCESSING
// → COMPLETED (or REJECTED) machine straight off the CrmDocument.status and paints
// a status pill for it. Once complete it shows the attribution and a det/syn/
// conflict tally, then the mapped facts as DocInsightRows. Facts that never mapped
// to a fact-find field (no located quote and unverified) are "incidental" and fold
// into a collapsed disclosure so they do not crowd the fields an adviser acts on.

import { useTranslation } from 'react-i18next';
import type { CrmDocument, DocInsight } from '../domain/types';
import { DocInsightRow } from './DocInsightRow';
import { StatusPill } from './primitives/StatusPill';
import { toneClasses, type CrmTone } from './tones';

export interface DocCardProps {
  document: CrmDocument;
  onOpenSource?: (insight: DocInsight) => void;
  onConfirmInsight?: (insight: DocInsight) => void;
}

const STATUS_TONE: Record<CrmDocument['status'], CrmTone> = {
  QUEUED: 'brand',
  PROCESSING: 'info',
  COMPLETED: 'success',
  REJECTED: 'danger',
};

const STATUS_KEY: Record<CrmDocument['status'], string> = {
  QUEUED: 'crm.vault.status-queued',
  PROCESSING: 'crm.vault.status-processing',
  COMPLETED: 'crm.vault.status-completed',
  REJECTED: 'crm.vault.status-rejected',
};

// A fact an adviser acts on: it either verified against the text layer (det) or
// carries a quote to check. Everything else is incidental and gets collapsed.
function isMapped(insight: DocInsight): boolean {
  return insight.src === 'det' || insight.sourceQuote !== undefined;
}

export function DocCard({
  document,
  onOpenSource,
  onConfirmInsight,
}: DocCardProps) {
  const { t } = useTranslation();

  const insights = document.insights ?? [];
  const mapped = insights.filter(isMapped);
  const incidental = insights.filter((i) => !isMapped(i));
  const detCount = insights.filter((i) => i.src === 'det').length;
  const synCount = insights.filter((i) => i.src !== 'det').length;
  const conflictCount = insights.filter((i) => i.conflict === true).length;

  const complete = document.status === 'COMPLETED';

  const attributionLabel =
    document.joint === true
      ? t('crm.vault.attribution-joint')
      : document.attribution !== null
        ? t('crm.vault.attribution', {
            percent: Math.round(document.attribution * 100),
          })
        : t('crm.vault.attribution-unknown');

  return (
    <section
      className="flex flex-col gap-3 rounded-lg border border-ds-bg-neutral-default-default bg-ds-bg-neutral-subtle-default p-4"
      aria-label={document.name}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-ds-text-neutral-strong-default">
            {document.name}
          </span>
          <span className="text-xs text-ds-text-neutral-default-default">
            {document.type} · {attributionLabel}
          </span>
        </div>
        <StatusPill
          tone={STATUS_TONE[document.status]}
          label={t(STATUS_KEY[document.status])}
        />
      </header>

      {complete && (
        <div className="flex gap-2">
          <TallyPill
            tone="success"
            label={t('crm.vault.det-count', { count: detCount })}
          />
          <TallyPill
            tone="warning"
            label={t('crm.vault.syn-count', { count: synCount })}
          />
          {conflictCount > 0 && (
            <TallyPill
              tone="danger"
              label={t('crm.vault.conflict-count', { count: conflictCount })}
            />
          )}
        </div>
      )}

      {complete && mapped.length > 0 && (
        <ul className="flex flex-col gap-2">
          {mapped.map((insight) => (
            <DocInsightRow
              key={insight.id}
              insight={insight}
              onOpenSource={onOpenSource}
              onConfirm={onConfirmInsight}
            />
          ))}
        </ul>
      )}

      {complete && incidental.length > 0 && (
        <details className="rounded-md bg-ds-bg-neutral-muted-default p-2">
          <summary className="cursor-pointer text-xs text-ds-text-neutral-default-default">
            {t('crm.vault.more-insights', { count: incidental.length })}
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {incidental.map((insight) => (
              <DocInsightRow
                key={insight.id}
                insight={insight}
                onOpenSource={onOpenSource}
                onConfirm={onConfirmInsight}
              />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function TallyPill({ tone, label }: { tone: CrmTone; label: string }) {
  const cls = toneClasses(tone);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${cls.bg} ${cls.text}`}
    >
      {label}
    </span>
  );
}
