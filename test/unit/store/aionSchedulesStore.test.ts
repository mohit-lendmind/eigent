// The remote triggers provider. The health derivation is the part worth
// testing hardest: a forfeited tick leaves the trigger row byte-identical to a
// healthy one, so every assertion here that reads `skipping` out of a ledger is
// asserting that a trigger which has not run in days does not render as fine.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getIntegrationStatus,
  listSchedules,
  listScheduleEvents,
  createSchedule,
  pauseSchedule,
  resumeSchedule,
  requeueSchedule,
  deleteSchedule,
} = vi.hoisted(() => ({
  getIntegrationStatus: vi.fn(),
  listSchedules: vi.fn(),
  listScheduleEvents: vi.fn(),
  createSchedule: vi.fn(),
  pauseSchedule: vi.fn(),
  resumeSchedule: vi.fn(),
  requeueSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
}));

vi.mock('@/api/aion/v1/transport', () => ({
  EdgeTransport: class {
    getIntegrationStatus = getIntegrationStatus;
    listSchedules = listSchedules;
    listScheduleEvents = listScheduleEvents;
    createSchedule = createSchedule;
    pauseSchedule = pauseSchedule;
    resumeSchedule = resumeSchedule;
    requeueSchedule = requeueSchedule;
    deleteSchedule = deleteSchedule;
  },
}));

const fixturesDir = join(__dirname, '../../fixtures/aion/eigent/v1');
const fixture = (name: string): any =>
  JSON.parse(readFileSync(join(fixturesDir, name), 'utf-8'));

function remoteStatus(edgeApiVersion = '1.10.0') {
  return {
    edge_api_version: edgeApiVersion,
    event_schema_version: '1.0',
    minimum_desktop_version: '1.0.0',
  };
}

function setRemoteConfig() {
  (globalThis as Record<string, any>).electronAPI = {
    getAionTransportConfig: async () => ({
      mode: 'remote',
      edgeBaseUrl: 'http://edge.test/eigent/v1',
      apiKey: 'test-key',
    }),
  };
}

async function freshModule() {
  vi.resetModules();
  return import('@/store/aionSchedulesStore');
}

type Store = Awaited<ReturnType<typeof freshModule>>;

function row(overrides: Record<string, unknown> = {}): any {
  return {
    scheduleId: 'sch_1',
    projectId: 'prj_1',
    cron: '30 6 * * 1-5',
    task: 'Summarise the overnight builds.',
    singleShot: false,
    status: 'active',
    nextFireAt: '2026-08-17T06:30:00Z',
    lastFiredTick: '2026-08-14T06:30:00Z',
    attempts: 0,
    lastError: null,
    createdAt: '2026-08-01T09:14:22.113Z',
    updatedAt: '2026-08-14T06:30:04.882Z',
    ...overrides,
  };
}

// Ledger windows are served oldest-first, so the array order below is the order
// the route returns and the last element is the most recent tick.
let nextEventId = 1000;
function tick(action: string, occurredAt: string): any {
  nextEventId += 1;
  return {
    eventId: String(nextEventId),
    scheduleId: 'sch_1',
    action,
    payload: {},
    occurredAt,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete (globalThis as Record<string, any>).electronAPI;
});

describe('aionSchedulesStore mode negotiation', () => {
  it('resolves local when no remote config exists', async () => {
    const store = await freshModule();
    expect(await store.getAionSchedulesMode()).toEqual({ kind: 'local' });
    expect(getIntegrationStatus).not.toHaveBeenCalled();
  });

  it('gates on the schedules floor rather than reporting no triggers', async () => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus('1.9.0'));
    const store = await freshModule();
    expect(await store.getAionSchedulesMode()).toEqual({
      kind: 'unsupported',
      edgeApiVersion: '1.9.0',
    });
    // The triggers still exist and still fire; this desktop simply cannot see
    // them. An empty list would be the one wrong answer on this surface.
    await expect(store.listAionSchedules()).rejects.toThrow(
      /does not serve triggers/
    );
    expect(listSchedules).not.toHaveBeenCalled();
  });

  it('refuses a major-mismatched edge that clears the minor floor numerically', async () => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus('2.10.0'));
    const store = await freshModule();
    expect(await store.getAionSchedulesMode()).toEqual({
      kind: 'unsupported',
      edgeApiVersion: '2.10.0',
    });
  });

  it('surfaces a misconfigured remote mode as an error, never local', async () => {
    (globalThis as Record<string, any>).electronAPI = {
      getAionTransportConfig: async () => ({
        mode: 'remote',
        error: 'EIGENT_REMOTE_BACKEND_URL is not a valid URL',
      }),
    };
    const store = await freshModule();
    expect(await store.getAionSchedulesMode()).toEqual({
      kind: 'error',
      message: 'EIGENT_REMOTE_BACKEND_URL is not a valid URL',
    });
  });

  it('retries the handshake after a failed status fetch', async () => {
    setRemoteConfig();
    getIntegrationStatus
      .mockRejectedValueOnce(new Error('edge unreachable'))
      .mockResolvedValueOnce(remoteStatus());
    const store = await freshModule();
    expect(await store.getAionSchedulesMode()).toEqual({
      kind: 'error',
      message: 'edge unreachable',
    });
    expect(await store.getAionSchedulesMode()).toEqual({ kind: 'remote' });
  });
});

describe('aionSchedulesStore projection', () => {
  beforeEach(() => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus());
    listSchedules.mockResolvedValue(fixture('schedule_list_response.json'));
  });

  it('keeps an absent timestamp null instead of collapsing it to a value', async () => {
    const store = await freshModule();
    const rows = await store.listAionSchedules();
    const byId = Object.fromEntries(rows.map((r) => [r.scheduleId, r]));

    const paused = byId.sch_01JY0000000000000000000002;
    // Paused: no next firing at all. `''` or the zero time would both read as
    // a scheduled instant on the screen.
    expect(paused.nextFireAt).toBeNull();
    expect(paused.lastFiredTick).toBeNull();

    const scheduled = byId.sch_01JY0000000000000000000004;
    // Never fired but has a next firing — the two absences are independent.
    expect(scheduled.lastFiredTick).toBeNull();
    expect(scheduled.nextFireAt).toBe('2026-09-01T09:00:00Z');
    expect(scheduled.singleShot).toBe(true);

    const dead = byId.sch_01JY0000000000000000000003;
    expect(dead.attempts).toBe(5);
    expect(dead.lastError).toContain('context deadline exceeded');
  });

  it('defaults absent attempts to zero and absent single_shot to false', async () => {
    listSchedules.mockResolvedValue({
      schedules: [
        {
          schedule_id: 'sch_bare',
          project_id: 'prj_1',
          cron: '0 * * * *',
          task: 'Bare row.',
          status: 'active',
          created_at: '2026-08-01T00:00:00Z',
          updated_at: '2026-08-01T00:00:00Z',
        },
      ],
    });
    const store = await freshModule();
    const [bare] = await store.listAionSchedules();
    expect(bare.attempts).toBe(0);
    expect(bare.singleShot).toBe(false);
    expect(bare.lastError).toBeNull();
  });

  it('orders newest first and shares one fetch between concurrent opens', async () => {
    const store = await freshModule();
    const [first, second] = await Promise.all([
      store.listAionSchedules(),
      store.listAionSchedules(),
    ]);
    expect(first).toBe(second);
    expect(listSchedules).toHaveBeenCalledTimes(1);
    expect(first.map((r) => r.scheduleId)).toEqual([
      'sch_01JY0000000000000000000004',
      'sch_01JY0000000000000000000003',
      'sch_01JY0000000000000000000002',
      'sch_01JY0000000000000000000001',
    ]);
  });

  it('drops the cache after a failed read so the next open retries', async () => {
    listSchedules
      .mockRejectedValueOnce(new Error('edge unreachable'))
      .mockResolvedValueOnce(fixture('schedule_list_response.json'));
    const store = await freshModule();
    await expect(store.listAionSchedules()).rejects.toThrow('edge unreachable');
    expect((await store.listAionSchedules()).length).toBe(4);
  });

  it('projects a ledger window with its cursor kept as a string', async () => {
    listScheduleEvents.mockResolvedValue(
      fixture('schedule_event_list_response.json')
    );
    const store = await freshModule();
    const events = await store.loadAionScheduleEvents(
      'sch_01JY0000000000000000000003',
      25
    );
    expect(listScheduleEvents).toHaveBeenCalledWith(
      'sch_01JY0000000000000000000003',
      { limit: 25 }
    );
    expect(events.map((e) => e.action)).toEqual([
      'created',
      'fired',
      'skipped_busy',
      'fire_failed',
      'dead_lettered',
    ]);
    // An event id is a decimal string on the wire and must never be parsed:
    // the ledger outlives what a JS number can index.
    expect(events[0].eventId).toBe('8801');
    expect(typeof events[0].eventId).toBe('string');
    expect(events[1].payload.run_id).toBe('run_01JY0000000000000000000019');
  });
});

describe('aionSchedulesStore mutations', () => {
  beforeEach(() => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus());
    listSchedules.mockResolvedValue(fixture('schedule_list_response.json'));
  });

  it('invalidates the list after every state transition', async () => {
    const scheduleResponse = fixture('schedule_response.json');
    pauseSchedule.mockResolvedValue({ ...scheduleResponse, status: 'paused' });
    resumeSchedule.mockResolvedValue(scheduleResponse);
    requeueSchedule.mockResolvedValue(scheduleResponse);
    createSchedule.mockResolvedValue(scheduleResponse);
    deleteSchedule.mockResolvedValue(undefined);

    const store = await freshModule();
    const transitions: Array<() => Promise<unknown>> = [
      () => store.pauseAionSchedule('sch_1'),
      () => store.resumeAionSchedule('sch_1'),
      () => store.requeueAionSchedule('sch_1'),
      () => store.deleteAionSchedule('sch_1'),
      () =>
        store.createAionSchedule(fixture('create_schedule_request.json')),
    ];

    for (const transition of transitions) {
      await store.listAionSchedules();
      const before = listSchedules.mock.calls.length;
      await transition();
      // A snapshot taken before the transition would still show the old
      // status; the next read must go back to the edge.
      await store.listAionSchedules();
      expect(listSchedules.mock.calls.length).toBe(before + 1);
    }
  });

  it('reports the paused row the server actually returned', async () => {
    pauseSchedule.mockResolvedValue({
      ...fixture('schedule_response.json'),
      status: 'paused',
      next_fire_at: undefined,
    });
    const store = await freshModule();
    const paused = await store.pauseAionSchedule('sch_1');
    expect(paused.status).toBe('paused');
    expect(paused.nextFireAt).toBeNull();
  });

  it('propagates a refused transition instead of reporting success', async () => {
    requeueSchedule.mockRejectedValue(new Error('schedule_wrong_status'));
    const store = await freshModule();
    await expect(store.requeueAionSchedule('sch_1')).rejects.toThrow(
      'schedule_wrong_status'
    );
  });
});

describe('scheduleHealth', () => {
  let store: Store;

  beforeEach(async () => {
    store = await freshModule();
  });

  it('reads the lifecycle statuses off the row', () => {
    expect(store.scheduleHealth(row({ status: 'paused' }))).toEqual({
      kind: 'paused',
    });
    expect(store.scheduleHealth(row({ status: 'completed' }))).toEqual({
      kind: 'completed',
    });
    expect(
      store.scheduleHealth(
        row({ status: 'dead_letter', attempts: 5, lastError: 'submit: timeout' })
      )
    ).toEqual({ kind: 'dead_letter', error: 'submit: timeout' });
  });

  it('never renders an unrecognised status as healthy', () => {
    // A newer edge reporting a state this build has no name for is exactly
    // when a confident "Firing" would be a lie.
    expect(store.scheduleHealth(row({ status: 'quarantined' }))).toEqual({
      kind: 'unknown',
      status: 'quarantined',
    });
  });

  it('separates never-fired from firing', () => {
    expect(store.scheduleHealth(row({ lastFiredTick: null }))).toEqual({
      kind: 'never_fired',
    });
    expect(store.scheduleHealth(row())).toEqual({ kind: 'firing' });
  });

  it('reports an active trigger with attempts as failing, not firing', () => {
    expect(
      store.scheduleHealth(row({ attempts: 2, lastError: 'submit: timeout' }))
    ).toEqual({ kind: 'failing', attempts: 2, error: 'submit: timeout' });
  });

  it('reports a trigger whose recent ticks were all forfeited', () => {
    // The row is identical to the healthy one above: still active, attempts
    // still 0, last_fired_tick still pointing at the last real firing. Only
    // the ledger can tell these apart.
    const health = store.scheduleHealth(row(), [
      tick('fired', '2026-08-10T06:30:00Z'),
      tick('skipped_busy', '2026-08-11T06:30:00Z'),
      tick('skipped_busy', '2026-08-12T06:30:00Z'),
      tick('skipped_busy', '2026-08-13T06:30:00Z'),
    ]);
    expect(health).toEqual({
      kind: 'skipping',
      reason: 'busy',
      ticks: 3,
      since: '2026-08-11T06:30:00Z',
    });
  });

  it('stops the streak where the reason changes rather than overcounting', () => {
    // A busy Project and a foreign harness generation are different problems.
    // Reporting four ticks of "busy" here would name a cause that produced
    // only two of them.
    const health = store.scheduleHealth(row(), [
      tick('skipped_generation', '2026-08-11T06:30:00Z'),
      tick('skipped_generation', '2026-08-12T06:30:00Z'),
      tick('skipped_busy', '2026-08-13T06:30:00Z'),
      tick('skipped_busy', '2026-08-14T06:30:00Z'),
    ]);
    expect(health).toEqual({
      kind: 'skipping',
      reason: 'busy',
      ticks: 2,
      since: '2026-08-13T06:30:00Z',
    });
  });

  it('ignores lifecycle entries when deciding what the last tick did', () => {
    // Pausing and resuming are user actions interleaved in the same ledger;
    // treating a `resumed` row as the latest outcome would hide the skips.
    const health = store.scheduleHealth(row(), [
      tick('skipped_busy', '2026-08-13T06:30:00Z'),
      tick('paused', '2026-08-13T09:00:00Z'),
      tick('resumed', '2026-08-13T09:05:00Z'),
    ]);
    expect(health).toEqual({
      kind: 'skipping',
      reason: 'busy',
      ticks: 1,
      since: '2026-08-13T06:30:00Z',
    });
  });

  it('returns to firing once a real firing lands after the skips', () => {
    expect(
      store.scheduleHealth(row(), [
        tick('skipped_busy', '2026-08-12T06:30:00Z'),
        tick('skipped_busy', '2026-08-13T06:30:00Z'),
        tick('fired', '2026-08-14T06:30:00Z'),
      ])
    ).toEqual({ kind: 'firing' });
  });

  it('answers from the row alone when no ledger was read', () => {
    // No ledger is not evidence of no skips — it is why the screen renders
    // those rows as unverified rather than as firing.
    expect(store.scheduleHealth(row())).toEqual({ kind: 'firing' });
    expect(store.scheduleHealth(row(), [])).toEqual({ kind: 'firing' });
  });

  it('does not let the ledger override a paused or failing row', () => {
    const skips = [tick('skipped_busy', '2026-08-13T06:30:00Z')];
    expect(store.scheduleHealth(row({ status: 'paused' }), skips)).toEqual({
      kind: 'paused',
    });
    expect(
      store.scheduleHealth(row({ attempts: 1, lastError: 'boom' }), skips)
    ).toEqual({ kind: 'failing', attempts: 1, error: 'boom' });
  });
});

describe('needsLedger', () => {
  it('reads a ledger only for triggers that could be forfeiting ticks', async () => {
    const store = await freshModule();
    expect(store.needsLedger(row())).toBe(true);
    // Not on a cadence, or already failing outright: the row is the whole
    // answer, so a request per row here would buy nothing.
    expect(store.needsLedger(row({ status: 'paused' }))).toBe(false);
    expect(store.needsLedger(row({ status: 'completed' }))).toBe(false);
    expect(store.needsLedger(row({ status: 'dead_letter' }))).toBe(false);
    expect(store.needsLedger(row({ attempts: 1 }))).toBe(false);
  });
});

describe('validateCron', () => {
  it('accepts the five-field product cron', async () => {
    const store = await freshModule();
    for (const cron of ['30 6 * * 1-5', '*/15 * * * *', '  0 9 1 9 *  ']) {
      expect(store.validateCron(cron)).toEqual({ ok: true });
    }
  });

  it('names each refusal so the field can explain itself', async () => {
    const store = await freshModule();
    expect(store.validateCron('')).toEqual({ ok: false, reason: 'empty' });
    expect(store.validateCron('   ')).toEqual({ ok: false, reason: 'empty' });
    expect(store.validateCron('@daily')).toEqual({
      ok: false,
      reason: 'descriptor',
    });
    // Six fields parse — the store's own parser accepts them. The refusal is a
    // policy call about hammering admission, so it gets its own reason rather
    // than being reported as a syntax error the user could fix by retyping.
    expect(store.validateCron('*/5 * * * * *')).toEqual({
      ok: false,
      reason: 'seconds',
    });
    expect(store.validateCron('30 6 * *')).toEqual({
      ok: false,
      reason: 'fields',
    });
    expect(store.validateCron('30 6 * * 1-5 * *')).toEqual({
      ok: false,
      reason: 'fields',
    });
  });

  it('tolerates the whitespace a pasted cadence carries', async () => {
    const store = await freshModule();
    expect(store.validateCron('30\t6  *   * 1-5')).toEqual({ ok: true });
  });
});
