// The Browser nav. The cookie jar was the local backend's — every button on it
// read or wrote `/browser/*` on the backend this fork removed — and is gone;
// CDP drives real Chrome instances over IPC and stays. A link to the retired
// section must still land on a screen.
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Browser from '@/pages/Browser';

const mocks = vi.hoisted(() => ({
  params: {} as Record<string, string>,
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
vi.mock('@/pages/Browser/Extension', () => ({
  default: () => <div data-testid="screen-extension" />,
}));

beforeEach(() => {
  mocks.params = {};
});

describe('Browser nav', () => {
  it('offers the sections this plane serves', () => {
    render(<Browser />);
    expect(screen.getByTestId('nav-cdp')).toBeTruthy();
    expect(screen.getByTestId('nav-extension')).toBeTruthy();
    expect(screen.queryByTestId('nav-cookies')).toBeNull();
  });

  it('resolves a link to the retired cookie jar onto a screen that exists', () => {
    mocks.params = { browserSection: 'cookies' };
    render(<Browser />);
    expect(screen.getByTestId('screen-cdp')).toBeTruthy();
    expect(screen.queryByTestId('screen-cookies')).toBeNull();
  });
});
