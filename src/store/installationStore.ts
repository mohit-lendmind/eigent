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

import { createHost } from '@/host';
import {
  recordAppLaunchFailed,
  recordOnboardingStepCompleted,
} from '@/lib/events/appEvents';
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

// Startup states the readiness screen can be in.
export type InstallationState =
  | 'idle'
  | 'checking-permissions'
  | 'showing-carousel'
  | 'waiting-backend'
  | 'error'
  | 'completed';

interface InstallationStoreState {
  // Core state
  state: InstallationState;
  progress: number;
  backendError?: string;
  isVisible: boolean;
  isBackendReady: boolean; // Non-persisted, defaults to false on each app launch
  needsBackendRestart: boolean; // Flag to indicate backend is restarting after logout

  // Actions
  setSuccess: () => void;
  setBackendError: (error: string) => void;
  setWaitingBackend: () => void;
  setNeedsBackendRestart: (needs: boolean) => void;
  completeSetup: () => void;
  updateProgress: (progress: number) => void;
  setVisible: (visible: boolean) => void;
  reset: () => void;

  // Async actions
  exportLog: () => Promise<void>;
}

// Initial state
const initialState = {
  state: 'idle' as InstallationState,
  progress: 20,
  backendError: undefined,
  isVisible: false,
  isBackendReady: false,
  needsBackendRestart: false,
};

const getElectronAPI = () => createHost().electronAPI;

// Create the installation store
export const useInstallationStore = create<InstallationStoreState>()(
  subscribeWithSelector((set) => ({
    // Initial state
    ...initialState,

    setSuccess: () =>
      set({
        state: 'completed',
        progress: 100,
        isBackendReady: true,
      }),

    setWaitingBackend: () =>
      set({
        state: 'waiting-backend',
        progress: 80,
        isBackendReady: false,
        isVisible: true,
      }),

    setNeedsBackendRestart: (needs: boolean) =>
      set({
        needsBackendRestart: needs,
      }),

    setBackendError: (error: string) =>
      set({
        backendError: error,
        state: 'error',
        isBackendReady: false,
      }),

    completeSetup: () =>
      set({
        state: 'completed',
        isVisible: false,
      }),

    updateProgress: (progress: number) => set({ progress }),

    setVisible: (visible: boolean) => set({ isVisible: visible }),

    reset: () => set(initialState),

    exportLog: async () => {
      const electronAPI = getElectronAPI();
      if (!electronAPI?.exportLog) return;
      try {
        const response = await electronAPI.exportLog();

        if (!response.success) {
          alert('Export cancelled: ' + response.error);
          return;
        }

        if (response.savedPath) {
          window.location.href =
            'https://github.com/eigent-ai/eigent/issues/new/choose';
          alert('Log saved: ' + response.savedPath);
        }
      } catch (e: any) {
        alert('Export error: ' + e.message);
      }
    },
  }))
);

// Analytics: one subscription tracks the startup lifecycle so we don't have to
// instrument every individual setter. Progress phases feed the onboarding
// funnel; an `error` phase is also reported as `app_launch_failed`.
useInstallationStore.subscribe(
  (s) => s.state,
  (state, prevState) => {
    if (state === prevState || state === 'idle') return;
    if (state === 'error') {
      recordAppLaunchFailed('startup_error');
      return;
    }
    recordOnboardingStepCompleted({
      step_id: `startup:${state}`,
      phase: 'startup',
    });
  }
);

// Hook for the startup/readiness UI
export const useInstallationUI = () => {
  const state = useInstallationStore((state) => state.state);
  const progress = useInstallationStore((state) => state.progress);
  const backendError = useInstallationStore((state) => state.backendError);
  const isVisible = useInstallationStore((state) => state.isVisible);
  const isBackendReady = useInstallationStore((state) => state.isBackendReady);
  const exportLog = useInstallationStore((state) => state.exportLog);

  return {
    installationState: state,
    progress,
    backendError,
    isBackendReady,
    shouldShowInstallScreen: isVisible && state !== 'completed',
    exportLog,
  };
};
