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

// The Projects list as aion serves it. Deliberately its own presentation rather
// than an adaptation of the legacy hub row: that row's columns (space, task
// count, trigger count) have no counterpart on an aion Project, so reusing it
// would render three empty columns as if the data were missing.

import { Button } from '@/components/ui/button';
import { useHost } from '@/host';
import { cn } from '@/lib/utils';
import type { AionProject, AionProjectsMode } from '@/store/aionProjectsStore';
import { AlertCircle, ChevronDown, ChevronRight, FolderOpen } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import AionProjectArtifacts from './components/AionProjectArtifacts';
import AionProjectSpace from './components/AionProjectSpace';
import { HomeHubToneTag } from './components/HomeHubItemShared';
import { useHomeHub } from './context';
import {
  compareHubByName,
  compareHubByTimestamp,
  formatHubRelativeAgo,
  matchesHubNameSearch,
} from './utils';

const GRID_CLASS =
  'grid-cols-[20px_minmax(0,2fr)_minmax(0,1fr)_120px_96px] gap-x-4 px-3';

type StatusTone = 'success' | 'error' | 'neutral' | 'information';

/**
 * What the row says is happening. An active run outranks the Project's own
 * status because it is the more specific fact; with nothing in flight the
 * Project reads idle or closed. Unknown values follow the contract's open-set
 * rendering policy — busy, never terminal.
 */
function statusLabel(
  project: AionProject,
  t: (key: string) => string
): { label: string; tone: StatusTone } {
  const run = project.activeRun;
  if (run) {
    switch (run.status) {
      case 'succeeded':
        return {
          label: t('layout.home-project-status-succeeded'),
          tone: 'success',
        };
      case 'failed':
      case 'failed_final':
        return { label: t('layout.home-project-status-failed'), tone: 'error' };
      case 'cancelled':
        return {
          label: t('layout.projects-status-cancelled'),
          tone: 'neutral',
        };
      default:
        return {
          label: t('layout.home-project-status-running'),
          tone: 'information',
        };
    }
  }
  return project.status === 'closed'
    ? { label: t('layout.projects-status-closed'), tone: 'neutral' }
    : { label: t('layout.projects-status-idle'), tone: 'neutral' };
}

function Banner({ message }: { message: string }) {
  return (
    <div
      className="mx-6 flex items-center gap-4 rounded-2xl bg-ds-bg-neutral-default-default px-6 py-6"
      role="alert"
      data-testid="aion-projects-banner"
    >
      <AlertCircle className="h-5 w-5 shrink-0 text-ds-icon-status-error-default-default" />
      <span className="text-body-sm text-ds-text-neutral-default-default">
        {message}
      </span>
    </div>
  );
}

export default function AionProjects({ mode }: { mode: AionProjectsMode }) {
  const { t } = useTranslation();
  const host = useHost();
  const electronAPI = host?.electronAPI;
  const { searchQuery, sortBy, sortDirection, aionProjects } = useHomeHub();
  const { projects, nextPageToken, loading, loadingMore, error, loadMore } =
    aionProjects;
  const [openProjectId, setOpenProjectId] = useState<string | null>(null);

  // A download grant is a plain URL against the artifact bucket, so it opens in
  // the user's own browser where their download directory and progress UI live.
  const openExternal = useCallback(
    async (url: string) => {
      if (electronAPI?.openExternal) {
        const result = await electronAPI.openExternal(url);
        if (result && result.success === false) {
          throw new Error(result.error || t('layout.artifacts-open-failed'));
        }
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    [electronAPI, t]
  );

  const visible = useMemo(() => {
    const filtered = projects.filter((project) =>
      matchesHubNameSearch(searchQuery, project.title)
    );
    return [...filtered].sort((a, b) => {
      if (sortBy === 'name') {
        return compareHubByName(a.title, b.title, sortDirection);
      }
      const left = sortBy === 'created' ? a.createdAt : a.updatedAt;
      const right = sortBy === 'created' ? b.createdAt : b.updatedAt;
      return compareHubByTimestamp(left, right, sortDirection);
    });
  }, [projects, searchQuery, sortBy, sortDirection]);

  if (mode.kind === 'unsupported') {
    return (
      <Banner
        message={t('layout.projects-backend-too-old', {
          version: mode.edgeApiVersion,
        })}
      />
    );
  }
  if (mode.kind === 'error') {
    return (
      <Banner
        message={t('layout.projects-remote-error', { message: mode.message })}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex w-full min-w-0 flex-col">
        <div className="pb-12 text-body-sm text-ds-text-neutral-muted-default">
          {t('layout.loading')}
        </div>
      </div>
    );
  }

  // A page that failed with nothing loaded is the whole surface failing; a page
  // that failed while extending a list keeps the rows and reports below them.
  if (error && projects.length === 0) {
    return (
      <Banner message={t('layout.projects-remote-error', { message: error })} />
    );
  }

  return (
    <div className="flex w-full min-w-0 flex-col" data-testid="aion-projects">
      <div className="mb-12 w-full min-w-0">
        {projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <FolderOpen className="mb-4 h-12 w-12 text-ds-icon-neutral-muted-default" />
            <div className="text-sm text-ds-text-neutral-muted-default">
              {t('dashboard.no-projects-found')}
            </div>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <div className="text-sm text-ds-text-neutral-muted-default">
              {t('layout.search-no-results')}
            </div>
          </div>
        ) : (
          <>
            <div className={cn('grid items-center py-2.5', GRID_CLASS)}>
              <span aria-hidden />
              {[
                'layout.home-list-name',
                'layout.home-list-model',
                'layout.home-list-status',
                'layout.home-list-updated',
              ].map((key, index) => (
                <span
                  key={key}
                  className={cn(
                    'truncate !text-label-sm font-normal leading-none text-ds-text-neutral-muted-default',
                    index === 3 ? 'text-right' : 'text-left'
                  )}
                >
                  {t(key)}
                </span>
              ))}
            </div>
            <div className="flex flex-col gap-1">
              {visible.map((project) => {
                const status = statusLabel(project, t);
                const expanded = openProjectId === project.projectId;
                return (
                  <div
                    key={project.projectId}
                    className="rounded-xl border border-solid border-transparent bg-ds-bg-neutral-default-default"
                  >
                    <button
                      type="button"
                      data-testid="aion-project-row"
                      aria-expanded={expanded}
                      aria-label={t('layout.artifacts-toggle', {
                        name: project.title,
                      })}
                      onClick={() =>
                        setOpenProjectId(expanded ? null : project.projectId)
                      }
                      className={cn(
                        'grid w-full cursor-pointer items-center rounded-xl py-2.5 text-left outline-none hover:bg-ds-bg-neutral-subtle-default focus-visible:ring-2 focus-visible:ring-ds-ring-neutral-subtle-default',
                        GRID_CLASS
                      )}
                    >
                      {expanded ? (
                        <ChevronDown
                          className="h-4 w-4 shrink-0 text-ds-icon-neutral-muted-default"
                          aria-hidden
                        />
                      ) : (
                        <ChevronRight
                          className="h-4 w-4 shrink-0 text-ds-icon-neutral-muted-default"
                          aria-hidden
                        />
                      )}
                      <span className="truncate text-body-sm text-ds-text-neutral-default-default">
                        {project.title}
                      </span>
                      <span className="truncate text-body-xs text-ds-text-neutral-muted-default">
                        {project.modelAlias}
                      </span>
                      <HomeHubToneTag label={status.label} tone={status.tone} />
                      <span className="truncate text-right text-body-xs tabular-nums text-ds-text-neutral-muted-default">
                        {formatHubRelativeAgo(project.updatedAt, t)}
                      </span>
                    </button>
                    {expanded ? (
                      <>
                        <AionProjectSpace
                          projectId={project.projectId}
                          spaceId={project.spaceId}
                        />
                        <AionProjectArtifacts
                          projectId={project.projectId}
                          openExternal={openExternal}
                        />
                      </>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {error ? (
              <div
                className="px-3 pt-3 text-body-xs text-ds-text-status-error-strong-default"
                role="alert"
                data-testid="aion-projects-error"
              >
                {t('layout.projects-remote-error', { message: error })}
              </div>
            ) : null}
            {nextPageToken ? (
              <div className="flex justify-center pt-4">
                <Button
                  variant="secondary"
                  size="sm"
                  data-testid="aion-projects-load-more"
                  disabled={loadingMore}
                  onClick={loadMore}
                >
                  {loadingMore
                    ? t('layout.loading')
                    : t('layout.projects-load-more')}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
