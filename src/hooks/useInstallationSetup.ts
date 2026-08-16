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

import { useHost } from '@/host';
import { useAuthStore } from '@/store/authStore';
import { useInstallationStore } from '@/store/installationStore';
import { getSkillsStore } from '@/store/skillsStore';
import { useCallback, useEffect, useRef } from 'react';

/**
 * Sets up the desktop readiness listeners and keeps startup state in sync.
 * On the desktop the aion edge configuration decides readiness; in Web mode
 * (no Electron) Brain health at VITE_BRAIN_ENDPOINT is polled instead.
 */
export const useInstallationSetup = () => {
  const host = useHost();
  const { setInitState, email, user_id } = useAuthStore();

  const hasCheckedOnMount = useRef(false);
  const backendReady = useRef(false);
  const syncedSkillsKey = useRef<string | null>(null);
  const setSuccess = useInstallationStore((state) => state.setSuccess);
  const setBackendError = useInstallationStore(
    (state) => state.setBackendError
  );
  const setWaitingBackend = useInstallationStore(
    (state) => state.setWaitingBackend
  );
  const needsBackendRestart = useInstallationStore(
    (state) => state.needsBackendRestart
  );
  const setNeedsBackendRestart = useInstallationStore(
    (state) => state.setNeedsBackendRestart
  );

  // Warm the skills list once per signed-in user, so the first visit to the
  // Skills screen — or a composer picker opened before it — already has rows.
  const syncSkillsOnOpen = useCallback(async () => {
    const currentAuth = useAuthStore.getState();
    if (currentAuth.user_id === null || currentAuth.user_id === undefined) {
      return;
    }

    const syncKey = String(currentAuth.user_id);
    if (syncedSkillsKey.current === syncKey) return;

    try {
      await getSkillsStore().refresh();
      syncedSkillsKey.current = syncKey;
    } catch (error) {
      console.warn(
        '[useInstallationSetup] Failed to load skills on open:',
        error
      );
    }
  }, []);

  const markReady = useCallback(() => {
    backendReady.current = true;
    setSuccess();
    setInitState('done');
    setNeedsBackendRestart(false);
  }, [setSuccess, setInitState, setNeedsBackendRestart]);

  const startBackendPolling = useCallback(() => {
    console.log('[useInstallationSetup] Starting backend polling');

    // Desktop: the main process validated the edge endpoint at startup;
    // reachability is the aion session layer's concern, not a readiness gate.
    // The one-shot backend-ready event can race the listener mount, so this
    // poll is the recovery path.
    const doCheck = async (): Promise<boolean> => {
      try {
        const transportConfig =
          await host?.electronAPI?.getAionTransportConfig?.();
        if (transportConfig?.mode === 'remote') {
          if ('error' in transportConfig) {
            console.error(
              '[useInstallationSetup] Backend config invalid:',
              transportConfig.error
            );
            return false;
          }
          markReady();
          return true;
        }
      } catch (e) {
        console.log('[useInstallationSetup] Edge config check failed:', e);
      }
      return false;
    };

    doCheck().then((isReady) => {
      if (isReady) {
        console.log('[useInstallationSetup] Backend ready, skipping polling');
        return;
      }
      console.log('[useInstallationSetup] Backend not ready, starting polling');
      const pollInterval = setInterval(() => {
        doCheck().then((ready) => {
          if (ready) clearInterval(pollInterval);
        });
      }, 2000);
      setTimeout(() => clearInterval(pollInterval), 30000);
    });
  }, [markReady, host]);

  // Monitor for backend restart after logout
  useEffect(() => {
    // When user logs in after logout, needsBackendRestart will be true
    if (needsBackendRestart && email !== null) {
      console.log(
        '[useInstallationSetup] Detected login after logout, waiting for backend'
      );
      backendReady.current = false;
      setWaitingBackend();
      startBackendPolling();
    }
  }, [needsBackendRestart, email, setWaitingBackend, startBackendPolling]);

  useEffect(() => {
    if (backendReady.current && user_id !== null && user_id !== undefined) {
      void syncSkillsOnOpen();
    }
  }, [user_id, syncSkillsOnOpen]);

  useEffect(() => {
    if (hasCheckedOnMount.current) {
      return;
    }
    hasCheckedOnMount.current = true;
    setWaitingBackend();
    startBackendPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleBackendReady = (data: {
      success: boolean;
      port?: number | null;
      remote?: boolean;
      error?: string;
    }) => {
      console.log('[useInstallationSetup] Backend ready event received:', data);

      if (data.success) {
        // Ready without a localhost endpoint: the aion boundary gets its
        // transport config via getAionTransportConfig.
        markReady();
        return;
      }

      console.error(
        '[useInstallationSetup] Backend failed to start:',
        data.error
      );
      setBackendError(data.error || 'Backend startup failed');
    };

    if (!host?.electronAPI) return;

    host.electronAPI.onBackendReady(handleBackendReady);

    return () => {
      host.electronAPI.removeAllListeners('backend-ready');
    };
  }, [host, markReady, setBackendError]);
};
