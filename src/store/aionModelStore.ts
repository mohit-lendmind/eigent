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

/**
 * Remote-backend model preference. The desktop only ever holds an alias from
 * the edge's /models catalog — never provider credentials or routes. The
 * alias binds when a conversation's aion Project is created (first turn), so
 * a change applies to the next new conversation, not one already bound.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AionModelState {
  /** Global default alias; null → server default (catalog is_default). */
  selectedAlias: string | null;
  /** Per-Eigent-project pins, set before the project's first turn. */
  projectAlias: Record<string, string>;
  setSelectedAlias: (alias: string) => void;
  setProjectAlias: (projectId: string, alias: string) => void;
}

export const useAionModelStore = create<AionModelState>()(
  persist(
    (set) => ({
      selectedAlias: null,
      projectAlias: {},
      setSelectedAlias: (alias) => set({ selectedAlias: alias }),
      setProjectAlias: (projectId, alias) =>
        set((state) => ({
          projectAlias: { ...state.projectAlias, [projectId]: alias },
        })),
    }),
    { name: 'aion-model-store' }
  )
);
