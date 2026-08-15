// A skill row holds interaction state of its own — the scope popover is open
// or closed per row, and nothing above the row knows. So the list must keep
// each row at a stable position in a stable tree: the moment the first sync
// settles is the moment someone is most likely mid-interaction, and a tree
// that changes shape there remounts every row and silently closes what they
// opened.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Skills from '@/pages/Agents/Skills';
import type { AionSkillsMode } from '@/store/aionSkillsStore';
import type { Skill } from '@/store/skillsStore';

vi.mock('react-i18next', async () => {
  const agents = (
    await import('@/i18n/locales/en-us/agents.json')
  ).default as Record<string, string>;
  return {
    // src/i18n registers the plugin at import time, so the mock has to be a
    // usable i18next plugin and not only a useTranslation stand-in.
    initReactI18next: { type: '3rdParty', init: () => {} },
    useTranslation: () => ({
      t: (key: string, options?: Record<string, string | number>) => {
        const value = key.startsWith('agents.')
          ? agents[key.slice('agents.'.length)]
          : undefined;
        if (value === undefined) return key;
        return value.replace(/\{\{(\w+)\}\}/g, (_match, token: string) =>
          String(options?.[token] ?? '')
        );
      },
    }),
  };
});

const mocks = vi.hoisted(() => ({
  skillsState: {
    skills: [] as Skill[],
    refresh: vi.fn(),
    remoteMode: { kind: 'remote', usage: true } as AionSkillsMode,
    updateSkill: vi.fn(),
    toggleSkill: vi.fn(),
  },
}));

vi.mock('@/store/skillsStore', () => ({
  useSkillsStore: () => mocks.skillsState,
}));

// Only the sync-up snapshot is stubbed — the mode predicates the rows read are
// pure and stay real, so a row here renders what a row renders.
vi.mock('@/store/aionSkillsStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/aionSkillsStore')>()),
  getAionSyncUpCandidates: () => [],
  clearAionSyncUpSnapshot: vi.fn(),
}));

vi.mock('@/hooks/useChatStoreAdapter', () => ({
  default: () => ({ projectStore: { createProject: vi.fn() } }),
}));

// getAuthStore is read at import time by src/i18n, which the dialog tree pulls
// in transitively — a worker-list-only mock breaks the module graph, not a test.
vi.mock('@/store/authStore', () => ({
  useWorkerList: () => [],
  getAuthStore: () => ({ language: 'en' }),
}));

function skill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 'skl_release_notes',
    name: 'release-notes',
    description: 'Draft release notes from a changelog.',
    filePath: '',
    fileContent: '',
    addedAt: 0,
    scope: { isGlobal: true, selectedAgents: [] },
    enabled: true,
    isExample: false,
    ...overrides,
  };
}

// The one-time sync-up offer reads Web Storage on the same settle this test
// drives, and bare `localStorage` resolves to Node's own implementation on
// Node >= 23 rather than jsdom's. Own the storage here so the assertion below
// is about the row, not about which Node ran the suite.
const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, value),
  removeItem: (key: string) => void storage.delete(key),
  clear: () => storage.clear(),
});

beforeEach(() => {
  vi.clearAllMocks();
  storage.clear();
  mocks.skillsState.skills = [skill()];
  mocks.skillsState.remoteMode = { kind: 'remote', usage: true };
});

describe('Skills list row identity', () => {
  it('keeps an open scope popover across the initial-sync settle', async () => {
    // The sync is held open so the popover can be opened while the list is
    // still in its pre-sync render, then released underneath it.
    let settleSync = () => {};
    mocks.skillsState.refresh.mockReturnValue(
      new Promise<void>((resolve) => {
        settleSync = resolve;
      })
    );

    render(
      <MemoryRouter>
        <Skills />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByText('Select agent access'));
    const row = screen.getByTestId('skill-row-release-notes');
    const panel = screen.getByTestId('skill-scope-release-notes');

    // Resolving inside act runs the .finally that flips the flag AND the render
    // it schedules, so the assertions below read the settled tree rather than
    // racing it — a waitFor here would pass before the flip ever happened.
    await act(async () => {
      settleSync();
    });

    // Same nodes, not merely nodes that look alike: a remounted row would
    // satisfy any query for the row and still have dropped the open panel.
    expect(screen.getByTestId('skill-row-release-notes')).toBe(row);
    expect(screen.getByTestId('skill-scope-release-notes')).toBe(panel);
  });
});
