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

// FR-011 (US1.4/US2) — one extracted fact, rendered with its TRUST on the face.
// A `det` fact carries a verified badge and, when it has a located quote, a
// deep-link that opens the source at the highlighted span (onOpenSource). A `syn`
// fact is never distinguished by colour ALONE: it reads with a distinct icon, the
// word "Unverified", a dashed border, its confidence, and a Confirm control — so
// an adviser on a mono/high-contrast display still sees it needs a human before
// it can satisfy a gate. Every string routes through t().

import { AlertTriangle, ExternalLink, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DocInsight, FieldValue } from '../domain/types';

export interface DocInsightRowProps {
  insight: DocInsight;
  /** Open the source document at this insight's located quote span (det only). */
  onOpenSource?: (insight: DocInsight) => void;
  /** Promote a `syn` fact to verified after a human check (US2). */
  onConfirm?: (insight: DocInsight) => void;
}

function isFieldValue(v: DocInsight['value']): v is FieldValue {
  return typeof v === 'object' && v !== null && 't' in v;
}

/** A display string for an insight value; money is pence → pounds. */
export function formatInsightValue(value: DocInsight['value']): string {
  if (value === null) return '—';
  if (isFieldValue(value)) {
    switch (value.t) {
      case 'money':
        return `£${((value.v as number) / 100).toFixed(2)}`;
      case 'missing':
        return '—';
      default:
        return String(value.v);
    }
  }
  return String(value);
}

export function DocInsightRow({
  insight,
  onOpenSource,
  onConfirm,
}: DocInsightRowProps) {
  const { t } = useTranslation();
  const det = insight.src === 'det';
  const conflicted = insight.conflict === true;
  const canDeepLink =
    det && onOpenSource !== undefined && insight.sourceQuote !== undefined;
  const confidencePct = Math.round(insight.conf * 100);

  return (
    <li
      className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 ${
        det
          ? 'border-ds-bg-success-default-default bg-ds-bg-success-subtle-default'
          : 'border-dashed border-ds-bg-warning-default-default bg-ds-bg-warning-subtle-default'
      }`}
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-ds-text-neutral-strong-default">
          {insight.label}
        </span>
        <span className="text-xs text-ds-text-neutral-default-default">
          {formatInsightValue(insight.value)}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {conflicted && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-ds-text-warning-strong-default">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            {t('crm.insight.conflict')}
          </span>
        )}

        {det ? (
          // Non-colour channel: icon + word "Verified".
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-ds-text-success-strong-default">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            {t('crm.insight.verified')}
          </span>
        ) : (
          // Non-colour channel: distinct icon + word "Unverified" + confidence.
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-ds-text-warning-strong-default">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            {t('crm.insight.unverified')}
            <span className="text-ds-text-neutral-muted-default">
              · {t('crm.insight.confidence', { percent: confidencePct })}
            </span>
          </span>
        )}

        {canDeepLink && (
          <button
            type="button"
            onClick={() => onOpenSource?.(insight)}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-ds-text-brand-strong-default hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            {t('crm.insight.view-source')}
          </button>
        )}

        {!det && onConfirm !== undefined && (
          <button
            type="button"
            onClick={() => onConfirm(insight)}
            className="rounded border border-ds-bg-brand-default-default px-2 py-0.5 text-[11px] font-medium text-ds-text-brand-strong-default hover:bg-ds-bg-brand-subtle-default"
          >
            {t('crm.insight.confirm')}
          </button>
        )}
      </div>
    </li>
  );
}
