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

// The desktop host seam (`createHost()`) reads `window.electronAPI` and
// `window.ipcRenderer`, so a renderer test that exercises a host call installs
// this pair on `window` first.

import { vi } from 'vitest';

export interface MockedElectronAPI {
  exportLog: ReturnType<typeof vi.fn>;
  getDiagnosticsInfo: ReturnType<typeof vi.fn>;
  exportDiagnosticsZip: ReturnType<typeof vi.fn>;
  openMailto: ReturnType<typeof vi.fn>;
  removeAllListeners: ReturnType<typeof vi.fn>;
  reset: () => void;
}

export interface MockedIpcRenderer {
  invoke: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  removeAllListeners: ReturnType<typeof vi.fn>;
}

export function createElectronAPIMock(): MockedElectronAPI {
  const electronAPI: MockedElectronAPI = {
    exportLog: vi
      .fn()
      .mockResolvedValue({ success: true, savedPath: '/mock/path/to/log.txt' }),

    getDiagnosticsInfo: vi.fn().mockResolvedValue({
      version: '1.0.0',
      platform: 'darwin',
      arch: 'arm64',
    }),

    exportDiagnosticsZip: vi
      .fn()
      .mockResolvedValue({ success: true, savedPath: '/mock/diagnostics.zip' }),

    openMailto: vi.fn().mockResolvedValue({ success: true }),

    removeAllListeners: vi.fn(),

    reset: () => {
      electronAPI.exportLog.mockClear();
      electronAPI.getDiagnosticsInfo.mockClear();
      electronAPI.exportDiagnosticsZip.mockClear();
      electronAPI.openMailto.mockClear();
      electronAPI.removeAllListeners.mockClear();
    },
  };

  return electronAPI;
}

export function createIpcRendererMock(): MockedIpcRenderer {
  return {
    invoke: vi
      .fn()
      .mockResolvedValue({ success: false, error: 'Unknown channel' }),
    on: vi.fn(),
    removeAllListeners: vi.fn(),
  };
}

export function setupElectronMocks() {
  const electronAPI = createElectronAPIMock();
  const ipcRenderer = createIpcRendererMock();

  Object.defineProperty(window, 'electronAPI', {
    value: electronAPI,
    writable: true,
  });

  Object.defineProperty(window, 'ipcRenderer', {
    value: ipcRenderer,
    writable: true,
  });

  return { electronAPI, ipcRenderer };
}
