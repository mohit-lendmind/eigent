// The tenant's triggers, read from the aion edge. A trigger row carries its
// cadence and its status, and that is not enough to answer the question this
// surface exists for — is this thing still running? A forfeited tick
// (`skipped_busy`, `skipped_generation`) leaves the row completely unchanged:
// same `active` status, `attempts` still 0, `last_error` cleared, and
// `last_fired_tick` still pointing at the last time it really did fire. A
// trigger that has forfeited every tick for a week is indistinguishable from a
// healthy one until its ledger is read. So health here is derived from the row
// AND the ledger, and the ledger is fetched for the rows that have one.

import { supportsSchedules } from '@/api/aion/v1/compat';
import {
  EdgeTransport,
  type CreateScheduleRequest,
  type Schedule,
  type ScheduleEvent,
  type UpdateScheduleRequest,
} from '@/api/aion/v1/transport';
import { getAionRemoteConfig } from './aionChatBridge';

/**
 * How the Triggers surface should behave this renderer lifetime. `local` is a
 * desktop with no aion backend (the legacy hosted trigger plane owns the
 * screen); `unsupported` is a compatible edge below the 1.10 schedules floor,
 * shown as such because an empty list would claim nothing is scheduled; `error`
 * is remote mode that cannot serve triggers — shown, never degraded to empty.
 */
export type AionSchedulesMode =
  | { kind: 'local' }
  | { kind: 'remote' }
  | { kind: 'unsupported'; edgeApiVersion: string }
  | { kind: 'error'; message: string };

export interface AionSchedule {
  scheduleId: string;
  projectId: string;
  cron: string;
  task: string;
  singleShot: boolean;
  /** `active` | `paused` | `completed` | `dead_letter` — an open set; an edge
   *  that reports a status this build does not know sends `unknown`. */
  status: string;
  /** null when the trigger will not fire again (paused, completed, dead). */
  nextFireAt: string | null;
  /** null means never fired — a fact no timestamp value can express. */
  lastFiredTick: string | null;
  /** Consecutive FAILED firings. A forfeited tick does not increment it. */
  attempts: number;
  /** null when the last firing did not fail. */
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AionScheduleEvent {
  /** Decimal string: a ledger cursor must never pass through a JS number. */
  eventId: string;
  scheduleId: string;
  action: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

/**
 * What a trigger is actually doing, as opposed to what its status field says.
 * `skipping` is the state that only exists here: the row says `active` and the
 * cadence is being honoured, but every recent tick was forfeited, so no work
 * has run. `failing` is an active trigger that has failed at least once and has
 * not yet exhausted its attempts — a dead-letter in progress.
 */
export type AionScheduleHealth =
  | { kind: 'firing' }
  | { kind: 'never_fired' }
  | { kind: 'paused' }
  | { kind: 'completed' }
  | { kind: 'dead_letter'; error: string }
  | { kind: 'failing'; attempts: number; error: string }
  | { kind: 'skipping'; reason: 'busy' | 'generation'; ticks: number; since: string }
  | { kind: 'unknown'; status: string };

// Ledger actions that report the outcome of a tick, as opposed to a lifecycle
// mutation the user made. Only these answer "did the last tick do anything".
const FIRING_ACTIONS = new Set([
  'fired',
  'skipped_busy',
  'skipped_generation',
  'fire_failed',
  'dead_lettered',
]);

/**
 * The trigger's real state. `events` is one window of its ledger, oldest first
 * as the route serves it; passing none answers from the row alone, which
 * cannot see a forfeited tick and so never reports `skipping`.
 */
export function scheduleHealth(
  schedule: AionSchedule,
  events: readonly AionScheduleEvent[] = []
): AionScheduleHealth {
  switch (schedule.status) {
    case 'paused':
      return { kind: 'paused' };
    case 'completed':
      return { kind: 'completed' };
    case 'dead_letter':
      return { kind: 'dead_letter', error: schedule.lastError ?? '' };
    case 'active':
      break;
    default:
      // Never render an unrecognised status as healthy: a newer edge reporting
      // a state this build has no name for is exactly when a confident
      // "firing" would be a lie.
      return { kind: 'unknown', status: schedule.status };
  }
  if (schedule.attempts > 0) {
    return {
      kind: 'failing',
      attempts: schedule.attempts,
      error: schedule.lastError ?? '',
    };
  }
  const skipped = trailingSkips(events);
  if (skipped) return skipped;
  return schedule.lastFiredTick === null
    ? { kind: 'never_fired' }
    : { kind: 'firing' };
}

/**
 * The run of forfeited ticks at the end of the ledger window, if the most
 * recent tick was forfeited at all. Counted per reason: a busy Project and a
 * foreign harness generation are different problems with different fixes, and
 * a run that changes reason mid-way stops at the change rather than reporting a
 * longer streak of something that did not happen.
 */
function trailingSkips(
  events: readonly AionScheduleEvent[]
): { kind: 'skipping'; reason: 'busy' | 'generation'; ticks: number; since: string } | null {
  const outcomes = events.filter((event) => FIRING_ACTIONS.has(event.action));
  const last = outcomes[outcomes.length - 1];
  if (!last) return null;
  const reason = skipReason(last.action);
  if (!reason) return null;
  let ticks = 0;
  let since = last.occurredAt;
  for (let i = outcomes.length - 1; i >= 0; i -= 1) {
    if (skipReason(outcomes[i].action) !== reason) break;
    ticks += 1;
    since = outcomes[i].occurredAt;
  }
  return { kind: 'skipping', reason, ticks, since };
}

function skipReason(action: string): 'busy' | 'generation' | null {
  if (action === 'skipped_busy') return 'busy';
  if (action === 'skipped_generation') return 'generation';
  return null;
}

/** Whether a trigger's ledger is worth reading to decide its health. A trigger
 *  that is not on a cadence cannot be forfeiting ticks, so its row is the whole
 *  answer and fetching its ledger would be a request per row for nothing. */
export function needsLedger(schedule: AionSchedule): boolean {
  return schedule.status === 'active' && schedule.attempts === 0;
}

interface RemoteContext {
  mode: AionSchedulesMode;
  transport: EdgeTransport | null;
}

// Mode is negotiated once per renderer lifetime (matching the other aion
// surfaces); any error-mode resolution clears the cache so reopening retries.
let contextPromise: Promise<RemoteContext> | null = null;

function getContext(): Promise<RemoteContext> {
  contextPromise ??= resolveContext();
  return contextPromise;
}

async function resolveContext(): Promise<RemoteContext> {
  try {
    const config = await getAionRemoteConfig();
    if (!config) {
      return { mode: { kind: 'local' }, transport: null };
    }
    if ('error' in config) {
      contextPromise = null;
      return { mode: { kind: 'error', message: config.error }, transport: null };
    }
    const transport = new EdgeTransport({
      baseUrl: config.edgeBaseUrl,
      apiKey: config.apiKey,
    });
    const status = await transport.getIntegrationStatus();
    if (!supportsSchedules(status)) {
      return {
        mode: { kind: 'unsupported', edgeApiVersion: status.edge_api_version },
        transport: null,
      };
    }
    return { mode: { kind: 'remote' }, transport };
  } catch (error) {
    // A failed handshake is retryable: drop the cache so the next open
    // renegotiates instead of pinning the error forever.
    contextPromise = null;
    const message = error instanceof Error ? error.message : String(error);
    return { mode: { kind: 'error', message }, transport: null };
  }
}

export async function getAionSchedulesMode(): Promise<AionSchedulesMode> {
  return (await getContext()).mode;
}

async function remoteTransport(): Promise<EdgeTransport> {
  const { mode, transport } = await getContext();
  if (!transport) {
    throw new Error(
      mode.kind === 'error'
        ? mode.message
        : 'The aion backend does not serve triggers.'
    );
  }
  return transport;
}

// Promise-cache with explicit invalidation, so concurrent opens share one
// fetch and every mutation below is followed by a fresh list rather than a
// snapshot taken before it.
let listPromise: Promise<AionSchedule[]> | null = null;

export function invalidateAionSchedules(): void {
  listPromise = null;
}

export function listAionSchedules(): Promise<AionSchedule[]> {
  listPromise ??= fetchSchedules().catch((error) => {
    listPromise = null;
    throw error;
  });
  return listPromise;
}

async function fetchSchedules(): Promise<AionSchedule[]> {
  const transport = await remoteTransport();
  const list = await transport.listSchedules();
  return (list.schedules ?? [])
    .map(toSchedule)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function toSchedule(row: Schedule): AionSchedule {
  return {
    scheduleId: row.schedule_id,
    projectId: row.project_id,
    cron: row.cron,
    task: row.task,
    singleShot: row.single_shot === true,
    status: row.status,
    // Absent stays null rather than becoming '': the contract omits these
    // fields precisely so that "never fired" and "fired at the zero time" are
    // not the same value.
    nextFireAt: row.next_fire_at ?? null,
    lastFiredTick: row.last_fired_tick ?? null,
    attempts: row.attempts ?? 0,
    lastError: row.last_error ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toScheduleEvent(row: ScheduleEvent): AionScheduleEvent {
  return {
    eventId: row.event_id,
    scheduleId: row.schedule_id,
    action: row.action,
    payload: row.payload ?? {},
    occurredAt: row.occurred_at,
  };
}

/** The newest window of one trigger's ledger, oldest of that window first. */
export async function loadAionScheduleEvents(
  scheduleId: string,
  limit = 50
): Promise<AionScheduleEvent[]> {
  const transport = await remoteTransport();
  const list = await transport.listScheduleEvents(scheduleId, { limit });
  return (list.events ?? []).map(toScheduleEvent);
}

export async function createAionSchedule(
  request: CreateScheduleRequest
): Promise<AionSchedule> {
  const transport = await remoteTransport();
  const created = await transport.createSchedule(request);
  invalidateAionSchedules();
  return toSchedule(created);
}

export async function updateAionSchedule(
  scheduleId: string,
  request: UpdateScheduleRequest
): Promise<AionSchedule> {
  const transport = await remoteTransport();
  const updated = await transport.updateSchedule(scheduleId, request);
  invalidateAionSchedules();
  return toSchedule(updated);
}

export async function pauseAionSchedule(
  scheduleId: string
): Promise<AionSchedule> {
  return transition(scheduleId, (transport) =>
    transport.pauseSchedule(scheduleId)
  );
}

export async function resumeAionSchedule(
  scheduleId: string
): Promise<AionSchedule> {
  return transition(scheduleId, (transport) =>
    transport.resumeSchedule(scheduleId)
  );
}

/** Returns a dead-lettered trigger to its cadence. The server refuses this on
 *  any other status as a typed conflict, so a stale row cannot silently
 *  "requeue" a trigger that is already running. */
export async function requeueAionSchedule(
  scheduleId: string
): Promise<AionSchedule> {
  return transition(scheduleId, (transport) =>
    transport.requeueSchedule(scheduleId)
  );
}

async function transition(
  scheduleId: string,
  call: (transport: EdgeTransport) => Promise<Schedule>
): Promise<AionSchedule> {
  const transport = await remoteTransport();
  const updated = await call(transport);
  invalidateAionSchedules();
  return toSchedule(updated);
}

export async function deleteAionSchedule(scheduleId: string): Promise<void> {
  const transport = await remoteTransport();
  await transport.deleteSchedule(scheduleId);
  invalidateAionSchedules();
}

// Cadence validation, applied before the request so the user is corrected in
// the field rather than by a round trip. The edge owns the policy and repeats
// every check server-side; this mirrors it exactly (five fields, no
// descriptors) so the two cannot disagree about what is offered.
const CRON_FIELDS = 5;

export type CronVerdict =
  | { ok: true }
  | { ok: false; reason: 'empty' | 'descriptor' | 'seconds' | 'fields' };

export function validateCron(cron: string): CronVerdict {
  const trimmed = cron.trim();
  if (trimmed === '') return { ok: false, reason: 'empty' };
  if (trimmed.startsWith('@')) return { ok: false, reason: 'descriptor' };
  const fields = trimmed.split(/\s+/).length;
  if (fields === CRON_FIELDS) return { ok: true };
  // Six fields is the store's test-only per-second form. It parses, which is
  // why it is called out separately: the refusal is a policy decision about
  // hammering admission, not a syntax error the user can fix by retyping.
  return { ok: false, reason: fields === CRON_FIELDS + 1 ? 'seconds' : 'fields' };
}
