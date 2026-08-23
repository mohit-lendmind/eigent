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

// FR-011 (US1.4) — the source deep-link surface. A `det` fact carries the exact
// born-digital quote that verified it (DocInsight.sourceQuote) plus a page/line
// locator. This panel opens on that fact and shows the located quote HIGHLIGHTED,
// so an adviser confirms the number against the document without leaving the
// vault. Self-contained (no dependency on the generic ArtifactViewer): the quote
// span is the trust-spine evidence and is shown verbatim, never a model summary.

import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DocInsight } from '../domain/types';
import { formatInsightValue } from './DocInsightRow';

export interface SourceQuoteViewerProps {
  insight: DocInsight;
  onClose: () => void;
}

export function SourceQuoteViewer({
  insight,
  onClose,
}: SourceQuoteViewerProps) {
  const { t } = useTranslation();
  const locator = insight.locator;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('crm.vault.source-title')}
      className="fixed inset-0 z-50 flex items-center justify-center bg-dialog-overlay-scrim p-6"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-lg flex-col gap-3 rounded-lg border border-ds-bg-neutral-default-default bg-ds-bg-neutral-subtle-default p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold text-ds-text-neutral-strong-default">
              {t('crm.vault.source-title')}
            </span>
            <span className="text-xs text-ds-text-neutral-default-default">
              {insight.label} · {formatInsightValue(insight.value)}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('crm.vault.source-close')}
            className="rounded p-1 text-ds-text-neutral-muted-default hover:bg-ds-bg-neutral-muted-default"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        {locator !== undefined && (
          <span className="text-xs text-ds-text-neutral-muted-default">
            {t('crm.vault.source-page', { page: locator.page })}
            {locator.line !== undefined
              ? ` · ${t('crm.vault.source-line', { line: locator.line })}`
              : ''}
          </span>
        )}

        <blockquote className="rounded-md border-l-2 border-ds-bg-success-default-default bg-ds-bg-neutral-muted-default p-3 text-sm text-ds-text-neutral-strong-default">
          <mark className="bg-ds-bg-success-subtle-default text-ds-text-success-strong-default">
            {insight.sourceQuote}
          </mark>
        </blockquote>
      </div>
    </div>
  );
}

export default SourceQuoteViewer;
