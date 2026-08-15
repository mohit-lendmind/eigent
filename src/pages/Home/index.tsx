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

import AlertDialog from '@/components/ui/alertDialog';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { useAionMode, visibleInMode } from '@/hooks/useAionMode';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AionUsage from './AionUsage';
import HomeHubToolbar from './components/HomeHubToolbar';
import {
  HomeHubProvider,
  type HomeSortBy,
  type HomeSortDirection,
  type HomeViewMode,
} from './context';
import { useAionProjects } from './hooks/useAionProjects';
import { useAionSchedules } from './hooks/useAionSchedules';
import { useAionSpaces } from './hooks/useAionSpaces';
import { useHomeHubCounts } from './hooks/useHomeHubCounts';
import { useHomeHubProjects } from './hooks/useHomeHubProjects';
import Projects from './Projects';
import Spaces from './Spaces';
import Triggers from './Triggers';
import {
  capitalizeLabel,
  persistHomeViewMode,
  readStoredHomeViewMode,
} from './utils';

const HOME_SECTIONS = ['spaces', 'projects', 'triggers', 'usage'] as const;
type HomeSection = (typeof HOME_SECTIONS)[number];

// Only aion meters what a run costs, so the section is absent — not empty —
// on the legacy plane, and absent while the mode is still unknown so it cannot
// flash in and out during the handshake.
const AION_ONLY_SECTIONS: readonly string[] = ['usage'];

function isHomeSection(value: string | null): value is HomeSection {
  return value !== null && HOME_SECTIONS.includes(value as HomeSection);
}

export default function HomeHub() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sectionFromUrl = searchParams.get('section');
  const { chatStore } = useChatStoreAdapter();
  const {
    projects,
    handleProjectRename,
    handleProjectDelete: hubHandleProjectDelete,
  } = useHomeHubProjects();
  const aionProjects = useAionProjects();
  const aionSchedules = useAionSchedules();
  const aionSpaces = useAionSpaces();
  const sectionCounts = useHomeHubCounts(
    projects,
    // Only aion mode owns the count. A mode that cannot serve the list at all
    // (too old, or erroring) contributes no number rather than a misleading 0.
    aionProjects.mode?.kind === 'remote'
      ? aionProjects.projects.length
      : undefined,
    aionSchedules.mode?.kind === 'remote'
      ? aionSchedules.schedules.length
      : undefined,
    aionSpaces.mode?.kind === 'remote' ? aionSpaces.spaces.length : undefined
  );

  const [deleteProjectModalOpen, setDeleteProjectModalOpen] = useState(false);
  const [curProjectId, setCurProjectId] = useState('');
  const [projectDeleteCallback, setProjectDeleteCallback] = useState<
    (() => Promise<void>) | null
  >(null);

  const aionMode = useAionMode();
  const menuItems = useMemo(
    () =>
      visibleInMode(
        [
          {
            id: 'spaces' as const,
            name: capitalizeLabel(t('layout.spaces')),
            count: sectionCounts.spaces,
          },
          {
            id: 'projects' as const,
            name: capitalizeLabel(t('layout.projects')),
            count: sectionCounts.projects,
          },
          {
            id: 'triggers' as const,
            name: capitalizeLabel(t('layout.triggers')),
            count: sectionCounts.triggers,
          },
          {
            // No count: the bill is paged, so any number here would be the
            // rows loaded so far rather than the runs there are.
            id: 'usage' as const,
            name: capitalizeLabel(t('layout.usage')),
          },
        ],
        aionMode,
        [],
        AION_ONLY_SECTIONS
      ),
    [aionMode, sectionCounts, t]
  );

  // URL is the source of truth for the active section — derive directly
  // instead of mirroring into local state (avoids a resync window). A section
  // the current mode does not serve falls back rather than rendering nothing,
  // so a bookmarked ?section=usage on a legacy desktop still lands somewhere.
  const activeTab: HomeSection =
    isHomeSection(sectionFromUrl) &&
    menuItems.some((item) => item.id === sectionFromUrl)
      ? sectionFromUrl
      : 'spaces';
  const [viewMode, setViewModeState] = useState<HomeViewMode>(
    readStoredHomeViewMode
  );
  const setViewMode = useCallback((mode: HomeViewMode) => {
    setViewModeState(mode);
    persistHomeViewMode(mode);
  }, []);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<HomeSortBy>('created');
  const [sortDirection, setSortDirection] = useState<HomeSortDirection>('desc');

  useEffect(() => {
    setSearchQuery('');
    setSortBy('created');
    setSortDirection('desc');
  }, [activeTab]);

  const handleTabChange = (tabId: string) => {
    if (!menuItems.some((item) => item.id === tabId)) return;
    navigate(`?tab=home&section=${tabId}`, { replace: true });
  };

  const handleProjectDelete = (projectId: string) => {
    hubHandleProjectDelete(projectId, (deleteCallbackFn) => {
      setCurProjectId(projectId);
      setProjectDeleteCallback(() => deleteCallbackFn);
      setDeleteProjectModalOpen(true);
    });
  };

  const confirmProjectDelete = async () => {
    const projectId = curProjectId;
    if (!projectId || !projectDeleteCallback) return;

    try {
      await projectDeleteCallback();
    } catch (error) {
      console.error('Failed to delete project:', error);
    } finally {
      setCurProjectId('');
      setProjectDeleteCallback(null);
      setDeleteProjectModalOpen(false);
    }
  };

  const hubContextValue = useMemo(
    () => ({
      viewMode,
      setViewMode,
      searchQuery,
      setSearchQuery,
      sortBy,
      setSortBy,
      sortDirection,
      setSortDirection,
      projects,
      aionProjects,
      aionSchedules,
      aionSpaces,
      chatTasks: chatStore?.tasks,
      onProjectDelete: handleProjectDelete,
      onProjectRename: handleProjectRename,
      activeTaskId: chatStore?.activeTaskId || undefined,
    }),
    // `handle*` callbacks aren't memoized themselves and the parent re-renders
    // are infrequent; include only the data dependencies React tracks here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      viewMode,
      searchQuery,
      sortBy,
      sortDirection,
      projects,
      aionProjects,
      aionSchedules,
      aionSpaces,
      chatStore?.tasks,
      chatStore?.activeTaskId,
    ]
  );

  return (
    <HomeHubProvider value={hubContextValue}>
      <AlertDialog
        isOpen={deleteProjectModalOpen}
        onClose={() => setDeleteProjectModalOpen(false)}
        onConfirm={confirmProjectDelete}
        title={t('layout.delete-project') || 'Delete Project'}
        message={
          t('layout.delete-project-confirmation') ||
          'Are you sure you want to delete this project and all its tasks? This action cannot be undone.'
        }
        confirmText={t('layout.delete')}
        cancelText={t('layout.cancel')}
      />

      <div className="flex w-full min-w-0 flex-1 flex-col [--home-hub-history-tabs-offset:49px]">
        <HomeHubToolbar
          activeTab={activeTab}
          onTabChange={handleTabChange}
          menuItems={menuItems}
        />

        <div className="w-full min-w-0 flex-1">
          {activeTab === 'spaces' && <Spaces />}
          {activeTab === 'projects' && <Projects />}
          {activeTab === 'triggers' && <Triggers />}
          {activeTab === 'usage' && <AionUsage />}
        </div>
      </div>
    </HomeHubProvider>
  );
}
