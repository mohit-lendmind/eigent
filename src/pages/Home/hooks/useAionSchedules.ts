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

import type { CreateScheduleRequest } from '@/api/aion/v1/transport';
import {
  createAionSchedule,
  deleteAionSchedule,
  getAionSchedulesMode,
  invalidateAionSchedules,
  listAionSchedules,
  loadAionScheduleEvents,
  needsLedger,
  pauseAionSchedule,
  requeueAionSchedule,
  resumeAionSchedule,
  scheduleHealth,
  type AionSchedule,
  type AionScheduleEvent,
  type AionScheduleHealth,
  type AionSchedulesMode,
} from '@/store/aionSchedulesStore';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// A forfeited tick is only visible in a trigger's own ledger, so deciding
// whether a list of triggers is healthy costs one read per candidate row. Two
// bounds keep that from becoming an unbounded fan-out: at most this many rows
// are read, and at most this many reads are in flight at once. Rows past the
// cap simply never get a ledger, which the view reports as unverified rather
// than as health.
const LEDGER_ROW_LIMIT = 40;
const LEDGER_CONCURRENCY = 4;
// Enough history to see a run of forfeited ticks without paging the ledger.
const LEDGER_WINDOW = 25;

export interface AionSchedulesView {
  /** null while the mode is still being negotiated. */
  mode: AionSchedulesMode | null;
  schedules: AionSchedule[];
  loading: boolean;
  /** A failed read or action, kept out of `mode` so a working list that fails
   *  one action keeps showing its rows. */
  error: string | null;
  /** The row whose request is in flight, so only that row's buttons disable.
   *  `new` is the create form's own key. */
  busyId: string | null;
  /** What the trigger is really doing, from its row and its ledger. */
  health: (schedule: AionSchedule) => AionScheduleHealth;
  /**
   * Rows whose ledger has not been read — still in flight, past the read cap,
   * or failed. Their health is derived from the row alone, which cannot see a
   * forfeited tick, so the screen says the check has not run rather than
   * implying the trigger is fine.
   */
  unverified: ReadonlySet<string>;
  /** One trigger's ledger window, once it has been read. */
  ledger: (scheduleId: string) => AionScheduleEvent[] | undefined;
  loadLedger: (scheduleId: string) => void;
  create: (request: CreateScheduleRequest) => Promise<boolean>;
  pause: (scheduleId: string) => Promise<void>;
  resume: (scheduleId: string) => Promise<void>;
  requeue: (scheduleId: string) => Promise<void>;
  remove: (scheduleId: string) => Promise<void>;
  reload: () => void;
}

/**
 * The tenant's triggers in aion mode. Called ONCE per Home hub mount (the value
 * rides the hub context) so the tab count and the list cannot disagree about
 * how many triggers there are.
 */
export function useAionSchedules(): AionSchedulesView {
  const [mode, setMode] = useState<AionSchedulesMode | null>(null);
  const [schedules, setSchedules] = useState<AionSchedule[]>([]);
  const [ledgers, setLedgers] = useState<Map<string, AionScheduleEvent[]>>(
    () => new Map()
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reloadCount, setReloadCount] = useState(0);
  // Ledger reads outlive the list they were issued for. The generation fences
  // a late reply from writing into a list the user has already reloaded away.
  const generation = useRef(0);

  // Rows the user has opened. Their ledger is a history the reader asked for,
  // not the health check `needsLedger` describes, so it is re-read on every
  // reload even once the row stops qualifying — a paused trigger is exactly the
  // one someone opens to find out what it did before it stopped, and dropping
  // its window would answer "no history" for a trigger that fired.
  const opened = useRef(new Set<string>());

  const readLedgers = useCallback(async (rows: AionSchedule[]) => {
    const mine = generation.current;
    // Deleted triggers let go of their slot. Pruned in place rather than
    // replaced, so a row opened while this read is in flight is not dropped.
    const present = new Set(rows.map((row) => row.scheduleId));
    for (const id of opened.current) {
      if (!present.has(id)) opened.current.delete(id);
    }
    // Opened rows first: they are on screen, and the row cap must not spend
    // itself on health checks for rows nobody is looking at.
    const candidates = [
      ...rows.filter((row) => opened.current.has(row.scheduleId)),
      ...rows.filter(
        (row) => !opened.current.has(row.scheduleId) && needsLedger(row)
      ),
    ].slice(0, LEDGER_ROW_LIMIT);
    let next = 0;
    const worker = async () => {
      for (;;) {
        const row = candidates[next];
        next += 1;
        if (!row) return;
        if (generation.current !== mine) return;
        try {
          const events = await loadAionScheduleEvents(
            row.scheduleId,
            LEDGER_WINDOW
          );
          if (generation.current !== mine) return;
          setLedgers((prev) => new Map(prev).set(row.scheduleId, events));
        } catch {
          // A ledger this read could not fetch leaves the row unverified —
          // which is the honest answer, and is what an absent entry already
          // means. Surfacing it as a screen-level error would blame the list
          // for a check that merely did not complete.
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(LEDGER_CONCURRENCY, candidates.length) }, worker)
    );
  }, []);

  useEffect(() => {
    let active = true;
    generation.current += 1;
    setLoading(true);
    setError(null);
    setLedgers(new Map());
    void (async () => {
      const resolved = await getAionSchedulesMode();
      if (!active) return;
      setMode(resolved);
      if (resolved.kind !== 'remote') {
        setSchedules([]);
        setLoading(false);
        return;
      }
      try {
        const rows = await listAionSchedules();
        if (!active) return;
        setSchedules(rows);
        void readLedgers(rows);
      } catch (cause) {
        if (active) setError(messageOf(cause));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      // Unmount fences the ledger reads too: they are issued outside this
      // effect's `active` flag and would otherwise still be in flight.
      generation.current += 1;
    };
  }, [readLedgers, reloadCount]);

  // Every mutation re-reads the list AND the ledgers of whatever it now
  // contains: an action that changes a trigger's state changes what its ledger
  // says about it, and a row left holding the pre-action window would report
  // the state the user just fixed.
  const refresh = useCallback(async () => {
    invalidateAionSchedules();
    const rows = await listAionSchedules();
    setSchedules(rows);
    await readLedgers(rows);
    return rows;
  }, [readLedgers]);

  const act = useCallback(
    async (scheduleId: string, call: () => Promise<unknown>) => {
      setBusyId(scheduleId);
      setError(null);
      try {
        await call();
        await refresh();
      } catch (cause) {
        setError(messageOf(cause));
      } finally {
        setBusyId(null);
      }
    },
    [refresh]
  );

  const create = useCallback(
    async (request: CreateScheduleRequest) => {
      setBusyId('new');
      setError(null);
      try {
        await createAionSchedule(request);
        await refresh();
        return true;
      } catch (cause) {
        setError(messageOf(cause));
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [refresh]
  );

  const pause = useCallback(
    (scheduleId: string) => act(scheduleId, () => pauseAionSchedule(scheduleId)),
    [act]
  );
  const resume = useCallback(
    (scheduleId: string) =>
      act(scheduleId, () => resumeAionSchedule(scheduleId)),
    [act]
  );
  const requeue = useCallback(
    (scheduleId: string) =>
      act(scheduleId, () => requeueAionSchedule(scheduleId)),
    [act]
  );
  const remove = useCallback(
    (scheduleId: string) =>
      act(scheduleId, () => deleteAionSchedule(scheduleId)),
    [act]
  );

  const loadLedger = useCallback((scheduleId: string) => {
    const mine = generation.current;
    opened.current.add(scheduleId);
    void loadAionScheduleEvents(scheduleId, LEDGER_WINDOW)
      .then((events) => {
        if (generation.current !== mine) return;
        setLedgers((prev) => new Map(prev).set(scheduleId, events));
      })
      .catch((cause) => {
        if (generation.current === mine) setError(messageOf(cause));
      });
  }, []);

  const unverified = useMemo(
    () =>
      new Set(
        schedules
          .filter((row) => needsLedger(row) && !ledgers.has(row.scheduleId))
          .map((row) => row.scheduleId)
      ),
    [ledgers, schedules]
  );

  const health = useCallback(
    (schedule: AionSchedule) =>
      scheduleHealth(schedule, ledgers.get(schedule.scheduleId) ?? []),
    [ledgers]
  );

  const ledger = useCallback(
    (scheduleId: string) => ledgers.get(scheduleId),
    [ledgers]
  );

  const reload = useCallback(() => {
    invalidateAionSchedules();
    setReloadCount((count) => count + 1);
  }, []);

  // Stable identity: this value rides the hub context memo, which would
  // otherwise recompute on every render of the Home hub.
  return useMemo(
    () => ({
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
    }),
    [
      busyId,
      create,
      error,
      health,
      ledger,
      loadLedger,
      loading,
      mode,
      pause,
      reload,
      remove,
      requeue,
      resume,
      schedules,
      unverified,
    ]
  );
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
