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

import { GlobalSearchDialog } from '@/components/GlobalSearch';
import AlertDialog from '@/components/ui/alertDialog';
import { Button } from '@/components/ui/button';
import { TooltipSimple } from '@/components/ui/tooltip';
import { useHost } from '@/host';
import {
  isProjectAchieved,
  setProjectAchievedState,
} from '@/lib/projectAchievement';
import { deleteProjectLocally } from '@/lib/projectDeletion';
import { resolveProjectNavLeadPresentation } from '@/lib/sessionNavLead';
import {
  getContextTabBindingLabel,
  isUnboundUntitledSpace,
} from '@/lib/spaceLabel';
import { cn } from '@/lib/utils';
import type { ChatStore } from '@/store/chatStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import {
  getVisibleProjectMetasForSpace,
  useSpaceStore,
} from '@/store/spaceStore';
import { ChatTaskStatus } from '@/types/constants';
import { Inbox, LayoutGrid, Plus, Zap } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { NavTab } from './NavTab';
import { ProjectNavList } from './ProjectNavList';

export interface ProjectPageSidebarProps {
  chatStore: ChatStore | null;
  className?: string;
}

let didAttemptBootSessionResume = false;

export default function ProjectPageSidebar({
  chatStore: _chatStore,
  className,
}: ProjectPageSidebarProps) {
  const activeWorkspaceTab = usePageTabStore((s) => s.activeWorkspaceTab);
  const setActiveWorkspaceTab = usePageTabStore((s) => s.setActiveWorkspaceTab);
  const requestWorkspaceChatFocus = usePageTabStore(
    (s) => s.requestWorkspaceChatFocus
  );
  const requestOpenTriggerAddDialog = usePageTabStore(
    (s) => s.requestOpenTriggerAddDialog
  );
  const projectSidebarFolded = usePageTabStore((s) => s.projectSidebarFolded);
  const unviewedTabs = usePageTabStore((s) => s.unviewedTabs);
  const inboxUnviewedForProjects = usePageTabStore(
    (s) => s.inboxUnviewedForProjects
  );
  const projectStore = useProjectRuntimeStore();
  const navLeadByProjectId = useProjectRuntimeStore(
    (s) => s.navLeadByProjectId
  );
  const activeProjectId = projectStore.activeProjectId;
  const activeSpaceId = useSpaceStore((s) => s.activeSpaceId);
  const spacesById = useSpaceStore((s) => s.spaces);
  const projectsBySpaceId = useSpaceStore((s) => s.projectsBySpaceId);
  const projectMetasForActiveSpace = useMemo(() => {
    if (!activeSpaceId) return [];
    return getVisibleProjectMetasForSpace(projectsBySpaceId, activeSpaceId);
  }, [activeSpaceId, projectsBySpaceId]);
  const folderTabHasUnviewedFiles =
    !!activeProjectId && inboxUnviewedForProjects.has(activeProjectId);
  const { t } = useTranslation();
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [deleteProjectId, setDeleteProjectId] = useState<string | null>(null);
  const [deleteProjectLoading, setDeleteProjectLoading] = useState(false);
  const [achieveProjectId, setAchieveProjectId] = useState<string | null>(null);
  const [achieveProjectLoading, setAchieveProjectLoading] = useState(false);
  const [achieveDialogOpen, setAchieveDialogOpen] = useState(false);
  const [pinnedProjectIds, setPinnedProjectIds] = useState<Set<string>>(() => {
    try {
      return new Set(
        JSON.parse(
          localStorage.getItem('eigent-pinned-projects') ?? '[]'
        ) as string[]
      );
    } catch {
      return new Set();
    }
  });

  const scheduledTabLabel = t('layout.scheduled-tab');

  const host = useHost();
  const ipcRenderer = host?.ipcRenderer;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setGlobalSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const activeSpace = activeSpaceId ? spacesById[activeSpaceId] : null;
  const isActiveSpaceUnbound = isUnboundUntitledSpace(activeSpace, t);
  const contextTabBinding = useMemo(
    () => getContextTabBindingLabel(activeSpace, t),
    [activeSpace, t]
  );

  const projectHasStarted = useCallback(
    (projectId: string) => {
      const projectChatStore = projectStore.peekActiveChatStore(projectId);
      const projectChatState = projectChatStore?.getState();
      const projectTask = projectChatState?.activeTaskId
        ? projectChatState.tasks[projectChatState.activeTaskId]
        : undefined;
      return Boolean(
        projectTask &&
        ((projectTask.messages?.length || 0) > 0 ||
          projectTask.hasMessages ||
          projectTask.status !== ChatTaskStatus.PENDING)
      );
    },
    [projectStore]
  );

  const shouldShowProjectInNavList = useCallback(
    (project: (typeof projectMetasForActiveSpace)[number]) => {
      if (project.metadata?.historyId) return true;
      const historyDisplayName =
        typeof project.metadata?.historyDisplayName === 'string'
          ? project.metadata.historyDisplayName.trim()
          : '';
      if (historyDisplayName) return true;

      const normalizedName = (project.name ?? '').trim().toLowerCase();
      if (
        normalizedName &&
        normalizedName !== 'new project' &&
        normalizedName !== 'new space'
      ) {
        return true;
      }

      return projectHasStarted(project.id);
    },
    [projectHasStarted]
  );

  const isProjectNavSelectionActive =
    activeWorkspaceTab === 'project' || activeWorkspaceTab === 'new-project';

  /**
   * Give a Project a chat store to render into. The conversation itself is
   * replayed by the aion chat bridge off the Project's own event stream, so
   * there is nothing to fetch here — only the empty shell to open.
   */
  const ensureProjectLoaded = useCallback(
    async (projectId: string) => {
      if (projectStore.peekActiveChatStore(projectId)) return;
      projectStore.appendInitChatStore(projectId);
    },
    [projectStore]
  );

  const selectProject = useCallback(
    async (projectId: string) => {
      projectStore.setActiveProject(projectId);

      // Already loaded — flip to the live Project shell immediately.
      if (projectStore.peekActiveChatStore(projectId)) {
        setActiveWorkspaceTab('project');
        return;
      }

      await ensureProjectLoaded(projectId);

      // Trust the project type tag (set by createProject(REPLAY)) over
      // `projectHasStarted`, which can read a transiently-empty chatStore
      // during a rebuild.
      const meta = useSpaceStore.getState().getProjectMeta(projectId);
      const projectInStore = projectStore.getProjectById(projectId);
      const isReplayProject = Boolean(
        meta?.metadata?.tags?.includes('replay') ||
        projectInStore?.metadata?.tags?.includes('replay')
      );
      setActiveWorkspaceTab(
        isReplayProject || projectHasStarted(projectId)
          ? 'project'
          : 'new-project'
      );
    },
    [
      ensureProjectLoaded,
      projectHasStarted,
      projectStore,
      setActiveWorkspaceTab,
    ]
  );

  // Boot-time session resume: reopen the last visited Project (the way an
  // editor reopens its last workspace) instead of landing on the empty home
  // tab. One-shot per renderer boot (launch or reload; the flag is module
  // scoped so sidebar remounts within a session never re-trigger it), and
  // only from the pristine boot state (default tab, no active Project), so
  // deliberately navigating home later is never hijacked. Uses the same
  // path as clicking the Project in the sidebar.
  useEffect(() => {
    if (didAttemptBootSessionResume) return;
    didAttemptBootSessionResume = true;

    if (activeWorkspaceTab !== 'workforce') return;
    if (projectStore.activeProjectId) return;
    if (!activeSpaceId) return;
    const lastVisitedId =
      useSpaceStore.getState().lastVisitedProjectBySpace[activeSpaceId];
    if (!lastVisitedId) return;
    const lastVisitedMeta = projectMetasForActiveSpace.find(
      (project) => project.id === lastVisitedId
    );
    if (!lastVisitedMeta || !shouldShowProjectInNavList(lastVisitedMeta)) {
      return;
    }
    void selectProject(lastVisitedId);
    // One-shot boot effect: later changes to these values must not
    // re-trigger a resume.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const navProjects = useMemo(
    () =>
      projectMetasForActiveSpace
        .filter((project) => shouldShowProjectInNavList(project))
        .map((project) => {
          // `navLeadByProjectId` is kept live by `projectStore`'s chat-store
          // subscription registry — no need to peek into chat-store internals
          // here (those reads aren't tracked by React).
          const projectChatStore = projectStore.peekActiveChatStore(project.id);
          const projectChatState = projectChatStore?.getState();
          const activeTask = projectChatState?.activeTaskId
            ? projectChatState.tasks[projectChatState.activeTaskId]
            : undefined;
          return {
            id: project.id,
            title:
              project.name && project.name !== 'new project'
                ? project.name
                : t('layout.new-project'),
            sessionLead: resolveProjectNavLeadPresentation({
              cachedLead: navLeadByProjectId[project.id],
              isAchieved: isProjectAchieved(project.metadata),
            }),
            achieved: isProjectAchieved(project.metadata),
            pinned: pinnedProjectIds.has(project.id),
            source: activeTask?.source,
          };
        }),
    [
      navLeadByProjectId,
      pinnedProjectIds,
      projectMetasForActiveSpace,
      projectStore,
      shouldShowProjectInNavList,
      t,
    ]
  );

  const handleNewProject = useCallback(() => {
    projectStore.setActiveProject(null);
    setActiveWorkspaceTab('new-project');
    requestWorkspaceChatFocus();
  }, [projectStore, requestWorkspaceChatFocus, setActiveWorkspaceTab]);

  const openInboxTab = useCallback(() => {
    let projectId = activeProjectId;

    if (!projectId && activeSpaceId) {
      const spaceStore = useSpaceStore.getState();
      const projectsInSpace = spaceStore.getProjectsForSpace(activeSpaceId);
      if (projectsInSpace.length > 0) {
        const lastVisitedProjectId =
          spaceStore.lastVisitedProjectBySpace[activeSpaceId];
        const targetProject =
          projectsInSpace.find(
            (project) => project.id === lastVisitedProjectId
          ) ?? projectsInSpace[0];
        projectId = targetProject.id;
        projectStore.setActiveProject(projectId);
      }
    }

    if (!projectId) {
      toast.error(t('layout.workspace-select-project'));
      return;
    }

    const projectChatStore = projectStore.peekActiveChatStore(projectId);
    const taskId = projectChatStore?.getState().activeTaskId;
    if (taskId) {
      projectChatStore?.getState().setNuwFileNum(taskId, 0);
    }

    setActiveWorkspaceTab('inbox', {
      clearInboxForProjectId: projectId,
    });

    if (!projectStore.peekActiveChatStore(projectId)) {
      void ensureProjectLoaded(projectId);
    }
  }, [
    activeProjectId,
    activeSpaceId,
    ensureProjectLoaded,
    projectStore,
    setActiveWorkspaceTab,
    t,
  ]);

  const handlePinProject = useCallback((projectId: string) => {
    setPinnedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      try {
        localStorage.setItem(
          'eigent-pinned-projects',
          JSON.stringify([...next])
        );
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  }, []);

  const requestDeleteProject = useCallback((projectId: string) => {
    setDeleteProjectId(projectId);
  }, []);

  const requestAchieveProject = useCallback((projectId: string) => {
    setAchieveProjectId(projectId);
    setAchieveDialogOpen(true);
  }, []);

  const confirmDeleteProject = useCallback(async () => {
    const projectId = deleteProjectId;
    if (!projectId) return;

    setDeleteProjectLoading(true);
    try {
      const wasActive = projectStore.activeProjectId === projectId;
      await deleteProjectLocally(projectId, ipcRenderer);

      if (wasActive) {
        setActiveWorkspaceTab('workforce');
        requestWorkspaceChatFocus();
      }

      toast.success(t('layout.delete-project'));
    } catch (error) {
      console.error('[ProjectPageSidebar] Failed to delete project:', error);
      toast.error(t('layout.delete-project'));
    } finally {
      setDeleteProjectLoading(false);
      setDeleteProjectId(null);
    }
  }, [
    deleteProjectId,
    ipcRenderer,
    projectStore,
    requestWorkspaceChatFocus,
    setActiveWorkspaceTab,
    t,
  ]);

  const confirmAchieveProject = useCallback(async () => {
    const projectId = achieveProjectId;
    if (!projectId) return;

    setAchieveProjectLoading(true);
    try {
      const wasActive = projectStore.activeProjectId === projectId;
      await ensureProjectLoaded(projectId);
      const projectChatStore = projectStore.peekActiveChatStore(projectId);
      const projectChatState = projectChatStore?.getState();
      const taskId = projectChatState?.activeTaskId;
      const task = taskId ? projectChatState?.tasks[taskId] : undefined;

      const hasActiveRun =
        task &&
        (task.status === ChatTaskStatus.RUNNING ||
          task.status === ChatTaskStatus.PAUSE ||
          task.isPending);
      if (taskId && hasActiveRun) {
        projectChatStore?.getState().stopTask(taskId);
        projectChatStore?.getState().setIsPending(taskId, false);
      }

      await setProjectAchievedState({
        projectStore,
        projectId,
        achieved: true,
      });
      if (wasActive) {
        setActiveWorkspaceTab('workforce');
        requestWorkspaceChatFocus();
      }
      toast.success(t('layout.project-ended-successfully'), {
        closeButton: true,
      });
    } catch (error) {
      console.error('[ProjectPageSidebar] Failed to achieve project:', error);
      toast.error(t('layout.failed-to-end-project'), {
        closeButton: true,
      });
    } finally {
      setAchieveProjectLoading(false);
      setAchieveProjectId(null);
      setAchieveDialogOpen(false);
    }
  }, [
    achieveProjectId,
    ensureProjectLoaded,
    projectStore,
    requestWorkspaceChatFocus,
    setActiveWorkspaceTab,
    t,
  ]);

  return (
    <>
      <GlobalSearchDialog
        open={globalSearchOpen}
        onOpenChange={setGlobalSearchOpen}
      />
      <AlertDialog
        isOpen={deleteProjectId != null}
        onClose={() => {
          if (deleteProjectLoading) return;
          setDeleteProjectId(null);
        }}
        onConfirm={() => void confirmDeleteProject()}
        title={t('layout.delete-project')}
        message={t('layout.delete-project-confirmation')}
        confirmText={t('layout.delete')}
        cancelText={t('layout.cancel')}
        confirmDisabled={deleteProjectLoading}
      />

      <AlertDialog
        isOpen={achieveDialogOpen}
        onClose={() => {
          if (achieveProjectLoading) return;
          setAchieveDialogOpen(false);
          setAchieveProjectId(null);
        }}
        onConfirm={() => void confirmAchieveProject()}
        title={t('layout.end-project')}
        message={t('layout.ending-this-project-will-stop')}
        confirmText={t('layout.yes-end-project')}
        cancelText={t('layout.cancel')}
        confirmVariant="caution"
        confirmDisabled={achieveProjectLoading}
      />

      <aside
        className={cn(
          'box-border flex h-full min-h-0 w-full min-w-0 shrink-0 flex-col items-start overflow-hidden rounded-2xl bg-ds-bg-neutral-default-default p-1',
          className
        )}
      >
        <div className="flex h-full min-h-0 w-full min-w-0 max-w-full flex-col overflow-x-hidden">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex w-full shrink-0 flex-col gap-1">
              <div className="flex w-full min-w-0 flex-col gap-1">
                <NavTab
                  active={activeWorkspaceTab === 'workforce'}
                  onClick={() => setActiveWorkspaceTab('workforce')}
                  leading={
                    <LayoutGrid className="h-4 w-4 shrink-0" aria-hidden />
                  }
                  label={t('layout.workspace-tab')}
                  tooltip={t('layout.workspace-tab')}
                  tooltipEnabledWhenCollapsed={!projectSidebarFolded}
                  folded={projectSidebarFolded}
                  ariaLabel={t('layout.workspace-tab')}
                  ariaCurrentPage={activeWorkspaceTab === 'workforce'}
                />
                <NavTab
                  active={activeWorkspaceTab === 'inbox'}
                  onClick={openInboxTab}
                  disabled={isActiveSpaceUnbound}
                  leading={
                    <span className="relative inline-flex h-4 w-4 shrink-0">
                      <Inbox className="h-4 w-4 shrink-0" aria-hidden />
                      {folderTabHasUnviewedFiles && !isActiveSpaceUnbound ? (
                        <span
                          className="absolute -right-1 -top-1 h-2 w-2 shrink-0 rounded-full bg-ds-text-error-default-default ease-in-out"
                          aria-hidden
                        />
                      ) : null}
                    </span>
                  }
                  label={t('layout.context-tab')}
                  trailing={
                    contextTabBinding ? (
                      <div
                        className={cn(
                          'flex shrink-0 flex-col items-center rounded-xl bg-ds-bg-neutral-muted-default px-1.5',
                          contextTabBinding.tooltip && 'pointer-events-auto'
                        )}
                        onClick={
                          contextTabBinding.tooltip
                            ? (e) => e.stopPropagation()
                            : undefined
                        }
                      >
                        {contextTabBinding.tooltip ? (
                          <TooltipSimple
                            content={contextTabBinding.tooltip}
                            side="top"
                            sideOffset={8}
                          >
                            <span className="text-label-xs font-medium text-ds-text-neutral-muted-default">
                              {contextTabBinding.label}
                            </span>
                          </TooltipSimple>
                        ) : (
                          <span className="text-label-xs font-medium text-ds-text-neutral-muted-default">
                            {contextTabBinding.label}
                          </span>
                        )}
                      </div>
                    ) : undefined
                  }
                  tooltip={
                    isActiveSpaceUnbound
                      ? t('layout.context-tab-unbound-tooltip')
                      : (contextTabBinding?.tooltip ?? t('layout.context-tab'))
                  }
                  // Render the tooltip even when disabled so users get a hint
                  // instead of relying on the toast that only fires on click.
                  tooltipEnabledWhenCollapsed={!projectSidebarFolded}
                  folded={projectSidebarFolded}
                  ariaLabel={t('layout.context-tab')}
                  ariaCurrentPage={activeWorkspaceTab === 'inbox'}
                />
                <NavTab
                  layout="split"
                  active={activeWorkspaceTab === 'triggers'}
                  onClick={() => setActiveWorkspaceTab('triggers')}
                  leading={
                    <Zap
                      className="h-4 w-4 shrink-0 text-ds-icon-neutral-muted-default"
                      aria-hidden
                    />
                  }
                  label={scheduledTabLabel}
                  showNotificationDot={unviewedTabs.has('triggers')}
                  notificationDotTone="attention"
                  notificationDotClassName="h-2 w-2"
                  endAction={
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      buttonContent="icon-only"
                      className={cn(
                        'no-drag mr-1 shrink-0 rounded-xl hover:bg-ds-bg-neutral-strong-default',
                        'focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-border-neutral-default-default'
                      )}
                      aria-label={t('triggers.add-trigger')}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        requestOpenTriggerAddDialog();
                      }}
                    >
                      <Plus
                        className="h-4 w-4 text-ds-icon-neutral-muted-default"
                        aria-hidden
                      />
                    </Button>
                  }
                  tooltip={scheduledTabLabel}
                  tooltipEnabledWhenCollapsed={!projectSidebarFolded}
                  folded={projectSidebarFolded}
                  ariaLabel={scheduledTabLabel}
                  ariaCurrentPage={activeWorkspaceTab === 'triggers'}
                />
              </div>
            </div>

            <div className="my-2 px-3">
              <div className="h-px w-full bg-ds-border-neutral-default-default" />
            </div>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <ProjectNavList
                className="flex min-h-0 flex-1 flex-col"
                projects={navProjects}
                activeProjectId={
                  isProjectNavSelectionActive ? activeProjectId : null
                }
                onProjectClick={selectProject}
                onDeleteProject={requestDeleteProject}
                onAchieveProject={requestAchieveProject}
                onPinProject={handlePinProject}
                onNewProject={handleNewProject}
                newProjectActive={activeWorkspaceTab === 'new-project'}
                folded={projectSidebarFolded}
              />
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
