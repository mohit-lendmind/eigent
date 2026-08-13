// The skill row's usage line. Three display states, and which one a row gets
// depends on the provider as much as on the row: absent counters mean "never
// used" only where the provider counts, so a below-floor or local provider must
// render no usage affordance at all rather than claiming the skill is unused.
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import enUsAgents from '@/i18n/locales/en-us/agents.json';
import SkillListItem from '@/pages/Agents/components/SkillListItem';
import type { AionSkillsMode } from '@/store/aionSkillsStore';
import type { Skill } from '@/store/skillsStore';

// Resolved against the shipped en-us bundle, with {{token}} interpolation the
// global stub does not do: a string the component asks for but nobody
// translated then renders as its own key and fails the assertion below.
vi.mock('react-i18next', async () => {
  const agents = (
    await import('@/i18n/locales/en-us/agents.json')
  ).default as Record<string, string>;
  return {
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
    remoteMode: { kind: 'remote', usage: true } as AionSkillsMode,
    updateSkill: vi.fn(),
    toggleSkill: vi.fn(),
  },
}));

vi.mock('@/store/skillsStore', () => ({
  useSkillsStore: () => mocks.skillsState,
}));

vi.mock('@/hooks/useChatStoreAdapter', () => ({
  default: () => ({ projectStore: { createProject: vi.fn() } }),
}));

vi.mock('@/store/authStore', () => ({
  useWorkerList: () => [],
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

function renderRow(row: Skill) {
  return render(
    <MemoryRouter>
      <SkillListItem skill={row} />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  mocks.skillsState.remoteMode = { kind: 'remote', usage: true };
});

describe('SkillListItem usage line', () => {
  it('renders the counters and a relative last-used time', () => {
    // The counters are read against a pinned now: "2 hours ago" is the claim,
    // not whatever distance today happens to produce.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-12T11:30:00Z'));

    renderRow(
      skill({
        usage: {
          activations: 3,
          loads: 7,
          executions: 2,
          lastUsedAt: '2026-08-12T09:30:00Z',
        },
      })
    );

    const line = screen.getByTestId('skill-usage-release-notes');
    expect(line).toHaveTextContent('Auto: 3');
    expect(line).toHaveTextContent('Loaded: 7');
    expect(line).toHaveTextContent('Runs: 2');
    expect(line).toHaveTextContent('last used about 2 hours ago');
  });

  it('renders zero counters rather than hiding them', () => {
    // A recorded usage with a zero counter is data: the skill was loaded but
    // its script never ran, and hiding the 0 would read as "we did not count".
    renderRow(
      skill({
        usage: {
          activations: 0,
          loads: 4,
          executions: 0,
          lastUsedAt: '2026-08-12T09:30:00Z',
        },
      })
    );

    const line = screen.getByTestId('skill-usage-release-notes');
    expect(line).toHaveTextContent('Auto: 0');
    expect(line).toHaveTextContent('Runs: 0');
  });

  it('says never used when a counting provider returns a bare row', () => {
    renderRow(skill());

    expect(screen.getByTestId('skill-usage-release-notes')).toHaveTextContent(
      'Never used'
    );
  });

  it('shows nothing at all where the provider does not count', () => {
    // Same bare row as above. Below the usage floor, and in local mode, the
    // absence says nothing about the skill, so the row must not claim it does.
    for (const mode of [
      { kind: 'remote', usage: false },
      { kind: 'local' },
      { kind: 'unsupported', edgeApiVersion: '1.3.0' },
    ] as AionSkillsMode[]) {
      mocks.skillsState.remoteMode = mode;
      const { unmount } = renderRow(skill());
      expect(
        screen.queryByTestId('skill-usage-release-notes')
      ).not.toBeInTheDocument();
      unmount();
    }
  });

  it('translates every string the usage line asks for', () => {
    // The three hint strings live in tooltips that stay closed, so nothing
    // above would notice them going missing from the bundle.
    const agents = enUsAgents as Record<string, string>;
    for (const key of [
      'skill-never-used',
      'skill-usage-activations',
      'skill-usage-loads',
      'skill-usage-executions',
      'skill-usage-activations-hint',
      'skill-usage-loads-hint',
      'skill-usage-executions-hint',
      'skill-usage-last-used',
    ]) {
      expect(agents[key], key).toBeTruthy();
    }
  });
});
