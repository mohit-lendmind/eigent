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
 * Where a project's browser actions run: the sandbox pod (default) or a
 * visible window on this desktop. The choice rides each submitted command as
 * `browser_execution` and is immutable for that run once admitted — flipping
 * the toggle changes the NEXT run, never one in flight. Pure state, the
 * aionModelStore pattern: the bridge reads it at submit, the composer toggle
 * writes it, and the support probe (bridge-side — it needs the transport)
 * reports in via noteSupport.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type BrowserSessionMode = 'isolated' | 'logged_in';

interface AionLocalBrowserState {
  /** null until the support probe answers; the toggle hides until true. */
  supported: boolean | null;
  /** Per-Eigent-project choice; absent → pod execution. */
  projectLocalBrowser: Record<string, boolean>;
  /** Per-project session partition; absent → isolated. */
  projectSessionMode: Record<string, BrowserSessionMode>;
  /**
   * The choice made on a Space's composer before its Project exists (the
   * Project is only minted at first send). Consumed once by adoptSpaceChoice
   * so it seeds exactly the Project it was set up for, never a later one —
   * a stale logged-in opt-in silently riding a next week's project would be
   * an escalation, not a convenience.
   */
  spaceLocalBrowser: Record<string, boolean>;
  spaceSessionMode: Record<string, BrowserSessionMode>;
  setLocalBrowser: (projectId: string, enabled: boolean) => void;
  setSessionMode: (projectId: string, mode: BrowserSessionMode) => void;
  setSpaceLocalBrowser: (spaceId: string, enabled: boolean) => void;
  setSpaceSessionMode: (spaceId: string, mode: BrowserSessionMode) => void;
  /** Moves a Space's pending choice onto the Project just created from it. */
  adoptSpaceChoice: (spaceId: string, projectId: string) => void;
  noteSupport: (supported: boolean) => void;
}

export const useAionLocalBrowserStore = create<AionLocalBrowserState>()(
  persist(
    (set) => ({
      supported: null,
      projectLocalBrowser: {},
      projectSessionMode: {},
      spaceLocalBrowser: {},
      spaceSessionMode: {},
      setLocalBrowser: (projectId, enabled) =>
        set((state) => ({
          projectLocalBrowser: {
            ...state.projectLocalBrowser,
            [projectId]: enabled,
          },
        })),
      setSessionMode: (projectId, mode) =>
        set((state) => ({
          projectSessionMode: {
            ...state.projectSessionMode,
            [projectId]: mode,
          },
        })),
      setSpaceLocalBrowser: (spaceId, enabled) =>
        set((state) => ({
          spaceLocalBrowser: {
            ...state.spaceLocalBrowser,
            [spaceId]: enabled,
          },
        })),
      setSpaceSessionMode: (spaceId, mode) =>
        set((state) => ({
          spaceSessionMode: {
            ...state.spaceSessionMode,
            [spaceId]: mode,
          },
        })),
      adoptSpaceChoice: (spaceId, projectId) =>
        set((state) => {
          if (!(spaceId in state.spaceLocalBrowser)) return state;
          const spaceLocalBrowser = { ...state.spaceLocalBrowser };
          const spaceSessionMode = { ...state.spaceSessionMode };
          const enabled = spaceLocalBrowser[spaceId];
          const mode = spaceSessionMode[spaceId];
          delete spaceLocalBrowser[spaceId];
          delete spaceSessionMode[spaceId];
          return {
            ...state,
            spaceLocalBrowser,
            spaceSessionMode,
            projectLocalBrowser: {
              ...state.projectLocalBrowser,
              [projectId]: enabled,
            },
            ...(mode !== undefined
              ? {
                  projectSessionMode: {
                    ...state.projectSessionMode,
                    [projectId]: mode,
                  },
                }
              : {}),
          };
        }),
      noteSupport: (supported) => set({ supported }),
    }),
    {
      name: 'aion-local-browser-store',
      // Support is a fact about the current backend and build, never a
      // preference — re-probed each launch, so it must not persist.
      partialize: (state) => ({
        projectLocalBrowser: state.projectLocalBrowser,
        projectSessionMode: state.projectSessionMode,
        spaceLocalBrowser: state.spaceLocalBrowser,
        spaceSessionMode: state.spaceSessionMode,
      }),
    }
  )
);

/**
 * The submit-body fields the project's choice adds to one command. Empty when
 * the toggle is off or the backend/build cannot serve it — a persisted "on"
 * against a downgraded edge degrades to pod execution, matching the hidden
 * toggle the user would see. `browser_session_mode` rides only alongside
 * `local` (the contract 422s it otherwise) and only when non-default.
 */
export function browserSubmitFields(
  enabled: boolean | undefined,
  sessionMode: BrowserSessionMode | undefined,
  supported: boolean
): { browser_execution?: 'local'; browser_session_mode?: 'logged_in' } {
  if (!enabled || !supported) return {};
  return {
    browser_execution: 'local',
    ...(sessionMode === 'logged_in'
      ? { browser_session_mode: 'logged_in' as const }
      : {}),
  };
}
