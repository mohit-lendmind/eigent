// The Home Triggers section in aion mode. The assertions worth having here are
// all about what the badge claims: a forfeited tick leaves the row identical to
// a healthy one, and a row whose ledger was never read has to say so rather
// than borrow the row's optimism.
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Triggers from '@/pages/Home/Triggers';
import {
  scheduleHealth,
  type AionSchedule,
  type AionScheduleEvent,
  type AionSchedulesMode,
} from '@/store/aionSchedulesStore';

// Resolved against the shipped en-us bundles with {{token}} interpolation, so a
// key nobody translated renders as its own key and fails the assertion.
vi.mock('react-i18next', async () => {
  const layout = (await import('@/i18n/locales/en-us/layout.json'))
    .default as Record<string, string>;
  const triggers = (await import('@/i18n/locales/en-us/triggers.json'))
    .default as Record<string, unknown>;
  const namespaces: Record<string, Record<string, unknown>> = {
    layout,
    triggers,
  };
  return {
    // The legacy body's import graph reaches src/i18n, which initialises the
    // real instance; the stub below is what keeps that import side-effect free.
    initReactI18next: { type: '3rdParty', init: () => {} },
    useTranslation: () => ({
      t: (key: string, options?: Record<string, unknown>) => {
        const [namespace, ...rest] = key.split('.');
        const value = namespaces[namespace]?.[rest.join('.')];
        if (typeof value !== 'string') {
          return typeof options?.defaultValue === 'string'
            ? options.defaultValue
            : key;
        }
        return value.replace(/\{\{(\w+)\}\}/g, (_match, token: string) =>
          String(options?.[token] ?? '')
        );
      },
    }),
  };
});

const mocks = vi.hoisted(() => ({
  hub: {} as Record<string, unknown>,
}));

vi.mock('@/pages/Home/context', () => ({
  useHomeHub: () => mocks.hub,
}));

function schedule(overrides: Partial<AionSchedule> = {}): AionSchedule {
  return {
    scheduleId: 'sch_1',
    projectId: 'prj_1',
    cron: '30 6 * * 1-5',
    task: 'Summarise the overnight builds',
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

let nextEventId = 500;
function tick(action: string, occurredAt: string): AionScheduleEvent {
  nextEventId += 1;
  return {
    eventId: String(nextEventId),
    scheduleId: 'sch_1',
    action,
    payload: {},
    occurredAt,
  };
}

const actions = {
  create: vi.fn(async () => true),
  pause: vi.fn(async () => {}),
  resume: vi.fn(async () => {}),
  requeue: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
  reload: vi.fn(),
  loadLedger: vi.fn(),
};

function renderWith(
  mode: AionSchedulesMode | null,
  overrides: {
    schedules?: AionSchedule[];
    ledgers?: Record<string, AionScheduleEvent[]>;
    unverified?: string[];
    loading?: boolean;
    error?: string | null;
    projects?: { projectId: string; title: string }[];
    searchQuery?: string;
  } = {}
) {
  const schedules = overrides.schedules ?? [];
  const ledgers = overrides.ledgers ?? {};
  mocks.hub = {
    searchQuery: overrides.searchQuery ?? '',
    // What the legacy hosted-cloud body reads. Empty on an aion desktop, which
    // is the whole reason the dispatcher exists.
    viewMode: 'list',
    sortBy: 'created',
    sortDirection: 'desc',
    triggers: [],
    triggersLoading: false,
    reloadTriggers: vi.fn(),
    aionProjects: { projects: overrides.projects ?? [] },
    aionSchedules: {
      mode,
      schedules,
      loading: overrides.loading ?? false,
      error: overrides.error ?? null,
      busyId: null,
      // The real derivation, so a wrong reading of a ledger still fails here.
      health: (row: AionSchedule) => scheduleHealth(row, ledgers[row.scheduleId] ?? []),
      unverified: new Set(overrides.unverified ?? []),
      ledger: (id: string) => ledgers[id],
      ...actions,
    },
  };
  return render(
    <MemoryRouter>
      <Triggers />
    </MemoryRouter>
  );
}

function badges() {
  return screen
    .getAllByTestId('aion-trigger-health')
    .map((node) => node.getAttribute('data-health'));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Home Triggers mode branch', () => {
  it('waits for the negotiation instead of showing either plane', () => {
    renderWith(null);
    expect(screen.queryByTestId('aion-triggers')).toBeNull();
    // The legacy empty state is the tell that the hosted-cloud body rendered.
    expect(screen.queryByText('No triggers yet')).toBeNull();
  });

  it('renders the legacy hosted-cloud body in local mode', () => {
    renderWith({ kind: 'local' });
    expect(screen.getByText('No triggers yet')).toBeTruthy();
    expect(screen.queryByTestId('aion-triggers')).toBeNull();
  });

  it('names the version a too-old backend reported', () => {
    renderWith({ kind: 'unsupported', edgeApiVersion: '1.9.0' });
    const banner = screen.getByTestId('aion-triggers-banner');
    expect(banner.textContent).toContain('edge API 1.9.0');
    // Not the empty state: the triggers still exist and still fire, this
    // desktop just cannot see them.
    expect(screen.queryByTestId('aion-triggers-empty')).toBeNull();
  });

  it('shows a remote error rather than degrading to the legacy plane', () => {
    renderWith({ kind: 'error', message: 'edge unreachable' });
    expect(
      screen.getByTestId('aion-triggers-banner').textContent
    ).toContain('edge unreachable');
    expect(screen.queryByTestId('aion-triggers')).toBeNull();
  });
});

describe('Home Triggers health', () => {
  it('separates a firing trigger from one forfeiting every tick', async () => {
    renderWith(
      { kind: 'remote' },
      {
        schedules: [
          schedule(),
          schedule({ scheduleId: 'sch_2', task: 'Poll the incident feed' }),
        ],
        ledgers: {
          // Byte-identical rows above; only the ledger tells them apart.
          sch_1: [tick('fired', '2026-08-14T06:30:00Z')],
          sch_2: [
            tick('fired', '2026-08-10T06:30:00Z'),
            tick('skipped_busy', '2026-08-12T06:30:00Z'),
            tick('skipped_busy', '2026-08-13T06:30:00Z'),
          ],
        },
      }
    );
    expect(badges()).toEqual(['firing', 'skipping_busy']);
    const skipping = screen.getAllByTestId('aion-trigger-health')[1];
    expect(skipping.textContent).toContain('the project was already busy');
    // The streak and its start are what turn "skipping" into something a user
    // can act on.
    expect(skipping.getAttribute('title')).toContain('2 firings forfeited');
  });

  it('names a foreign generation as its own cause', () => {
    renderWith(
      { kind: 'remote' },
      {
        schedules: [schedule()],
        ledgers: {
          sch_1: [tick('skipped_generation', '2026-08-13T06:30:00Z')],
        },
      }
    );
    expect(badges()).toEqual(['skipping_generation']);
  });

  it('says the check has not run rather than implying health', () => {
    renderWith(
      { kind: 'remote' },
      { schedules: [schedule()], unverified: ['sch_1'] }
    );
    // The row alone reads as firing; without its ledger that is a claim this
    // screen has not earned.
    expect(badges()).toEqual(['unverified']);
    expect(screen.getByTestId('aion-trigger-health').textContent).toContain(
      'Not checked'
    );
  });

  it('reports the lifecycle states off the row', () => {
    renderWith(
      { kind: 'remote' },
      {
        schedules: [
          schedule({ scheduleId: 'sch_p', status: 'paused', nextFireAt: null }),
          schedule({ scheduleId: 'sch_c', status: 'completed', nextFireAt: null }),
          schedule({
            scheduleId: 'sch_d',
            status: 'dead_letter',
            attempts: 5,
            nextFireAt: null,
            lastError: 'submit command: context deadline exceeded',
          }),
          schedule({ scheduleId: 'sch_f', attempts: 2, lastError: 'boom' }),
          schedule({ scheduleId: 'sch_n', lastFiredTick: null }),
          schedule({ scheduleId: 'sch_x', status: 'quarantined' }),
        ],
      }
    );
    expect(badges()).toEqual([
      'paused',
      'completed',
      'dead_letter',
      'failing',
      'never_fired',
      // A state this build has no name for is never rendered as healthy.
      'unknown',
    ]);
    expect(screen.getAllByTestId('aion-trigger-health')[3].textContent).toContain(
      '2 in a row'
    );
    expect(screen.getAllByTestId('aion-trigger-health')[5].textContent).toContain(
      'quarantined'
    );
  });

  it('distinguishes a scheduled next firing from none at all', () => {
    renderWith(
      { kind: 'remote' },
      {
        schedules: [
          schedule(),
          schedule({ scheduleId: 'sch_2', status: 'paused', nextFireAt: null }),
        ],
      }
    );
    const [next, none] = screen.getAllByTestId('aion-trigger-next');
    expect(next.textContent).toMatch(/^Next \S/);
    expect(none.textContent).toBe('No next firing');
  });
});

describe('Home Triggers actions', () => {
  it('offers Requeue only on a dead-lettered trigger', () => {
    renderWith(
      { kind: 'remote' },
      { schedules: [schedule({ status: 'dead_letter', attempts: 5 })] }
    );
    expect(screen.getByTestId('aion-trigger-requeue')).toBeTruthy();
    // A dead trigger has no cadence to pause and is not paused either.
    expect(screen.queryByTestId('aion-trigger-pause')).toBeNull();
    expect(screen.queryByTestId('aion-trigger-resume')).toBeNull();

    screen.getByTestId('aion-trigger-requeue').click();
    expect(actions.requeue).toHaveBeenCalledWith('sch_1');
  });

  it('offers Pause on an active trigger and Resume on a paused one', () => {
    renderWith({ kind: 'remote' }, { schedules: [schedule()] });
    expect(screen.getByTestId('aion-trigger-pause')).toBeTruthy();
    expect(screen.queryByTestId('aion-trigger-requeue')).toBeNull();

    cleanup();
    renderWith({ kind: 'remote' }, { schedules: [schedule({ status: 'paused' })] });
    expect(screen.getByTestId('aion-trigger-resume')).toBeTruthy();
    expect(screen.queryByTestId('aion-trigger-pause')).toBeNull();
  });

  it('re-reads the ledger on every open rather than trusting the window it has', async () => {
    const user = userEvent.setup();
    renderWith(
      { kind: 'remote' },
      {
        schedules: [schedule()],
        ledgers: {
          sch_1: [
            tick('fired', '2026-08-13T06:30:00Z'),
            tick('skipped_busy', '2026-08-14T06:30:00Z'),
          ],
        },
      }
    );
    await user.click(screen.getByTestId('aion-trigger-expand'));
    // The cached window may predate the ticks the user opened the row to find.
    expect(actions.loadLedger).toHaveBeenCalledWith('sch_1');

    const entries = screen
      .getAllByTestId('aion-trigger-ledger-entry')
      .map((node) => node.getAttribute('data-action'));
    // Newest first for reading, against a route that serves oldest first.
    expect(entries).toEqual(['skipped_busy', 'fired']);
    expect(screen.getByTestId('aion-trigger-ledger').textContent).toContain(
      'Skipped — project busy'
    );
  });

  it('refuses to submit a cadence the edge would reject', async () => {
    const user = userEvent.setup();
    renderWith(
      { kind: 'remote' },
      { projects: [{ projectId: 'prj_1', title: 'Build health' }] }
    );
    await user.click(screen.getByTestId('aion-triggers-new'));
    await user.type(screen.getByTestId('aion-trigger-task'), 'Check the feed');
    await user.type(screen.getByTestId('aion-trigger-cron'), '@daily');
    await user.tab();

    expect(screen.getByTestId('aion-trigger-cron-error').textContent).toContain(
      'Shorthand such as @daily'
    );
    expect(
      screen.getByTestId('aion-trigger-submit').hasAttribute('disabled')
    ).toBe(true);
    expect(actions.create).not.toHaveBeenCalled();
  });

  it('creates from the form once the cadence is valid', async () => {
    const user = userEvent.setup();
    renderWith(
      { kind: 'remote' },
      { projects: [{ projectId: 'prj_1', title: 'Build health' }] }
    );
    await user.click(screen.getByTestId('aion-triggers-new'));
    await user.type(screen.getByTestId('aion-trigger-task'), 'Check the feed');
    await user.type(screen.getByTestId('aion-trigger-cron'), '30 6 * * 1-5');
    await user.click(screen.getByTestId('aion-trigger-submit'));

    expect(actions.create).toHaveBeenCalledWith({
      project_id: 'prj_1',
      cron: '30 6 * * 1-5',
      task: 'Check the feed',
      single_shot: false,
    });
  });

  it('asks for a project before offering the form', async () => {
    const user = userEvent.setup();
    renderWith({ kind: 'remote' }, { projects: [] });
    await user.click(screen.getByTestId('aion-triggers-new'));
    // A trigger runs its task inside a Project; an empty picker would submit a
    // request the edge can only refuse.
    expect(screen.getByTestId('aion-trigger-no-projects')).toBeTruthy();
    expect(screen.queryByTestId('aion-trigger-form')).toBeNull();
  });

  it('keeps the rows when an action fails', () => {
    renderWith(
      { kind: 'remote' },
      { schedules: [schedule()], error: 'schedule_wrong_status' }
    );
    expect(screen.getAllByTestId('aion-trigger-row')).toHaveLength(1);
    expect(screen.getByTestId('aion-triggers-error').textContent).toContain(
      'schedule_wrong_status'
    );
  });

  it('separates an empty tenant from an empty search', async () => {
    renderWith({ kind: 'remote' }, { schedules: [] });
    expect(screen.getByTestId('aion-triggers-empty')).toBeTruthy();

    cleanup();
    renderWith(
      { kind: 'remote' },
      { schedules: [schedule()], searchQuery: 'nothing matches this' }
    );
    expect(screen.queryByTestId('aion-triggers-empty')).toBeNull();
    expect(screen.queryByTestId('aion-trigger-row')).toBeNull();
  });
});
