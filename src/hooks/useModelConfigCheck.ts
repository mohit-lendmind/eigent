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

import { getAionRemoteConfig } from '@/store/aionChatBridge';
import { useAuthStore } from '@/store/authStore';
import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Centralized model-configuration check.
 *
 * Reads the last known result from the persisted auth store so returning
 * users get the correct UI on first paint (no overlay flash). Re-validates
 * silently in the background on mount, when the route returns to `/`, and
 * when the window regains focus.
 */
export function useModelConfigCheck(): {
  hasModel: boolean;
  isConfigLoaded: boolean;
} {
  const hasModel = useAuthStore((s) => s.hasModelConfigured);
  const setHasModelConfigured = useAuthStore((s) => s.setHasModelConfigured);
  const location = useLocation();
  // Session-only: true once the first check has completed at least once,
  // used by callers that need to wait for a fresh validation (e.g. share
  // token handling) rather than trusting the persisted optimistic value.
  const [isConfigLoaded, setIsConfigLoaded] = useState(false);

  // Models are aion edge aliases: a reachable backend with a working key is
  // the whole configuration. A backend that reports an error keeps the
  // composer locked so onboarding is the visible next step.
  const checkModelConfig = useCallback(async () => {
    try {
      const remote = await getAionRemoteConfig();
      setHasModelConfigured(Boolean(remote) && !('error' in remote!));
    } catch (err) {
      console.error('Failed to check model config:', err);
      setHasModelConfigured(false);
    } finally {
      setIsConfigLoaded(true);
    }
  }, [setHasModelConfigured]);

  useEffect(() => {
    checkModelConfig();
  }, [checkModelConfig]);

  useEffect(() => {
    if (location.pathname === '/') {
      checkModelConfig();
    }
  }, [location.pathname, checkModelConfig]);

  useEffect(() => {
    const handleFocus = () => {
      checkModelConfig();
    };
    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, [checkModelConfig]);

  return { hasModel, isConfigLoaded };
}
