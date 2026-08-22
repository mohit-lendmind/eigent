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

// FR-016/017 — the Today "needs-you" screen. It is a thin read over the fold:
// a stat strip, then the queue rows (gates pinned, worklist after), with the
// full set of empty states (loading, first-run, all-clear) and a degraded
// banner. SLA countdowns are aria-live so a screen reader hears a gate age.
// Every colour is a ds token via the tone primitives — no raw values here.

import { Button } from '@/components/ui/button';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCrmEventLogStore } from '../fold/eventLogStore';
import { useCrmWorkstreamStore } from '../workstreamStore';
import {
  approveGate,
  bootstrapCrmSurface,
  descriptorForMirror,
  rejectGate,
  startOnboardingCase,
} from './crmSurface';
import { GateCard } from './GateCard';
import { StatusPill } from './primitives/StatusPill';
import {
  buildTodayQueue,
  computeQueueDegraded,
  type QueueRow,
} from './queueModel';
import { toneClasses, type CrmTone } from './tones';

const ADVISER_ID = 'adviser:me';

const MINUTE_MS = 60_000;

const FRESHNESS_TONE: Record<QueueRow['freshness'], CrmTone> = {
  live: 'success',
  'as-of': 'neutral',
  stale: 'warning',
};

export interface TodayQueueProps {
  /** The fold is still hydrating; show the loading state. */
  loading?: boolean;
}

export function TodayQueue({ loading = false }: TodayQueueProps) {
  const { t } = useTranslation();
  const openGates = useCrmEventLogStore((s) => s.openGates);
  const freshness = useCrmEventLogStore((s) => s.freshness);
  const worklistItems = useCrmWorkstreamStore((s) => s.worklistItems);

  // A 30s tick keeps the SLA countdowns honest without a per-second re-render.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // The imperative surface controller (finding 3): install skills + the watcher
  // schedule once on mount, and drive the onboarding + gate-resolution journeys.
  const [busy, setBusy] = useState(false);
  const [surfaceError, setSurfaceError] = useState<string | null>(null);
  const [selectedGateId, setSelectedGateId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void bootstrapCrmSurface().then((r) => {
      if (cancelled || r.ok) return;
      setSurfaceError(r.error);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedGate =
    selectedGateId !== null ? openGates[selectedGateId] : undefined;

  const handleStartOnboarding = useCallback(async () => {
    setBusy(true);
    setSurfaceError(null);
    const r = await startOnboardingCase('purchase');
    if (!r.ok) setSurfaceError(r.error);
    setBusy(false);
  }, []);

  const handleApprove = useCallback(
    async (editedDraft?: string) => {
      if (!selectedGate) return;
      setBusy(true);
      setSurfaceError(null);
      const r = await approveGate(selectedGate, ADVISER_ID, editedDraft);
      if (r.ok) setSelectedGateId(null);
      else setSurfaceError(r.error);
      setBusy(false);
    },
    [selectedGate]
  );

  const handleReject = useCallback(async () => {
    if (!selectedGate) return;
    setBusy(true);
    setSurfaceError(null);
    const r = await rejectGate(selectedGate, ADVISER_ID);
    if (r.ok) setSelectedGateId(null);
    else setSurfaceError(r.error);
    setBusy(false);
  }, [selectedGate]);

  const rows = useMemo(
    () => buildTodayQueue(openGates, worklistItems, freshness),
    [openGates, worklistItems, freshness]
  );
  const degraded = useMemo(
    () => computeQueueDegraded(freshness, openGates, worklistItems),
    [freshness, openGates, worklistItems]
  );

  const gateCount = rows.filter((r) => r.source === 'gate').length;
  const taskCount = rows.filter((r) => r.source === 'worklist').length;
  const overdueCount = rows.filter(
    (r) => r.sla !== undefined && r.sla.dueAt <= now
  ).length;

  const hasAnyState =
    Object.keys(openGates).length > 0 ||
    Object.keys(worklistItems).length > 0 ||
    Object.keys(freshness).length > 0;

  return (
    <div className="flex flex-col gap-4 p-6">
      <header className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold text-ds-text-neutral-strong-default">
            {t('crm.today.title')}
          </h1>
          <p className="text-sm text-ds-text-neutral-default-default">
            {t('crm.today.subtitle')}
          </p>
        </div>
        <Button
          onClick={() => void handleStartOnboarding()}
          disabled={busy}
          aria-disabled={busy}
        >
          {busy ? t('crm.today.starting') : t('crm.today.start-onboarding')}
        </Button>
      </header>

      <div className="flex gap-3">
        <StatCell
          label={t('crm.today.stat-gates')}
          value={gateCount}
          tone="brand"
        />
        <StatCell
          label={t('crm.today.stat-tasks')}
          value={taskCount}
          tone="info"
        />
        <StatCell
          label={t('crm.today.stat-overdue')}
          value={overdueCount}
          tone={overdueCount > 0 ? 'danger' : 'neutral'}
        />
      </div>

      {degraded.degraded && (
        <div
          role="alert"
          className="rounded-md border border-ds-bg-warning-default-default bg-ds-bg-warning-subtle-default px-3 py-2 text-sm text-ds-text-warning-strong-default"
        >
          {t('crm.today.degraded')}
        </div>
      )}

      {surfaceError !== null && (
        <div
          role="alert"
          className="rounded-md border border-ds-bg-error-default-default bg-ds-bg-status-error-subtle-default px-3 py-2 text-sm text-ds-text-status-error-strong-default"
        >
          {surfaceError}
        </div>
      )}

      {selectedGate !== undefined && selectedGate.status === 'open' && (
        <div className="flex flex-col gap-2">
          <GateCard
            gate={descriptorForMirror(selectedGate)}
            draft={
              selectedGate.draftFull !== undefined
                ? { full: selectedGate.draftFull, editable: true }
                : undefined
            }
            provenance={{
              disclosureRef: selectedGate.disclosureRef,
              reasons: selectedGate.reasons,
            }}
            onApprove={(editedDraft) => void handleApprove(editedDraft)}
            onReject={() => void handleReject()}
          />
          <button
            type="button"
            className="self-start text-xs text-ds-text-neutral-muted-default hover:underline"
            onClick={() => setSelectedGateId(null)}
          >
            {t('crm.today.close-gate')}
          </button>
        </div>
      )}

      {loading ? (
        <EmptyState message={t('crm.today.loading')} />
      ) : rows.length === 0 ? (
        <EmptyState
          message={
            hasAnyState ? t('crm.today.all-clear') : t('crm.today.first-run')
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <QueueRowItem
              key={row.id}
              row={row}
              now={now}
              t={t}
              onSelect={
                row.source === 'gate'
                  ? () => setSelectedGateId(row.id)
                  : undefined
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function StatCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: CrmTone;
}) {
  const cls = toneClasses(tone);
  return (
    <div
      className={`flex min-w-[96px] flex-col rounded-lg border px-3 py-2 ${cls.bg} ${cls.border}`}
    >
      <span className={`text-xl font-semibold ${cls.text}`}>{value}</span>
      <span className="text-xs text-ds-text-neutral-default-default">
        {label}
      </span>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-ds-bg-neutral-default-default bg-ds-bg-neutral-subtle-default px-4 py-8 text-center text-sm text-ds-text-neutral-default-default">
      {message}
    </div>
  );
}

function QueueRowItem({
  row,
  now,
  t,
  onSelect,
}: {
  row: QueueRow;
  now: number;
  t: ReturnType<typeof useTranslation>['t'];
  onSelect?: () => void;
}) {
  const tone = toneClasses(row.tone as CrmTone);
  const selectable = onSelect !== undefined;
  return (
    <li
      className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${tone.bg} ${tone.border}`}
    >
      {selectable ? (
        <button
          type="button"
          onClick={onSelect}
          className="flex flex-1 flex-col gap-0.5 text-left"
        >
          <span className={`text-sm font-medium ${tone.text}`}>
            {row.title}
          </span>
          {row.meta !== undefined && (
            <span className="text-xs text-ds-text-neutral-default-default">
              {row.meta}
            </span>
          )}
        </button>
      ) : (
        <div className="flex flex-col gap-0.5">
          <span className={`text-sm font-medium ${tone.text}`}>
            {row.title}
          </span>
          {row.meta !== undefined && (
            <span className="text-xs text-ds-text-neutral-default-default">
              {row.meta}
            </span>
          )}
        </div>
      )}
      <div className="flex items-center gap-2">
        {row.sla !== undefined && (
          <span
            aria-live="polite"
            className="text-xs text-ds-text-neutral-default-default"
          >
            {row.sla.dueAt <= now
              ? t('crm.today.overdue', {
                  minutes: Math.round((now - row.sla.dueAt) / MINUTE_MS),
                })
              : t('crm.today.due-in', {
                  minutes: Math.round((row.sla.dueAt - now) / MINUTE_MS),
                })}
          </span>
        )}
        <StatusPill
          tone={FRESHNESS_TONE[row.freshness]}
          label={t(`crm.today.freshness-${row.freshness}`)}
        />
      </div>
    </li>
  );
}
