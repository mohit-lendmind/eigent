// The Agents nav. Models and Sub-agents configured providers through the legacy
// plane and validated them against the backend this fork removed; both screens
// are gone, so what is worth pinning is that the URLs which used to reach them
// still resolve to a section this plane serves rather than to a blank pane.
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Agents from '@/pages/Agents';

const mocks = vi.hoisted(() => ({
  section: null as string | null,
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

vi.mock('@/pages/Agents/Skills', () => ({
  default: () => <div data-testid="screen-skills" />,
}));
vi.mock('@/pages/Agents/Memory', () => ({
  default: () => <div data-testid="screen-memory" />,
}));

beforeEach(() => {
  mocks.section = null;
});

describe('Agents nav', () => {
  it('offers the sections this plane serves', () => {
    render(<Agents />);
    expect(screen.getByTestId('nav-skills')).toBeTruthy();
    expect(screen.getByTestId('nav-memory')).toBeTruthy();
    expect(screen.queryByTestId('nav-models')).toBeNull();
    expect(screen.queryByTestId('nav-sub-agents')).toBeNull();
  });

  it('resolves a link to a retired section rather than blanking the pane', () => {
    mocks.section = 'models';
    render(<Agents />);
    // A bookmark from before the screens were retired still lands somewhere.
    expect(screen.getByTestId('screen-skills')).toBeTruthy();
  });

  it('honours a link to a section that is still here', () => {
    mocks.section = 'memory';
    render(<Agents />);
    expect(screen.getByTestId('screen-memory')).toBeTruthy();
    expect(screen.queryByTestId('screen-skills')).toBeNull();
  });
});
