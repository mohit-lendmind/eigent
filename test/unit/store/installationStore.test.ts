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

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useInstallationStore,
  useInstallationUI,
  type InstallationState,
} from '../../../src/store/installationStore';
import {
  setupElectronMocks,
  type MockedElectronAPI,
} from '../../mocks/electronMocks';

describe('Installation Store', () => {
  let electronAPI: MockedElectronAPI;

  beforeEach(() => {
    electronAPI = setupElectronMocks().electronAPI;
    useInstallationStore.getState().reset();
  });

  afterEach(() => {
    vi.clearAllMocks();
    electronAPI.reset();
  });

  describe('Initial State', () => {
    it('starts idle and hidden, with the backend not yet ready', () => {
      const { result } = renderHook(() => useInstallationStore());

      expect(result.current.state).toBe('idle');
      expect(result.current.progress).toBe(20);
      expect(result.current.backendError).toBeUndefined();
      expect(result.current.isVisible).toBe(false);
      expect(result.current.isBackendReady).toBe(false);
      expect(result.current.needsBackendRestart).toBe(false);
    });
  });

  describe('State Transitions', () => {
    it('shows the readiness screen while waiting on the backend', () => {
      const { result } = renderHook(() => useInstallationStore());

      act(() => {
        result.current.setWaitingBackend();
      });

      expect(result.current.state).toBe('waiting-backend');
      expect(result.current.progress).toBe(80);
      expect(result.current.isVisible).toBe(true);
      expect(result.current.isBackendReady).toBe(false);
    });

    it('completes and marks the backend ready on success', () => {
      const { result } = renderHook(() => useInstallationStore());

      act(() => {
        result.current.setWaitingBackend();
      });

      act(() => {
        result.current.setSuccess();
      });

      expect(result.current.state).toBe('completed');
      expect(result.current.progress).toBe(100);
      expect(result.current.isBackendReady).toBe(true);
    });

    it('records the backend error and drops readiness', () => {
      const { result } = renderHook(() => useInstallationStore());
      const message = 'Backend configuration is invalid: no backend configured';

      act(() => {
        result.current.setWaitingBackend();
      });

      act(() => {
        result.current.setBackendError(message);
      });

      expect(result.current.state).toBe('error');
      expect(result.current.backendError).toBe(message);
      expect(result.current.isBackendReady).toBe(false);
    });

    it('tracks the post-logout restart flag independently of readiness', () => {
      const { result } = renderHook(() => useInstallationStore());

      act(() => {
        result.current.setNeedsBackendRestart(true);
      });

      expect(result.current.needsBackendRestart).toBe(true);
      expect(result.current.state).toBe('idle');

      act(() => {
        result.current.setNeedsBackendRestart(false);
      });

      expect(result.current.needsBackendRestart).toBe(false);
    });

    it('recovers to completed when a late ready event follows an error', () => {
      const { result } = renderHook(() => useInstallationStore());

      act(() => {
        result.current.setWaitingBackend();
        result.current.setBackendError('transient');
        result.current.setSuccess();
      });

      expect(result.current.state).toBe('completed');
      expect(result.current.progress).toBe(100);
      expect(result.current.isBackendReady).toBe(true);
    });

    it('hides the readiness screen when setup completes', () => {
      const { result } = renderHook(() => useInstallationStore());

      act(() => {
        result.current.setVisible(true);
      });

      expect(result.current.isVisible).toBe(true);

      act(() => {
        result.current.completeSetup();
      });

      expect(result.current.state).toBe('completed');
      expect(result.current.isVisible).toBe(false);
    });

    it('accepts manual progress updates', () => {
      const { result } = renderHook(() => useInstallationStore());

      act(() => {
        result.current.updateProgress(75);
      });

      expect(result.current.progress).toBe(75);
    });

    it('follows idle -> waiting-backend -> completed on a clean launch', () => {
      const { result } = renderHook(() => useInstallationStore());
      const states: InstallationState[] = [];
      const unsubscribe = useInstallationStore.subscribe((s) =>
        states.push(s.state)
      );

      act(() => {
        result.current.setWaitingBackend();
        result.current.setSuccess();
      });

      unsubscribe();
      expect(states).toEqual(['waiting-backend', 'completed']);
    });
  });

  describe('Log Export', () => {
    it('opens the issue form after the log is saved', async () => {
      const { result } = renderHook(() => useInstallationStore());

      const originalLocation = window.location;
      Object.defineProperty(window, 'location', {
        value: { href: '' },
        writable: true,
      });
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

      await act(async () => {
        await result.current.exportLog();
      });

      expect(electronAPI.exportLog).toHaveBeenCalled();
      expect(alertSpy).toHaveBeenCalledWith('Log saved: /mock/path/to/log.txt');
      expect(window.location.href).toBe(
        'https://github.com/eigent-ai/eigent/issues/new/choose'
      );

      Object.defineProperty(window, 'location', {
        value: originalLocation,
        writable: true,
      });
      alertSpy.mockRestore();
    });

    it('reports a cancelled or failed export', async () => {
      electronAPI.exportLog.mockResolvedValue({
        success: false,
        error: 'Export failed',
      });

      const { result } = renderHook(() => useInstallationStore());
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

      await act(async () => {
        await result.current.exportLog();
      });

      expect(alertSpy).toHaveBeenCalledWith('Export cancelled: Export failed');
      alertSpy.mockRestore();
    });
  });

  describe('useInstallationUI', () => {
    it('shows the readiness screen only while it is visible and unfinished', () => {
      const { result: store } = renderHook(() => useInstallationStore());
      const { result: ui } = renderHook(() => useInstallationUI());

      expect(ui.current.installationState).toBe('idle');
      expect(ui.current.shouldShowInstallScreen).toBe(false);
      expect(ui.current.isBackendReady).toBe(false);

      act(() => {
        store.current.setWaitingBackend();
      });

      expect(ui.current.shouldShowInstallScreen).toBe(true);
      expect(ui.current.progress).toBe(80);

      act(() => {
        store.current.setBackendError('unreachable edge');
      });

      expect(ui.current.backendError).toBe('unreachable edge');
      expect(ui.current.shouldShowInstallScreen).toBe(true);

      act(() => {
        store.current.setSuccess();
      });

      expect(ui.current.isBackendReady).toBe(true);
      expect(ui.current.shouldShowInstallScreen).toBe(false);
    });
  });
});
