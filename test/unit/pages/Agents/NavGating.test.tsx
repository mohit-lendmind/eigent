// The Agents nav in aion mode. Models and Sub-agents configure providers
// through the legacy plane and validate them against the backend this fork
// removed, so on an aion stack they must be unreachable — including by the URL
// a bookmark or a deep link supplies.
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Agents from '@/pages/Agents';

const mocks = vi.hoisted(() => ({
  config: null as unknown,
  section: null as string | null,
}));

vi.mock('@/store/aionChatBridge', () => ({
  // The hook under test caches nothing itself; the bridge does, and it is
  // module-scoped, so the mock is what makes each mode independently testable.
  getAionRemoteConfig: () => Promise.resolve(mocks.config),
}));

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams({ section: mocks.section ?? '' })],
  useNavigate: () => vi.fn(),
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

// Stubs, not the real screens: Models alone reaches thousands of lines of
// provider-form code that has nothing to do with which entries are offered.
vi.mock('@/pages/Agents/Models', () => ({
  default: () => <div data-testid="screen-models" />,
}));
vi.mock('@/pages/Agents/Skills', () => ({
  default: () => <div data-testid="screen-skills" />,
}));
vi.mock('@/pages/Agents/SubAgents', () => ({
  default: () => <div data-testid="screen-sub-agents" />,
}));
vi.mock('@/pages/Agents/Memory', () => ({
  default: () => <div data-testid="screen-memory" />,
}));

beforeEach(() => {
  mocks.config = null;
  mocks.section = null;
});

describe('Agents nav gating', () => {
  it('offers every section on the legacy plane', async () => {
    render(<Agents />);
    await waitFor(() => expect(screen.getByTestId('nav-models')).toBeTruthy());
    expect(screen.getByTestId('nav-sub-agents')).toBeTruthy();
    expect(screen.getByTestId('screen-models')).toBeTruthy();
  });

  it('hides the legacy-only sections in aion mode', async () => {
    mocks.config = { edgeBaseUrl: 'http://edge.test', apiKey: 'k' };
    render(<Agents />);
    await waitFor(() => expect(screen.getByTestId('nav-skills')).toBeTruthy());
    expect(screen.queryByTestId('nav-models')).toBeNull();
    expect(screen.queryByTestId('nav-sub-agents')).toBeNull();
    expect(screen.getByTestId('nav-memory')).toBeTruthy();
  });

  it('refuses a deep link to a hidden section', async () => {
    mocks.config = { edgeBaseUrl: 'http://edge.test', apiKey: 'k' };
    mocks.section = 'models';
    render(<Agents />);
    // The screen never renders, and the fallback is a section this plane serves
    // rather than a blank pane.
    await waitFor(() => expect(screen.getByTestId('screen-skills')).toBeTruthy());
    expect(screen.queryByTestId('screen-models')).toBeNull();
  });

  it('renders no legacy-only screen before the mode is known', async () => {
    mocks.config = { edgeBaseUrl: 'http://edge.test', apiKey: 'k' };
    mocks.section = 'models';
    render(<Agents />);
    // Synchronous first paint: the IPC has not answered yet, so a screen that
    // only one plane can serve must not be on screen at all.
    expect(screen.queryByTestId('screen-models')).toBeNull();
    expect(screen.queryByTestId('screen-skills')).toBeNull();
    // Let the resolution land inside act so the pending update is not reported
    // against whichever test runs next.
    await waitFor(() => expect(screen.getByTestId('screen-skills')).toBeTruthy());
  });
});
