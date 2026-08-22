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

// FR-003 — the firm-level durable pointers. The one that matters in M2 is the
// firm's watcher coordinator Project id: it MUST survive a restart (and the
// in-memory promise caches that resetCaseProjectCaches clears) so a firm keeps a
// SINGLE coordinator Project across sessions rather than minting a new one each
// boot and fragmenting its case-pointer index. Kept deliberately tiny and
// separate from the case stores so caseProject.ts can read it without a cycle.

import { getAuthEnvironmentKey } from '@/lib/authEnvironment';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const CRM_FIRM_PERSIST_VERSION = 1;
export const CRM_FIRM_STORE_KEY = 'crm-firm-store';

// What the watcher remembers about a case between passes so an unchanged case is
// skipped before any model spend. Persisted (finding 3): a module-level Map lost
// this on every process restart or renderer reload, so a warm restart re-spent
// on and re-proposed for cases that had not moved. Keyed by `${firmId}::${caseId}`.
export interface WatcherLastSeen {
  headSeq: string;
  proposedKind?: string;
}

export interface CrmFirmState {
  storageEnvironmentKey: string;
  coordinatorProjectByFirm: Record<string, string>;
  watcherLastSeenByCase: Record<string, WatcherLastSeen>;
  setCoordinatorProject: (firmId: string, projectId: string) => void;
  getCoordinatorProject: (firmId: string) => string | undefined;
  setWatcherLastSeen: (key: string, seen: WatcherLastSeen) => void;
  getWatcherLastSeen: (key: string) => WatcherLastSeen | undefined;
  clearWatcherLastSeen: () => void;
  resetForTests: () => void;
}

const emptyState = (): Pick<
  CrmFirmState,
  'storageEnvironmentKey' | 'coordinatorProjectByFirm' | 'watcherLastSeenByCase'
> => ({
  storageEnvironmentKey: getAuthEnvironmentKey(),
  coordinatorProjectByFirm: {},
  watcherLastSeenByCase: {},
});

const environmentMatches = (
  state: Partial<CrmFirmState> | undefined
): boolean => state?.storageEnvironmentKey === getAuthEnvironmentKey();

export const useCrmFirmStore = create<CrmFirmState>()(
  persist(
    (set, get) => ({
      ...emptyState(),
      setCoordinatorProject: (firmId, projectId) =>
        set((state) =>
          state.coordinatorProjectByFirm[firmId] === projectId
            ? state
            : {
                coordinatorProjectByFirm: {
                  ...state.coordinatorProjectByFirm,
                  [firmId]: projectId,
                },
              }
        ),
      getCoordinatorProject: (firmId) => get().coordinatorProjectByFirm[firmId],
      setWatcherLastSeen: (key, seen) =>
        set((state) => ({
          watcherLastSeenByCase: {
            ...state.watcherLastSeenByCase,
            [key]: seen,
          },
        })),
      getWatcherLastSeen: (key) => get().watcherLastSeenByCase[key],
      clearWatcherLastSeen: () => set({ watcherLastSeenByCase: {} }),
      resetForTests: () => set(emptyState()),
    }),
    {
      name: CRM_FIRM_STORE_KEY,
      version: CRM_FIRM_PERSIST_VERSION,
      migrate: (persistedState) => {
        const state = persistedState as Partial<CrmFirmState> | undefined;
        if (!state) return persistedState as CrmFirmState;
        if (!environmentMatches(state)) {
          return emptyState() as CrmFirmState;
        }
        return {
          ...state,
          storageEnvironmentKey: getAuthEnvironmentKey(),
          coordinatorProjectByFirm: state.coordinatorProjectByFirm ?? {},
          watcherLastSeenByCase: state.watcherLastSeenByCase ?? {},
        } as CrmFirmState;
      },
      partialize: (state) => ({
        storageEnvironmentKey: state.storageEnvironmentKey,
        coordinatorProjectByFirm: state.coordinatorProjectByFirm,
        watcherLastSeenByCase: state.watcherLastSeenByCase,
      }),
    }
  )
);

export function getCrmFirmStore(): typeof useCrmFirmStore {
  return useCrmFirmStore;
}
