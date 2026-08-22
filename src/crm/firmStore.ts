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

export interface CrmFirmState {
  storageEnvironmentKey: string;
  coordinatorProjectByFirm: Record<string, string>;
  setCoordinatorProject: (firmId: string, projectId: string) => void;
  getCoordinatorProject: (firmId: string) => string | undefined;
  resetForTests: () => void;
}

const emptyState = (): Pick<
  CrmFirmState,
  'storageEnvironmentKey' | 'coordinatorProjectByFirm'
> => ({
  storageEnvironmentKey: getAuthEnvironmentKey(),
  coordinatorProjectByFirm: {},
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
        } as CrmFirmState;
      },
      partialize: (state) => ({
        storageEnvironmentKey: state.storageEnvironmentKey,
        coordinatorProjectByFirm: state.coordinatorProjectByFirm,
      }),
    }
  )
);

export function getCrmFirmStore(): typeof useCrmFirmStore {
  return useCrmFirmStore;
}
