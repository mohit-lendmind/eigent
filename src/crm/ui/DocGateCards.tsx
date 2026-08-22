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

// FR-011 (US3) — the docintel decision cards. A G2 (attribution) or G3 (conflict)
// card is DECIDABLE WITHOUT OPENING THE DOCUMENT: the write path already coded the
// deciding facts (confidence, the two disagreeing values, the delta) into the
// gate's reasons, so the card renders those reasons inline and the adviser can
// choose right there. A G9 card explains WHY a recommendation is blocked, naming
// the exact applicant + field from the income gate. A typed error card is a live
// region so a screen reader hears a failure. Every string routes through t().

import { useTranslation } from 'react-i18next';
import {
  describeIncomeBlocker,
  type IncomeGateResult,
} from '../agents/incomeGate';
import type { MirroredGate } from '../fold/eventLogStore';

function ReasonList({ reasons }: { reasons: readonly string[] }) {
  const { t } = useTranslation();
  if (reasons.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 rounded-md bg-ds-bg-neutral-muted-default p-2">
      <span className="text-xs font-medium text-ds-text-neutral-default-default">
        {t('crm.docgate.reasons')}
      </span>
      <ul className="list-disc pl-4 text-xs text-ds-text-neutral-default-default">
        {reasons.map((reason, i) => (
          <li key={i}>{reason}</li>
        ))}
      </ul>
    </div>
  );
}

export interface AttributionGateCardProps {
  gate: MirroredGate;
  onConfirm?: () => void;
  onReject?: () => void;
}

/** G2 — confirm which applicant a document belongs to before its facts land. */
export function AttributionGateCard({
  gate,
  onConfirm,
  onReject,
}: AttributionGateCardProps) {
  const { t } = useTranslation();
  return (
    <section
      className="flex flex-col gap-3 rounded-lg border border-ds-bg-warning-default-default bg-ds-bg-warning-subtle-default p-4"
      aria-label={t('crm.docgate.g2-title')}
    >
      <span className="text-sm font-semibold text-ds-text-warning-strong-default">
        {t('crm.docgate.g2-title')}
      </span>
      <ReasonList reasons={gate.reasons} />
      <div className="flex gap-2">
        {onConfirm !== undefined && (
          <button
            type="button"
            onClick={onConfirm}
            className="rounded border border-ds-bg-brand-default-default px-2 py-1 text-xs font-medium text-ds-text-brand-strong-default hover:bg-ds-bg-brand-subtle-default"
          >
            {t('crm.docgate.g2-confirm')}
          </button>
        )}
        {onReject !== undefined && (
          <button
            type="button"
            onClick={onReject}
            className="rounded px-2 py-1 text-xs text-ds-text-neutral-default-default hover:underline"
          >
            {t('crm.docgate.g2-reject')}
          </button>
        )}
      </div>
    </section>
  );
}

export interface ConflictGateCardProps {
  gate: MirroredGate;
  /** The value already on file and the value the document proposes, pre-formatted. */
  existingLabel?: string;
  incomingLabel?: string;
  onKeepExisting?: () => void;
  onUseIncoming?: () => void;
}

/** G3 — two verified values disagree; the adviser picks the authoritative one. */
export function ConflictGateCard({
  gate,
  existingLabel,
  incomingLabel,
  onKeepExisting,
  onUseIncoming,
}: ConflictGateCardProps) {
  const { t } = useTranslation();
  return (
    <section
      className="flex flex-col gap-3 rounded-lg border border-ds-bg-error-default-default bg-ds-bg-error-subtle-default p-4"
      aria-label={t('crm.docgate.g3-title')}
    >
      <span className="text-sm font-semibold text-ds-text-error-strong-default">
        {t('crm.docgate.g3-title')}
      </span>
      {(existingLabel !== undefined || incomingLabel !== undefined) && (
        <div className="flex gap-3">
          <div className="flex flex-1 flex-col rounded-md border border-ds-bg-neutral-default-default bg-ds-bg-neutral-subtle-default px-3 py-2">
            <span className="text-xs text-ds-text-neutral-muted-default">
              {t('crm.docgate.g3-existing')}
            </span>
            <span className="text-sm font-medium text-ds-text-neutral-strong-default">
              {existingLabel ?? '—'}
            </span>
          </div>
          <div className="flex flex-1 flex-col rounded-md border border-ds-bg-neutral-default-default bg-ds-bg-neutral-subtle-default px-3 py-2">
            <span className="text-xs text-ds-text-neutral-muted-default">
              {t('crm.docgate.g3-incoming')}
            </span>
            <span className="text-sm font-medium text-ds-text-neutral-strong-default">
              {incomingLabel ?? '—'}
            </span>
          </div>
        </div>
      )}
      <ReasonList reasons={gate.reasons} />
      <div className="flex gap-2">
        {onKeepExisting !== undefined && (
          <button
            type="button"
            onClick={onKeepExisting}
            className="rounded border border-ds-bg-brand-default-default px-2 py-1 text-xs font-medium text-ds-text-brand-strong-default hover:bg-ds-bg-brand-subtle-default"
          >
            {t('crm.docgate.g3-keep-existing')}
          </button>
        )}
        {onUseIncoming !== undefined && (
          <button
            type="button"
            onClick={onUseIncoming}
            className="rounded border border-ds-bg-brand-default-default px-2 py-1 text-xs font-medium text-ds-text-brand-strong-default hover:bg-ds-bg-brand-subtle-default"
          >
            {t('crm.docgate.g3-use-incoming')}
          </button>
        )}
      </div>
    </section>
  );
}

export interface IncomeGateCardProps {
  result: IncomeGateResult;
}

/** G9 — a recommendation is blocked until income is det-verified; say why (US3). */
export function IncomeGateCard({ result }: IncomeGateCardProps) {
  const { t } = useTranslation();
  if (result.satisfied) return null;
  return (
    <section
      className="flex flex-col gap-2 rounded-lg border border-ds-bg-warning-default-default bg-ds-bg-warning-subtle-default p-4"
      aria-label={t('crm.docgate.g9-title')}
    >
      <span className="text-sm font-semibold text-ds-text-warning-strong-default">
        {t('crm.docgate.g9-title')}
      </span>
      <span className="text-xs text-ds-text-neutral-default-default">
        {t('crm.docgate.g9-blocked')}
      </span>
      <ul className="list-disc pl-4 text-xs text-ds-text-neutral-default-default">
        {result.blocking.map((b) => (
          <li key={`${b.clientId}:${b.fieldKey}`}>
            {describeIncomeBlocker(b)}
          </li>
        ))}
      </ul>
    </section>
  );
}

export interface DocErrorCardProps {
  message: string;
  title?: string;
}

/** A typed failure card; role=alert so a screen reader hears it (aria-live). */
export function DocErrorCard({ message, title }: DocErrorCardProps) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className="flex flex-col gap-1 rounded-md border border-ds-bg-error-default-default bg-ds-bg-error-subtle-default px-3 py-2"
    >
      <span className="text-sm font-medium text-ds-text-error-strong-default">
        {title ?? t('crm.docgate.error-title')}
      </span>
      <span className="text-xs text-ds-text-neutral-default-default">
        {message}
      </span>
    </div>
  );
}
