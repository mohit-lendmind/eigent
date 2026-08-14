// The Home Projects section switches on the aion mode. The two lists read
// different planes — the legacy body reads Eigent's hosted cloud, the aion body
// reads the edge — so the branch decides which plane the user is looking at, and
// an unusable remote mode must say so instead of falling back to a plane that
// cannot hold the answer.
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import Projects from '@/pages/Home/Projects';
import type { AionProject, AionProjectsMode } from '@/store/aionProjectsStore';

// Resolved against the shipped en-us bundles with {{token}} interpolation, so a
// key nobody translated renders as its own key and fails the assertion.
vi.mock('react-i18next', async () => {
  const layout = (await import('@/i18n/locales/en-us/layout.json'))
    .default as Record<string, string>;
  const dashboard = (await import('@/i18n/locales/en-us/dashboard.json'))
    .default as Record<string, string>;
  const namespaces: Record<string, Record<string, string>> = {
    layout,
    dashboard,
  };
  return {
    // The legacy body's import graph reaches src/i18n, which initialises the
    // real instance; the stub below is what keeps that import side-effect free.
    initReactI18next: { type: '3rdParty', init: () => {} },
    useTranslation: () => ({
      t: (key: string, options?: Record<string, string | number>) => {
        const [namespace, ...rest] = key.split('.');
        const value = namespaces[namespace]?.[rest.join('.')];
        if (value === undefined) return key;
        return value.replace(/\{\{(\w+)\}\}/g, (_match, token: string) =>
          String(options?.[token] ?? '')
        );
      },
    }),
  };
});

const mocks = vi.hoisted(() => ({
  hub: {} as Record<string, unknown>,
}));

vi.mock('@/pages/Home/context', () => ({
  useHomeHub: () => mocks.hub,
}));

vi.mock('@/pages/Home/hooks/useSpaceLabel', () => ({
  useSpaceLabel: () => '',
}));

function project(overrides: Partial<AionProject> = {}): AionProject {
  return {
    projectId: 'prj_01JY0000000000000000000001',
    title: 'Investigate the build failure',
    modelAlias: 'coding_balanced',
    status: 'active',
    createdAt: Date.parse('2026-08-08T09:00:00Z'),
    updatedAt: Date.now() - 60_000,
    lastSequence: '42',
    ...overrides,
  };
}

function renderWith(
  mode: AionProjectsMode | null,
  overrides: {
    projects?: AionProject[];
    nextPageToken?: string;
    loading?: boolean;
    error?: string | null;
    loadMore?: () => void;
  } = {}
) {
  mocks.hub = {
    viewMode: 'list',
    searchQuery: '',
    sortBy: 'updated',
    sortDirection: 'desc',
    projects: [],
    projectsLoading: false,
    chatTasks: {},
    onProjectDelete: vi.fn(),
    onProjectRename: vi.fn(),
    aionProjects: {
      mode,
      projects: overrides.projects ?? [],
      nextPageToken: overrides.nextPageToken,
      loading: overrides.loading ?? false,
      loadingMore: false,
      error: overrides.error ?? null,
      loadMore: overrides.loadMore ?? vi.fn(),
      reload: vi.fn(),
    },
  };
  return render(<Projects />);
}

describe('Home Projects mode branch', () => {
  it('waits for the negotiation instead of showing either plane', () => {
    renderWith(null);
    expect(screen.queryByTestId('aion-projects')).toBeNull();
    // The legacy empty state is the tell that the hosted-cloud body rendered.
    expect(screen.queryByText('No projects found.')).toBeNull();
  });

  it('renders the legacy hosted-cloud body in local mode', () => {
    renderWith({ kind: 'local' });
    expect(screen.getByText('No projects found.')).toBeTruthy();
    expect(screen.queryByTestId('aion-projects')).toBeNull();
  });

  it('renders edge rows in remote mode', () => {
    renderWith({ kind: 'remote' }, {
      projects: [
        project(),
        project({
          projectId: 'prj_01JY0000000000000000000002',
          title: 'Summarize the incident review',
          modelAlias: 'reasoning_deep',
          status: 'closed',
        }),
      ],
    });

    expect(screen.getAllByTestId('aion-project-row')).toHaveLength(2);
    expect(screen.getByText('Investigate the build failure')).toBeTruthy();
    expect(screen.getByText('coding_balanced')).toBeTruthy();
    // A Project with nothing in flight is idle, not running: the status column
    // reports the active run only when there is one.
    expect(screen.getByText('Idle')).toBeTruthy();
    expect(screen.getByText('Closed')).toBeTruthy();
    expect(screen.queryByText('No projects found.')).toBeNull();
  });

  it('reports the active run over the project status', () => {
    renderWith({ kind: 'remote' }, {
      projects: [
        project({
          activeRun: { runId: 'run_1', runEpoch: '3', status: 'running' },
        }),
      ],
    });
    expect(screen.getByText('Running')).toBeTruthy();
    expect(screen.queryByText('Idle')).toBeNull();
  });

  it('offers more only while the edge has a continuation token', () => {
    const loadMore = vi.fn();
    renderWith({ kind: 'remote' }, { projects: [project()], loadMore });
    expect(screen.queryByTestId('aion-projects-load-more')).toBeNull();

    renderWith(
      { kind: 'remote' },
      { projects: [project()], nextPageToken: 'page-2', loadMore }
    );
    screen.getByTestId('aion-projects-load-more').click();
    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it('names the version a too-old backend reported', () => {
    renderWith({ kind: 'unsupported', edgeApiVersion: '1.5.0' });
    const banner = screen.getByTestId('aion-projects-banner');
    expect(banner.textContent).toContain('edge API 1.5.0');
    // Not the empty state — the desktop cannot tell whether there are projects.
    expect(screen.queryByText('No projects found.')).toBeNull();
  });

  it('shows a remote error rather than degrading to the legacy plane', () => {
    renderWith({ kind: 'error', message: 'edge unreachable' });
    expect(
      screen.getByTestId('aion-projects-banner').textContent
    ).toContain('edge unreachable');
    expect(screen.queryByText('No projects found.')).toBeNull();
  });

  it('keeps loaded rows when extending the list fails', () => {
    renderWith(
      { kind: 'remote' },
      { projects: [project()], error: 'edge returned 503' }
    );
    expect(screen.getAllByTestId('aion-project-row')).toHaveLength(1);
    expect(screen.getByRole('alert').textContent).toContain('edge returned 503');
  });
});
