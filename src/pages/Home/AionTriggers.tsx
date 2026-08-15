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

// The tenant's triggers as aion reports them. The failure this screen exists to
// catch is a trigger that stopped doing anything without stopping: a forfeited
// tick leaves the row untouched — still `active`, still counting down to a next
// firing — so a screen that rendered the status field alone would show a green
// badge over a trigger that has not run in weeks. Every row therefore states
// what it is REALLY doing, and says "not checked" where it does not know.

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  validateCron,
  type AionSchedule,
  type AionScheduleEvent,
  type AionScheduleHealth,
} from '@/store/aionSchedulesStore';
import {
  AlertCircle,
  AlertTriangle,
  BadgeCheck,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  HelpCircle,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  SkipForward,
  Zap,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHomeHub } from './context';
import { matchesHubNameSearch } from './utils';

/** Absolute local time. A trigger's next firing is in the future, which every
 *  "… ago" formatter in this hub renders as a past instant. */
function moment(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function Banner({ message, testId }: { message: string; testId: string }) {
  return (
    <div
      className="flex items-center gap-4 rounded-2xl bg-ds-bg-neutral-default-default px-6 py-6"
      role="alert"
      data-testid={testId}
    >
      <AlertCircle className="h-5 w-5 shrink-0 text-ds-icon-status-error-default-default" />
      <span className="text-body-sm text-ds-text-neutral-default-default">
        {message}
      </span>
    </div>
  );
}

/**
 * One line naming what the trigger is doing, plus the class of the answer for
 * the tests and the eye. `unverified` is deliberately its own state and not a
 * quieter "firing": the ledger read that would have proved it did not run.
 */
function HealthBadge({
  health,
  unverified,
}: {
  health: AionScheduleHealth;
  unverified: boolean;
}) {
  const { t } = useTranslation();
  if (unverified) {
    return (
      <span
        className="flex items-center gap-1.5 text-body-xs text-ds-text-neutral-muted-default"
        data-testid="aion-trigger-health"
        data-health="unverified"
      >
        <CircleDashed className="h-4 w-4" />
        {t('triggers.aion-state-unverified')}
      </span>
    );
  }
  switch (health.kind) {
    case 'paused':
      return (
        <span
          className="flex items-center gap-1.5 text-body-xs text-ds-text-neutral-muted-default"
          data-testid="aion-trigger-health"
          data-health="paused"
        >
          <PauseCircle className="h-4 w-4" />
          {t('triggers.aion-state-paused')}
        </span>
      );
    case 'completed':
      return (
        <span
          className="flex items-center gap-1.5 text-body-xs text-ds-text-neutral-muted-default"
          data-testid="aion-trigger-health"
          data-health="completed"
        >
          <BadgeCheck className="h-4 w-4" />
          {t('triggers.aion-state-completed')}
        </span>
      );
    case 'dead_letter':
      return (
        <span
          className="flex items-center gap-1.5 text-body-xs text-ds-text-status-error-default-default"
          data-testid="aion-trigger-health"
          data-health="dead_letter"
          title={health.error}
        >
          <AlertCircle className="h-4 w-4" />
          {t('triggers.aion-state-dead-letter')}
        </span>
      );
    case 'failing':
      return (
        <span
          className="flex items-center gap-1.5 text-body-xs text-ds-text-status-warning-strong-default"
          data-testid="aion-trigger-health"
          data-health="failing"
          title={health.error}
        >
          <AlertTriangle className="h-4 w-4" />
          {t('triggers.aion-state-failing', { attempts: health.attempts })}
        </span>
      );
    case 'skipping':
      return (
        <span
          className="flex items-center gap-1.5 text-body-xs text-ds-text-status-warning-strong-default"
          data-testid="aion-trigger-health"
          data-health={`skipping_${health.reason}`}
          title={t('triggers.aion-skipping-detail', {
            ticks: health.ticks,
            since: moment(health.since),
          })}
        >
          <SkipForward className="h-4 w-4" />
          {health.reason === 'busy'
            ? t('triggers.aion-state-skipping-busy')
            : t('triggers.aion-state-skipping-generation')}
        </span>
      );
    case 'never_fired':
      return (
        <span
          className="flex items-center gap-1.5 text-body-xs text-ds-text-neutral-muted-default"
          data-testid="aion-trigger-health"
          data-health="never_fired"
        >
          <CircleDashed className="h-4 w-4" />
          {t('triggers.aion-state-never-fired')}
        </span>
      );
    case 'unknown':
      return (
        <span
          className="flex items-center gap-1.5 text-body-xs text-ds-text-status-warning-strong-default"
          data-testid="aion-trigger-health"
          data-health="unknown"
        >
          <HelpCircle className="h-4 w-4" />
          {t('triggers.aion-state-unknown', { status: health.status })}
        </span>
      );
    default:
      return (
        <span
          className="flex items-center gap-1.5 text-body-xs text-ds-text-status-success-strong-default"
          data-testid="aion-trigger-health"
          data-health="firing"
        >
          <PlayCircle className="h-4 w-4" />
          {t('triggers.aion-state-firing')}
        </span>
      );
  }
}

function Ledger({ events }: { events: AionScheduleEvent[] | undefined }) {
  const { t } = useTranslation();
  if (!events) {
    return (
      <div className="px-4 py-3 text-body-xs text-ds-text-neutral-muted-default">
        {t('layout.loading')}
      </div>
    );
  }
  if (events.length === 0) {
    return (
      <div className="px-4 py-3 text-body-xs text-ds-text-neutral-muted-default">
        {t('triggers.aion-history-empty')}
      </div>
    );
  }
  // Newest first here: the ledger arrives oldest-of-the-window first, and the
  // entry a reader wants is the one that explains the badge above it.
  return (
    <ul className="flex flex-col gap-1 px-4 py-3" data-testid="aion-trigger-ledger">
      {[...events].reverse().map((event) => (
        <li
          key={event.eventId}
          className="flex items-baseline gap-3 text-body-xs"
          data-testid="aion-trigger-ledger-entry"
          data-action={event.action}
        >
          <span className="w-32 shrink-0 tabular-nums text-ds-text-neutral-muted-default">
            {moment(event.occurredAt)}
          </span>
          <span className="text-ds-text-neutral-default-default">
            {t(`triggers.aion-action-${event.action}`, {
              defaultValue: event.action,
            })}
          </span>
          {typeof event.payload.error === 'string' ? (
            <span className="min-w-0 truncate text-ds-text-status-error-default-default">
              {event.payload.error}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function CreateForm({
  projects,
  busy,
  onCreate,
  onCancel,
}: {
  projects: { projectId: string; title: string }[];
  busy: boolean;
  onCreate: (request: {
    project_id: string;
    cron: string;
    task: string;
    single_shot: boolean;
  }) => Promise<boolean>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [projectId, setProjectId] = useState(projects[0]?.projectId ?? '');
  const [cron, setCron] = useState('');
  const [task, setTask] = useState('');
  const [singleShot, setSingleShot] = useState(false);
  const [touched, setTouched] = useState(false);

  const verdict = validateCron(cron);
  const cronError =
    touched && !verdict.ok ? t(`triggers.aion-cron-${verdict.reason}`) : '';
  const submittable =
    projectId !== '' && task.trim() !== '' && verdict.ok && !busy;

  if (projects.length === 0) {
    return (
      <div
        className="rounded-2xl bg-ds-bg-neutral-default-default px-6 py-4 text-body-sm text-ds-text-neutral-muted-default"
        data-testid="aion-trigger-no-projects"
      >
        {t('triggers.aion-no-projects')}
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-2xl bg-ds-bg-neutral-default-default px-6 py-5"
      data-testid="aion-trigger-form"
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (!submittable) return;
        void onCreate({
          project_id: projectId,
          cron: cron.trim(),
          task: task.trim(),
          single_shot: singleShot,
        }).then((created) => {
          if (created) onCancel();
        });
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="text-label-sm text-ds-text-neutral-muted-default">
          {t('triggers.aion-project')}
        </span>
        <select
          className="rounded-lg border border-solid border-ds-border-neutral-default-default bg-ds-bg-surface-primary px-3 py-2 text-body-sm text-ds-text-neutral-default-default"
          value={projectId}
          data-testid="aion-trigger-project"
          onChange={(event) => setProjectId(event.target.value)}
        >
          {projects.map((project) => (
            <option key={project.projectId} value={project.projectId}>
              {project.title || project.projectId}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-label-sm text-ds-text-neutral-muted-default">
          {t('triggers.aion-cron')}
        </span>
        <Input
          value={cron}
          placeholder="30 6 * * 1-5"
          data-testid="aion-trigger-cron"
          onChange={(event) => setCron(event.target.value)}
          onBlur={() => setTouched(true)}
        />
        <span
          className={
            cronError
              ? 'text-body-xs text-ds-text-status-error-default-default'
              : 'text-body-xs text-ds-text-neutral-muted-default'
          }
          data-testid={cronError ? 'aion-trigger-cron-error' : undefined}
        >
          {cronError || t('triggers.aion-cron-help')}
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-label-sm text-ds-text-neutral-muted-default">
          {t('triggers.aion-task')}
        </span>
        <Textarea
          value={task}
          rows={3}
          placeholder={t('triggers.aion-task-placeholder')}
          data-testid="aion-trigger-task"
          onChange={(event) => setTask(event.target.value)}
        />
      </label>

      <label className="flex items-center gap-2">
        <Checkbox
          checked={singleShot}
          data-testid="aion-trigger-single-shot"
          onCheckedChange={(checked) => setSingleShot(checked === true)}
        />
        <span className="text-body-sm text-ds-text-neutral-default-default">
          {t('triggers.aion-single-shot')}
        </span>
      </label>

      <div className="flex items-center gap-2">
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={!submittable}
          data-testid="aion-trigger-submit"
        >
          {t('triggers.aion-submit')}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t('triggers.aion-cancel')}
        </Button>
      </div>
    </form>
  );
}

function TriggerRow({
  schedule,
  health,
  unverified,
  projectTitle,
  busy,
  expanded,
  events,
  onToggle,
  onPause,
  onResume,
  onRequeue,
  onDelete,
}: {
  schedule: AionSchedule;
  health: AionScheduleHealth;
  unverified: boolean;
  projectTitle: string;
  busy: boolean;
  expanded: boolean;
  events: AionScheduleEvent[] | undefined;
  onToggle: () => void;
  onPause: () => void;
  onResume: () => void;
  onRequeue: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <div
      className="flex flex-col rounded-xl bg-ds-bg-neutral-default-default"
      data-testid="aion-trigger-row"
      data-schedule-id={schedule.scheduleId}
      data-status={schedule.status}
    >
      <div className="flex w-full items-center gap-4 px-4 py-3">
        <button
          type="button"
          className="shrink-0 text-ds-icon-neutral-muted-default"
          aria-expanded={expanded}
          aria-label={t('triggers.aion-history')}
          data-testid="aion-trigger-expand"
          onClick={onToggle}
        >
          <Chevron className="h-4 w-4" />
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-body-sm text-ds-text-neutral-default-default">
            {schedule.task}
          </span>
          <span className="truncate text-body-xs text-ds-text-neutral-muted-default">
            <span className="tabular-nums">{schedule.cron}</span>
            {schedule.singleShot ? ` · ${t('triggers.aion-once')}` : ''}
            {projectTitle ? ` · ${projectTitle}` : ''}
          </span>
        </div>
        <div className="flex w-[168px] shrink-0 flex-col items-start gap-0.5">
          <HealthBadge health={health} unverified={unverified} />
          <span
            className="text-body-xs text-ds-text-neutral-muted-default"
            data-testid="aion-trigger-next"
          >
            {schedule.nextFireAt
              ? t('triggers.aion-next-fire', {
                  when: moment(schedule.nextFireAt),
                })
              : t('triggers.aion-next-fire-none')}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {schedule.status === 'active' ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              data-testid="aion-trigger-pause"
              onClick={onPause}
            >
              {t('triggers.aion-pause')}
            </Button>
          ) : null}
          {schedule.status === 'paused' ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              data-testid="aion-trigger-resume"
              onClick={onResume}
            >
              {t('triggers.aion-resume')}
            </Button>
          ) : null}
          {schedule.status === 'dead_letter' ? (
            <Button
              variant="primary"
              size="sm"
              disabled={busy}
              data-testid="aion-trigger-requeue"
              onClick={onRequeue}
            >
              {t('triggers.aion-requeue')}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            data-testid="aion-trigger-delete"
            onClick={onDelete}
          >
            {t('triggers.aion-delete')}
          </Button>
        </div>
      </div>
      {expanded ? <Ledger events={events} /> : null}
    </div>
  );
}

export default function AionTriggers() {
  const { t } = useTranslation();
  const { searchQuery, aionProjects, aionSchedules } = useHomeHub();
  const {
    mode,
    schedules,
    loading,
    error,
    busyId,
    health,
    unverified,
    ledger,
    loadLedger,
    create,
    pause,
    resume,
    requeue,
    remove,
    reload,
  } = aionSchedules;
  const [creating, setCreating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const projectTitles = useMemo(() => {
    const titles = new Map<string, string>();
    for (const project of aionProjects.projects) {
      titles.set(project.projectId, project.title);
    }
    return titles;
  }, [aionProjects.projects]);

  const visible = useMemo(() => {
    if (!searchQuery.trim()) return schedules;
    return schedules.filter((schedule) =>
      matchesHubNameSearch(searchQuery, schedule.task)
    );
  }, [schedules, searchQuery]);

  if (mode === null || loading) {
    return (
      <div className="w-full py-12 text-body-sm text-ds-text-neutral-muted-default">
        {t('layout.loading')}
      </div>
    );
  }
  if (mode.kind === 'unsupported') {
    return (
      <div className="w-full py-6">
        <Banner
          testId="aion-triggers-banner"
          message={t('triggers.aion-backend-too-old', {
            version: mode.edgeApiVersion,
          })}
        />
      </div>
    );
  }
  if (mode.kind === 'error') {
    return (
      <div className="w-full py-6">
        <Banner
          testId="aion-triggers-banner"
          message={t('triggers.aion-remote-error', { message: mode.message })}
        />
      </div>
    );
  }

  return (
    <div
      className="flex w-full min-w-0 flex-col gap-4 py-6"
      data-testid="aion-triggers"
    >
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="primary"
          size="sm"
          data-testid="aion-triggers-new"
          onClick={() => setCreating((open) => !open)}
        >
          {t('triggers.aion-create')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={reload}
          data-testid="aion-triggers-refresh"
        >
          <RefreshCw className="mr-1.5 h-4 w-4" />
          {t('triggers.aion-refresh')}
        </Button>
      </div>

      {error ? <Banner testId="aion-triggers-error" message={error} /> : null}

      {creating ? (
        <CreateForm
          projects={aionProjects.projects}
          busy={busyId === 'new'}
          onCreate={create}
          onCancel={() => setCreating(false)}
        />
      ) : null}

      {schedules.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center p-8 text-center"
          data-testid="aion-triggers-empty"
        >
          <Zap className="mb-4 h-12 w-12 text-ds-icon-neutral-muted-default" />
          <div className="text-sm text-ds-text-neutral-muted-default">
            {t('triggers.aion-empty')}
          </div>
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-8 text-center">
          <div className="text-sm text-ds-text-neutral-muted-default">
            {t('layout.search-no-results')}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {visible.map((schedule) => (
            <TriggerRow
              key={schedule.scheduleId}
              schedule={schedule}
              health={health(schedule)}
              unverified={unverified.has(schedule.scheduleId)}
              projectTitle={projectTitles.get(schedule.projectId) ?? ''}
              busy={busyId === schedule.scheduleId}
              expanded={expandedId === schedule.scheduleId}
              events={ledger(schedule.scheduleId)}
              onToggle={() => {
                const next =
                  expandedId === schedule.scheduleId
                    ? null
                    : schedule.scheduleId;
                setExpandedId(next);
                // Always re-read on open: the cached window may predate the
                // ticks the user opened the row to look for.
                if (next) loadLedger(next);
              }}
              onPause={() => void pause(schedule.scheduleId)}
              onResume={() => void resume(schedule.scheduleId)}
              onRequeue={() => void requeue(schedule.scheduleId)}
              onDelete={() => void remove(schedule.scheduleId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
