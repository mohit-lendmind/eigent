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

import { getAuthEnvironmentKey } from '@/lib/authEnvironment';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { dispatchEventLog, registerWorkstreamBus } from './_bus';
import { newCrmId } from './domain/ids';
import type {
  ActivityEvent,
  CaseId,
  ClientId,
  FactFindSectionKey,
  FieldChangeEvent,
  RepairReport,
  RetentionEntry,
  StreamEntry,
  WorklistId,
  WorklistItem,
  WorklistResolution,
} from './domain/types';
import { CRM_SCHEMA_VERSION } from './domain/types';

export const CRM_WORKSTREAM_PERSIST_VERSION = 1;
export const CRM_WORKSTREAM_STORE_KEY = 'crm-workstream-store';

// FR-030: hard ceiling on persisted stream entries per case.
export const STREAM_ENTRIES_PER_CASE_CAP = 200;

export interface CrmWorkstreamState {
  storageEnvironmentKey: string;
  worklistItems: Record<WorklistId, WorklistItem>;
  streamByCase: Record<CaseId, StreamEntry[]>;
  activityByCase: Record<CaseId, ActivityEvent[]>;
  retentionEntries: RetentionEntry[];
  fieldChangeEvents: FieldChangeEvent[];
  lastRepairReport: RepairReport | null;

  upsertWorklistItems: (items: WorklistItem[]) => void;
  resolveWorklistItem: (
    id: WorklistId,
    opts: { resolution: WorklistResolution; resolvedBy: string }
  ) => void;
  pushStreamEntry: (
    caseId: CaseId,
    entry: Omit<StreamEntry, 'id' | 'schemaVersion' | 'caseId'> & {
      id?: string;
      caseId?: CaseId;
    }
  ) => void;
  upsertStreamEntries: (entries: StreamEntry[]) => void;
  noteActivity: (caseId: CaseId, activity: ActivityEvent) => void;
  upsertRetention: (entry: RetentionEntry) => void;
  upsertRetentionMany: (entries: RetentionEntry[]) => void;
  appendFieldChangeEvent: (
    event: Omit<FieldChangeEvent, 'id' | 'schemaVersion'>
  ) => void;
  getFieldChangeEventsForField: (
    caseId: CaseId,
    clientId: ClientId,
    section: FactFindSectionKey,
    fieldKey: string
  ) => FieldChangeEvent[];
  getFieldChangeEventsForCase: (caseId: CaseId) => FieldChangeEvent[];
  setLastRepairReport: (report: RepairReport | null) => void;
  getLastRepairReport: () => RepairReport | null;
  resetForTests: () => void;
}

const emptyState = (): Pick<
  CrmWorkstreamState,
  | 'storageEnvironmentKey'
  | 'worklistItems'
  | 'streamByCase'
  | 'activityByCase'
  | 'retentionEntries'
  | 'fieldChangeEvents'
  | 'lastRepairReport'
> => ({
  storageEnvironmentKey: getAuthEnvironmentKey(),
  worklistItems: {},
  streamByCase: {},
  activityByCase: {},
  retentionEntries: [],
  fieldChangeEvents: [],
  lastRepairReport: null,
});

const environmentMatches = (
  state: Partial<CrmWorkstreamState> | undefined
): boolean => state?.storageEnvironmentKey === getAuthEnvironmentKey();

function isTruncationMarker(entry: StreamEntry): boolean {
  return typeof entry.truncatedCount === 'number' && entry.truncatedCount > 0;
}

function isEvictableStreamEntry(
  entry: StreamEntry,
  worklist: Record<WorklistId, WorklistItem>
): boolean {
  // Markers must NEVER be evicted (they exist to prove eviction happened).
  if (isTruncationMarker(entry)) return false;
  // Unresolved conflict/approval entries are NEVER evicted (spec FR-030).
  if (entry.kind === 'conflict' || entry.kind === 'approval') {
    const linked = entry.linkedWorklistId
      ? worklist[entry.linkedWorklistId]
      : undefined;
    if (!linked || linked.status === 'open') return false;
    // Once the linked worklist item is resolved, the entry becomes
    // eligible for eviction (see tasks.md T077 for the exact rule).
    return true;
  }
  if (
    entry.kind === 'done' ||
    entry.kind === 'external' ||
    entry.kind === 'activity'
  ) {
    return true;
  }
  // Other kinds (live, intent, directive, blocked) — non-evictable by default;
  // FR-030 explicitly names done/external/activity as the eligible set.
  return false;
}

function enforceStreamCap(
  entries: StreamEntry[],
  worklist: Record<WorklistId, WorklistItem>
): { next: StreamEntry[] } {
  if (entries.length <= STREAM_ENTRIES_PER_CASE_CAP) return { next: entries };
  const overflow = entries.length - STREAM_ENTRIES_PER_CASE_CAP;
  const next = [...entries];
  // Find an existing marker to coalesce into (avoid creating many markers).
  let markerIndex = next.findIndex(isTruncationMarker);
  let evicted = 0;
  let firstEvictedWhen: number | undefined;
  for (let step = 0; step < overflow; step += 1) {
    let oldestIdx = -1;
    let oldestWhen = Infinity;
    for (let i = 0; i < next.length; i += 1) {
      const e = next[i];
      if (!isEvictableStreamEntry(e, worklist)) continue;
      if (e.when < oldestWhen) {
        oldestWhen = e.when;
        oldestIdx = i;
      }
    }
    if (oldestIdx < 0) break; // no more evictable entries → persist over-cap.
    const dropped = next[oldestIdx];
    if (firstEvictedWhen === undefined || dropped.when < firstEvictedWhen) {
      firstEvictedWhen = dropped.when;
    }
    next.splice(oldestIdx, 1);
    if (markerIndex > oldestIdx) markerIndex -= 1;
    evicted += 1;
  }
  if (evicted === 0) return { next: entries };
  if (markerIndex >= 0) {
    const existing = next[markerIndex];
    const nextCount = (existing.truncatedCount ?? 0) + evicted;
    const nextBefore =
      firstEvictedWhen !== undefined &&
      firstEvictedWhen > (existing.truncatedBefore ?? 0)
        ? firstEvictedWhen
        : (existing.truncatedBefore ?? firstEvictedWhen);
    next[markerIndex] = {
      ...existing,
      truncatedCount: nextCount,
      truncatedBefore: nextBefore,
      body: `${nextCount} older entries evicted at cap.`,
    };
  } else {
    const marker: StreamEntry = {
      id: newCrmId('stream_trunc'),
      caseId: next[0]?.caseId ?? entries[0].caseId,
      kind: 'done',
      iconTone: 'muted',
      when: firstEvictedWhen ?? 0,
      timestamp: firstEvictedWhen ?? 0,
      title: 'Older activity truncated',
      body: `${evicted} older entries evicted at cap.`,
      truncatedBefore: firstEvictedWhen,
      truncatedCount: evicted,
      schemaVersion: CRM_SCHEMA_VERSION,
    };
    next.unshift(marker);
  }
  return { next };
}

// Cap the persisted stream using the same evictability predicate as the push
// path. If nothing is evictable, persist over-cap rather than silently drop
// protected entries (FR-030: never-evict is a hard invariant).
function capStreamForPersist(
  arr: StreamEntry[],
  worklist: Record<WorklistId, WorklistItem>
): StreamEntry[] {
  if (arr.length <= STREAM_ENTRIES_PER_CASE_CAP) return arr;
  const { next } = enforceStreamCap(arr, worklist);
  return next;
}

export const useCrmWorkstreamStore = create<CrmWorkstreamState>()(
  persist(
    (set, get) => ({
      ...emptyState(),

      upsertWorklistItems: (items) =>
        set((state) => {
          if (items.length === 0) return state;
          const next = { ...state.worklistItems };
          for (const it of items) {
            next[it.id] = { ...it, schemaVersion: CRM_SCHEMA_VERSION };
          }
          return { worklistItems: next };
        }),

      resolveWorklistItem: (id, opts) => {
        const nowTs = Date.now();
        let resolvedCaseId: CaseId | null = null;
        set((state) => {
          const prev = state.worklistItems[id];
          if (!prev) return state;
          if (prev.status === 'resolved') return state; // idempotent
          resolvedCaseId = prev.caseId;
          return {
            worklistItems: {
              ...state.worklistItems,
              [id]: {
                ...prev,
                status: 'resolved',
                resolvedAt: nowTs,
                resolvedBy: opts.resolvedBy,
                resolution: opts.resolution,
              },
            },
          };
        });
        // FR-018: a desktop worklist resolve queues upstream (only on an actual
        // resolve — an idempotent no-op enqueues nothing).
        if (resolvedCaseId) {
          const caseId: CaseId = resolvedCaseId;
          dispatchEventLog((bus) =>
            bus.enqueueOutbox({
              kind: 'lm.caselog/1',
              caseId,
              firmId: 'lendmind',
              at: nowTs,
              actor: { kind: 'adviser', id: opts.resolvedBy },
              event: {
                type: 'worklist-resolve',
                payload: {
                  id,
                  resolution: opts.resolution,
                  resolvedBy: opts.resolvedBy,
                },
              },
              origin: {
                artifactId: `outbox/${caseId}/worklist-resolve/${id}`,
                runId: '',
              },
              versions: {
                model: '',
                promptSha: '',
                skillSemver: '',
                skillSha: '',
              },
            })
          );
        }
      },

      pushStreamEntry: (caseIdArg, entry) =>
        set((state) => {
          const caseId = entry.caseId ?? caseIdArg;
          const arr = state.streamByCase[caseId] ?? [];
          const stamped: StreamEntry = {
            ...entry,
            id: entry.id ?? newCrmId('stream'),
            caseId,
            schemaVersion: CRM_SCHEMA_VERSION,
          } as StreamEntry;
          const withNew = [...arr, stamped];
          const { next } = enforceStreamCap(withNew, state.worklistItems);
          return {
            streamByCase: {
              ...state.streamByCase,
              [caseId]: next,
            },
          };
        }),

      upsertStreamEntries: (entries) =>
        set((state) => {
          if (entries.length === 0) return state;
          const nextByCase = { ...state.streamByCase };
          for (const e of entries) {
            const arr = nextByCase[e.caseId] ?? [];
            const idx = arr.findIndex((x) => x.id === e.id);
            const stamped = { ...e, schemaVersion: CRM_SCHEMA_VERSION };
            nextByCase[e.caseId] =
              idx >= 0
                ? arr.map((x, i) => (i === idx ? stamped : x))
                : [...arr, stamped];
          }
          return { streamByCase: nextByCase };
        }),

      noteActivity: (caseId, activity) =>
        set((state) => {
          const arr = state.activityByCase[caseId] ?? [];
          return {
            activityByCase: {
              ...state.activityByCase,
              [caseId]: [
                ...arr,
                { ...activity, schemaVersion: CRM_SCHEMA_VERSION },
              ],
            },
          };
        }),

      upsertRetention: (entry) =>
        set((state) => {
          const stamped: RetentionEntry = {
            ...entry,
            schemaVersion: CRM_SCHEMA_VERSION,
          };
          const idx = state.retentionEntries.findIndex(
            (r) => r.clientId === entry.clientId && r.endsAt === entry.endsAt
          );
          const next =
            idx >= 0
              ? state.retentionEntries.map((r, i) => (i === idx ? stamped : r))
              : [...state.retentionEntries, stamped];
          return { retentionEntries: next };
        }),

      upsertRetentionMany: (entries) =>
        set((state) => {
          if (entries.length === 0) return state;
          const next = [...state.retentionEntries];
          for (const entry of entries) {
            const stamped: RetentionEntry = {
              ...entry,
              schemaVersion: CRM_SCHEMA_VERSION,
            };
            const idx = next.findIndex(
              (r) => r.clientId === entry.clientId && r.endsAt === entry.endsAt
            );
            if (idx >= 0) next[idx] = stamped;
            else next.push(stamped);
          }
          return { retentionEntries: next };
        }),

      appendFieldChangeEvent: (event) =>
        set((state) => ({
          fieldChangeEvents: [
            ...state.fieldChangeEvents,
            {
              ...event,
              id: newCrmId('event'),
              schemaVersion: CRM_SCHEMA_VERSION,
            },
          ],
        })),

      getFieldChangeEventsForField: (caseId, clientId, section, fieldKey) => {
        return get()
          .fieldChangeEvents.filter(
            (e) =>
              e.caseId === caseId &&
              e.clientId === clientId &&
              e.section === section &&
              e.fieldKey === fieldKey
          )
          .sort((a, b) => a.changedAt - b.changedAt);
      },

      getFieldChangeEventsForCase: (caseId) => {
        return get()
          .fieldChangeEvents.filter((e) => e.caseId === caseId)
          .sort((a, b) => a.changedAt - b.changedAt);
      },

      setLastRepairReport: (report) => set({ lastRepairReport: report }),
      getLastRepairReport: () => get().lastRepairReport,

      resetForTests: () => set(emptyState()),
    }),
    {
      name: CRM_WORKSTREAM_STORE_KEY,
      version: CRM_WORKSTREAM_PERSIST_VERSION,
      migrate: (persistedState) => {
        const state = persistedState as Partial<CrmWorkstreamState> | undefined;
        if (!state) return persistedState as CrmWorkstreamState;
        if (!environmentMatches(state)) {
          const empty = emptyState() as CrmWorkstreamState;
          return {
            ...empty,
            lastRepairReport: {
              ranAt: Date.now(),
              envMismatch: true,
              placeholderClientsCreated: [],
              prunedWorklist: [],
              prunedStream: [],
              prunedActivity: [],
              retargetedDocuments: [],
              recomputedCases: [],
            },
          };
        }
        // Prune persisted stream entries to the cap, respecting never-evict
        // rules — unresolved conflict/approval + markers cannot be dropped.
        const streamByCase = state.streamByCase ?? {};
        const cappedStream: Record<CaseId, StreamEntry[]> = {};
        const worklist = state.worklistItems ?? {};
        for (const [cid, arr] of Object.entries(streamByCase)) {
          if (!Array.isArray(arr)) continue;
          cappedStream[cid] = capStreamForPersist(arr, worklist);
        }
        return {
          ...state,
          storageEnvironmentKey: getAuthEnvironmentKey(),
          worklistItems: worklist,
          streamByCase: cappedStream,
          activityByCase: state.activityByCase ?? {},
          retentionEntries: Array.isArray(state.retentionEntries)
            ? state.retentionEntries
            : [],
          fieldChangeEvents: Array.isArray(state.fieldChangeEvents)
            ? state.fieldChangeEvents
            : [],
          lastRepairReport: state.lastRepairReport ?? null,
        } as CrmWorkstreamState;
      },
      partialize: (state) => {
        // Cap persisted stream size again on write, using the same never-evict
        // predicate as the push path.
        const stream: Record<CaseId, StreamEntry[]> = {};
        for (const [cid, arr] of Object.entries(state.streamByCase)) {
          stream[cid] = capStreamForPersist(arr, state.worklistItems);
        }
        return {
          storageEnvironmentKey: state.storageEnvironmentKey,
          worklistItems: state.worklistItems,
          streamByCase: stream,
          activityByCase: state.activityByCase,
          retentionEntries: state.retentionEntries,
          fieldChangeEvents: state.fieldChangeEvents,
          // lastRepairReport is diagnostic, not durable — kept out of persist.
        };
      },
    }
  )
);

export function getCrmWorkstreamStore(): typeof useCrmWorkstreamStore {
  return useCrmWorkstreamStore;
}

// Register a synchronous side-bus so cases/documents can dispatch here without
// static imports that would violate FR-014's one-directional rule.
registerWorkstreamBus({
  appendFieldChangeEvent: (event) =>
    useCrmWorkstreamStore.getState().appendFieldChangeEvent(event),
  noteActivity: (caseId, activity) =>
    useCrmWorkstreamStore.getState().noteActivity(caseId, activity),
  pushStreamEntry: (caseId, entry) =>
    useCrmWorkstreamStore.getState().pushStreamEntry(caseId, entry),
  resolveWorklistItem: (id, opts) => {
    const prev = useCrmWorkstreamStore.getState().worklistItems[id];
    if (!prev) return 'unknown';
    if (prev.status === 'resolved') return 'already-resolved';
    useCrmWorkstreamStore.getState().resolveWorklistItem(id, opts);
    return 'resolved';
  },
  findWorklistItemByConflict: (conflictId) => {
    for (const w of Object.values(
      useCrmWorkstreamStore.getState().worklistItems
    )) {
      if (w.linkedConflictId === conflictId) {
        return { id: w.id, status: w.status };
      }
    }
    return null;
  },
  hasFieldChangeEventForConflict: (conflictId) => {
    return useCrmWorkstreamStore
      .getState()
      .fieldChangeEvents.some(
        (e) => e.conflictId === conflictId && e.reason === 'conflict-resolution'
      );
  },
  hasStreamEntryForConflict: (caseId, title, linkedWorklistId) => {
    const arr = useCrmWorkstreamStore.getState().streamByCase[caseId] ?? [];
    return arr.some(
      (e) =>
        e.kind === 'done' &&
        e.title === title &&
        e.linkedWorklistId === linkedWorklistId
    );
  },
});

if (typeof queueMicrotask === 'function') {
  queueMicrotask(() => {
    const state = useCrmWorkstreamStore.getState();
    if (!environmentMatches(state)) {
      useCrmWorkstreamStore.setState({
        ...(emptyState() as CrmWorkstreamState),
        lastRepairReport: {
          ranAt: Date.now(),
          envMismatch: true,
          placeholderClientsCreated: [],
          prunedWorklist: [],
          prunedStream: [],
          prunedActivity: [],
          retargetedDocuments: [],
          recomputedCases: [],
        },
      });
      console.warn(
        '[workstreamStore] Cleared persisted workstream after API environment changed.'
      );
    }
  });
}
