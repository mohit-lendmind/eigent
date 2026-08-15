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

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useHost } from '@/host';
import CDP from '@/pages/Browser/CDP';
import { toast } from 'sonner';

vi.mock('@/host', () => ({
  useHost: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    loading: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string | number>) => {
      const translations: Record<string, string> = {
        'layout.cdp-browser-connection': 'CDP Browser Connection',
        'layout.cdp-browser-pool': 'CDP Browser Pool',
        'layout.cdp-desktop-only': 'Open Eigent on your desktop to add one.',
        'layout.open-new-browser': 'Open Blank Browser',
        'layout.connect-existing-browser': 'Connect Existing Browser',
        'layout.no-browsers-in-pool': 'No browsers in pool',
        'layout.add-browsers-hint': 'Add a browser to get started',
      };

      if (key === 'layout.launching-browser') {
        return `Launching browser on port ${options?.port ?? '...'}`;
      }

      if (key === 'layout.browser-launched') {
        return `Browser launched on port ${options?.port ?? ''}`.trim();
      }

      return translations[key] || key;
    },
  }),
}));

vi.mock('@/components/ui/alertDialog', () => ({
  default: () => null,
}));

describe('CDP Browser Page', () => {
  const mockUseHost = vi.mocked(useHost);
  const mockToast = vi.mocked(toast);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('launches a browser through the main process', async () => {
    const launchCdpBrowser = vi
      .fn()
      .mockResolvedValue({ success: true, port: 9222 });
    mockUseHost.mockReturnValue({
      electronAPI: {
        getCdpBrowsers: vi.fn().mockResolvedValue([]),
        launchCdpBrowser,
      },
    } as any);

    render(<CDP />);

    await userEvent.click(
      screen.getByRole('button', { name: /open blank browser/i })
    );

    await waitFor(() => {
      expect(launchCdpBrowser).toHaveBeenCalledTimes(1);
    });

    expect(mockToast.loading).toHaveBeenCalledWith(
      'Launching browser on port ...',
      { id: 'launch-browser' }
    );
    expect(mockToast.success).toHaveBeenCalledWith(
      'Browser launched on port 9222',
      { id: 'launch-browser' }
    );
  });

  // The Chrome processes and their debugging ports are held by the main
  // process. A browser tab has nothing to hold them, so the pool controls
  // must not be offered there at all.
  it('offers no pool controls when the main process is absent', () => {
    mockUseHost.mockReturnValue(null);

    render(<CDP />);

    expect(screen.getByTestId('cdp-desktop-only')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: /open blank browser/i })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: /connect existing browser/i })
    ).toBeNull();
  });
});
