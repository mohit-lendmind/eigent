// The list's ledger reads. Two different things want a ledger and only one of
// them is a health check: the screen reads one per active row to find forfeited
// ticks, and the reader opens a row to see what it did. The second outlives the
// first — a paused trigger stops qualifying for the health check at exactly the
// moment someone opens it to ask why it stopped.
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAionSchedules } from '@/pages/Home/hooks/useAionSchedules';
import type {
  AionSchedule,
  AionScheduleEvent,
} from '@/store/aionSchedulesStore';

const mocks = vi.hoisted(() => ({
  rows: [] as AionSchedule[],
  eventReads: [] as string[],
}));

// `needsLedger` and `scheduleHealth` stay real: they are the predicate under
// test and the derivation that reads its result.
vi.mock('@/store/aionSchedulesStore', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/store/aionSchedulesStore')>();
  return {
    ...actual,
    getAionSchedulesMode: vi.fn(async () => ({ kind: 'remote' as const })),
    invalidateAionSchedules: vi.fn(),
    listAionSchedules: vi.fn(async () => mocks.rows),
    loadAionScheduleEvents: vi.fn(async (scheduleId: string) => {
      mocks.eventReads.push(scheduleId);
      return [event(scheduleId)];
    }),
    pauseAionSchedule: vi.fn(async () => {}),
  };
});

function schedule(overrides: Partial<AionSchedule> = {}): AionSchedule {
  return {
    scheduleId: 'sch_1',
    projectId: 'prj_1',
    cron: '* * * * *',
    task: 'Summarise the overnight builds',
    singleShot: false,
    status: 'active',
    nextFireAt: '2026-08-17T06:30:00Z',
    lastFiredTick: '2026-08-14T06:30:00Z',
    attempts: 0,
    lastError: null,
    createdAt: '2026-08-01T09:14:22.113Z',
    updatedAt: '2026-08-14T06:30:04.001Z',
    ...overrides,
  };
}

function event(scheduleId: string): AionScheduleEvent {
  return {
    eventId: '41',
    scheduleId,
    action: 'fired',
    payload: { tick: '2026-08-14T06:30:00Z' },
    occurredAt: '2026-08-14T06:30:00.412Z',
  };
}

beforeEach(() => {
  mocks.rows = [schedule()];
  mocks.eventReads = [];
});

describe('useAionSchedules', () => {
  it('keeps re-reading the ledger of a row the reader opened after it stops qualifying for the health check', async () => {
    const { result } = renderHook(() => useAionSchedules());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(mocks.eventReads).toEqual(['sch_1']));

    act(() => result.current.loadLedger('sch_1'));
    await waitFor(() => expect(result.current.ledger('sch_1')).toBeDefined());

    // The user pauses it, then reloads the screen. A paused row is not a health
    // candidate, so without the open-row carve-out its window is dropped and
    // the expanded row reports no history for a trigger that fired.
    mocks.rows = [schedule({ status: 'paused' })];
    mocks.eventReads = [];
    act(() => result.current.reload());

    await waitFor(() => expect(mocks.eventReads).toEqual(['sch_1']));
    await waitFor(() =>
      expect(result.current.ledger('sch_1')).toHaveLength(1)
    );
  });

  it('does not read the ledger of a paused row nobody opened', async () => {
    mocks.rows = [schedule({ status: 'paused' })];
    const { result } = renderHook(() => useAionSchedules());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.schedules).toHaveLength(1));

    expect(mocks.eventReads).toEqual([]);
    expect(result.current.ledger('sch_1')).toBeUndefined();
    // Health for a paused row never consulted the ledger, so the row is not
    // pending a check it will never run.
    expect(result.current.unverified.has('sch_1')).toBe(false);
  });

  it('lets a deleted trigger go rather than reading a ledger for a row that is gone', async () => {
    const { result } = renderHook(() => useAionSchedules());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.loadLedger('sch_1'));
    await waitFor(() => expect(result.current.ledger('sch_1')).toBeDefined());

    mocks.rows = [];
    mocks.eventReads = [];
    act(() => result.current.reload());

    await waitFor(() => expect(result.current.schedules).toEqual([]));
    expect(mocks.eventReads).toEqual([]);
  });
});
