// The drawer under a Project row. What it must never do is report an empty
// Project: below the listing floor, and while the listing is still in flight,
// "produced nothing" and "cannot see" are different answers and only one of them
// is honest. The version suffix is the second rule — it earns its place only
// where a name repeats, which is exactly when a name stops identifying a row.
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import AionProjectArtifacts from '@/pages/Home/components/AionProjectArtifacts';
import type {
  AionArtifact,
  AionArtifactsMode,
} from '@/store/aionArtifactsStore';

// Resolved against the shipped en-us bundle with {{token}} interpolation, so a
// key nobody translated renders as its own key and fails the assertion.
vi.mock('react-i18next', async () => {
  const layout = (await import('@/i18n/locales/en-us/layout.json'))
    .default as Record<string, string>;
  return {
    initReactI18next: { type: '3rdParty', init: () => {} },
    useTranslation: () => ({
      t: (key: string, options?: Record<string, string | number>) => {
        const value = layout[key.replace(/^layout\./, '')];
        if (value === undefined) return key;
        return value.replace(/\{\{(\w+)\}\}/g, (_match, token: string) =>
          String(options?.[token] ?? '')
        );
      },
    }),
  };
});

const mocks = vi.hoisted(() => ({ view: {} as Record<string, unknown> }));

vi.mock('@/pages/Home/hooks/useAionArtifacts', () => ({
  useAionArtifacts: () => mocks.view,
}));

function artifact(overrides: Partial<AionArtifact> = {}): AionArtifact {
  return {
    artifactId: 'art_01JY0000000000000000000003',
    projectId: 'prj_01JY0000000000000000000001',
    name: 'test-report.json',
    version: 2,
    mediaType: 'application/json',
    sizeBytes: 2048,
    sha256: 'a'.repeat(64),
    createdAt: '2026-08-08T09:14:02Z',
    publishedAt: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  };
}

function renderWith(
  mode: AionArtifactsMode | null,
  overrides: {
    artifacts?: AionArtifact[];
    nextPageToken?: string;
    loading?: boolean;
    error?: string | null;
    downloadingId?: string | null;
    download?: (artifactId: string) => Promise<void>;
    loadMore?: () => void;
  } = {}
) {
  mocks.view = {
    mode,
    artifacts: overrides.artifacts ?? [],
    nextPageToken: overrides.nextPageToken,
    loading: overrides.loading ?? false,
    loadingMore: false,
    error: overrides.error ?? null,
    downloadingId: overrides.downloadingId ?? null,
    download: overrides.download ?? vi.fn().mockResolvedValue(undefined),
    loadMore: overrides.loadMore ?? vi.fn(),
    reload: vi.fn(),
  };
  return render(
    <AionProjectArtifacts
      projectId="prj_01JY0000000000000000000001"
      openExternal={vi.fn().mockResolvedValue(undefined)}
    />
  );
}

describe('AionProjectArtifacts', () => {
  it('waits for the negotiation rather than claiming the Project is empty', () => {
    renderWith(null);
    expect(screen.getByTestId('aion-artifacts-loading')).toBeTruthy();
    expect(screen.queryByTestId('aion-artifacts-empty')).toBeNull();
  });

  it('names the version a too-old backend reported instead of showing no files', () => {
    renderWith({ kind: 'unsupported', edgeApiVersion: '1.12.0' });
    const banner = screen.getByTestId('aion-artifacts-unsupported');
    expect(banner.textContent).toContain('edge API 1.12.0');
    expect(screen.queryByTestId('aion-artifacts-empty')).toBeNull();
  });

  it('draws one row per artifact with its size', () => {
    renderWith(
      { kind: 'remote' },
      {
        artifacts: [
          artifact(),
          artifact({
            artifactId: 'art_01JY0000000000000000000002',
            name: 'coverage.html',
            version: 1,
            sizeBytes: 18344,
          }),
        ],
      }
    );
    expect(screen.getAllByTestId('aion-artifact-row')).toHaveLength(2);
    expect(screen.getByText('2.0 KB')).toBeTruthy();
    expect(screen.getByText('17.9 KB')).toBeTruthy();
  });

  it('shows a version only where the name repeats', () => {
    renderWith(
      { kind: 'remote' },
      {
        artifacts: [
          artifact({ version: 2 }),
          artifact({
            artifactId: 'art_01JY0000000000000000000002',
            name: 'coverage.html',
            version: 1,
          }),
          artifact({ artifactId: 'art_01JY0000000000000000000001', version: 1 }),
        ],
      }
    );
    // Two writes of test-report.json are two rows a name alone cannot tell
    // apart; coverage.html is unique, so a "v1" beside it would distinguish
    // nothing.
    expect(screen.getByText('v2')).toBeTruthy();
    expect(screen.getByText('v1')).toBeTruthy();
    expect(screen.getAllByText(/^v\d+$/)).toHaveLength(2);
  });

  it('mints the grant only when a row is opened', async () => {
    const download = vi.fn().mockResolvedValue(undefined);
    renderWith({ kind: 'remote' }, { artifacts: [artifact()], download });
    expect(download).not.toHaveBeenCalled();
    screen.getByTestId('aion-artifact-download').click();
    await waitFor(() =>
      expect(download).toHaveBeenCalledWith('art_01JY0000000000000000000003')
    );
  });

  it('disables only the row whose grant is in flight', () => {
    renderWith(
      { kind: 'remote' },
      {
        artifacts: [
          artifact(),
          artifact({
            artifactId: 'art_01JY0000000000000000000002',
            name: 'coverage.html',
          }),
        ],
        downloadingId: 'art_01JY0000000000000000000003',
      }
    );
    const buttons = screen.getAllByTestId(
      'aion-artifact-download'
    ) as HTMLButtonElement[];
    expect(buttons[0].disabled).toBe(true);
    expect(buttons[1].disabled).toBe(false);
  });

  it('says the Project produced nothing only once the edge has answered', () => {
    renderWith({ kind: 'remote' }, { artifacts: [] });
    expect(screen.getByTestId('aion-artifacts-empty')).toBeTruthy();
  });

  it('keeps the rows when a download fails', () => {
    renderWith(
      { kind: 'remote' },
      { artifacts: [artifact()], error: 'artifact is not downloadable' }
    );
    expect(screen.getAllByTestId('aion-artifact-row')).toHaveLength(1);
    expect(screen.getByRole('alert').textContent).toContain(
      'artifact is not downloadable'
    );
  });

  it('offers more only while the edge has a continuation token', () => {
    const loadMore = vi.fn();
    renderWith({ kind: 'remote' }, { artifacts: [artifact()], loadMore });
    expect(screen.queryByTestId('aion-artifacts-load-more')).toBeNull();

    renderWith(
      { kind: 'remote' },
      { artifacts: [artifact()], nextPageToken: 'page-2', loadMore }
    );
    screen.getByTestId('aion-artifacts-load-more').click();
    expect(loadMore).toHaveBeenCalledTimes(1);
  });
});
