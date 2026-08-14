// The Browser nav in aion mode. The cookie jar is the local backend's — every
// button on that screen reads or writes `/browser/*` on the backend this fork
// removed — while the CDP screen drives real Chrome instances over IPC and
// stays on both planes.
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Browser from '@/pages/Browser';

const mocks = vi.hoisted(() => ({
  config: null as unknown,
  params: {} as Record<string, string>,
}));

vi.mock('@/store/aionChatBridge', () => ({
  getAionRemoteConfig: () => Promise.resolve(mocks.config),
}));

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(mocks.params), vi.fn()],
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/components/Dashboard/VerticalNav', () => ({
  default: ({ items }: { items: { value: string }[] }) => (
    <div>
      {items.map((item) => (
        <span key={item.value} data-testid={`nav-${item.value}`} />
      ))}
    </div>
  ),
  HISTORY_VERTICAL_SIDEBAR_CLASSNAME: '',
}));

vi.mock('@/pages/Browser/CDP', () => ({
  default: () => <div data-testid="screen-cdp" />,
}));
vi.mock('@/pages/Browser/Cookies', () => ({
  default: () => <div data-testid="screen-cookies" />,
}));
vi.mock('@/pages/Browser/Extension', () => ({
  default: () => <div data-testid="screen-extension" />,
}));

beforeEach(() => {
  mocks.config = null;
  mocks.params = {};
});

describe('Browser nav gating', () => {
  it('offers the cookie jar on the legacy plane', async () => {
    render(<Browser />);
    await waitFor(() => expect(screen.getByTestId('nav-cookies')).toBeTruthy());
  });

  it('hides the cookie jar in aion mode but keeps CDP', async () => {
    mocks.config = { edgeBaseUrl: 'http://edge.test', apiKey: 'k' };
    render(<Browser />);
    await waitFor(() => expect(screen.getByTestId('nav-cdp')).toBeTruthy());
    expect(screen.queryByTestId('nav-cookies')).toBeNull();
    expect(screen.getByTestId('screen-cdp')).toBeTruthy();
  });

  it('refuses a deep link to the cookie jar in aion mode', async () => {
    mocks.config = { edgeBaseUrl: 'http://edge.test', apiKey: 'k' };
    mocks.params = { browserSection: 'cookies' };
    render(<Browser />);
    await waitFor(() => expect(screen.getByTestId('screen-cdp')).toBeTruthy());
    expect(screen.queryByTestId('screen-cookies')).toBeNull();
  });
});
