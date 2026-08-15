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

import tokenDarkIcon from '@/assets/custom/token-dark.svg';
import tokenLightIcon from '@/assets/custom/token-light.svg';
import { formatTokenCount } from '@/components/ChatBox/MessageItem/TokenUtils';
import { Button } from '@/components/ui/button';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { useHost } from '@/host';
import { deleteProjectLocally } from '@/lib/projectDeletion';
import { share } from '@/lib/share';
import { useAuthStore } from '@/store/authStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useSpaceStore } from '@/store/spaceStore';
import { ChatTaskStatus } from '@/types/constants';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Ellipsis,
  FolderCheck,
  FolderClock,
  ListChecks,
  Plus,
  Share,
  Trash2,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import AlertDialog from '../ui/alertDialog';
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from '../ui/popover';
import { Tag } from '../ui/tag';
import { TooltipSimple } from '../ui/tooltip';
import SearchInput from './SearchInput';

const compactCountFormatter = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
  minimumFractionDigits: 0,
});

const formatCompactCount = (value?: number) =>
  compactCountFormatter.format(value || 0);

interface SidebarProject {
  id: string;
  name: string;
  taskCount: number;
  totalTokens: number;
  lastPrompt: string;
  isRunning: boolean;
}

export default function HistorySidebar() {
  const { t } = useTranslation();
  const host = useHost();
  const ipcRenderer = host?.ipcRenderer;
  const { appearance } = useAuthStore();
  const tokenIcon = appearance === 'dark' ? tokenDarkIcon : tokenLightIcon;
  const { isOpen, close } = useSidebarStore();
  const navigate = useNavigate();
  //Get Chatstore for the active project's task
  const { chatStore, projectStore } = useChatStoreAdapter();
  const [searchValue, setSearchValue] = useState('');
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [anchorStyle, setAnchorStyle] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [currentProjectId, setCurrentProjectId] = useState('');
  const activeSpaceId = useSpaceStore((s) => s.activeSpaceId);
  const projectsBySpaceId = useSpaceStore((s) => s.projectsBySpaceId);

  /**
   * Every Project in the active Space, running or not. `getAllProjects` merges
   * the Space meta rows with whatever this renderer has loaded, so a Project
   * listed but never opened still appears — with the counts it can compute
   * locally, which is zero until its conversation is loaded.
   */
  const projects = useMemo<SidebarProject[]>(() => {
    if (!chatStore) return [];
    return projectStore
      .getAllProjects(activeSpaceId ?? undefined)
      .map((project) => {
        let taskCount = 0;
        let totalTokens = 0;
        let lastPrompt = '';
        let isRunning = false;

        for (const { chatStore: cs } of projectStore.getAllChatStores(
          project.id
        )) {
          const state = cs.getState();
          for (const taskId of Object.keys(state.tasks || {})) {
            const task = state.tasks[taskId];
            if (task.type) continue;
            taskCount++;
            totalTokens += task.tokens || 0;
            if (task.status !== ChatTaskStatus.FINISHED) {
              isRunning = true;
            }
            if (!lastPrompt && task.messages?.[0]?.content) {
              lastPrompt = task.messages[0].content;
            }
          }
        }

        return {
          id: project.id,
          name: project.name,
          taskCount,
          totalTokens,
          lastPrompt,
          isRunning,
        };
      });
    // `updateCount` and the Space meta map are what change as tasks run and as
    // Projects come and go; neither is reachable through `projectStore`'s own
    // identity, so both are named here to keep the list live.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    projectStore,
    chatStore,
    chatStore?.updateCount,
    activeSpaceId,
    projectsBySpaceId,
  ]);

  const visibleProjects = useMemo(() => {
    const query = searchValue.trim().toLowerCase();
    if (!query) return projects;
    return projects.filter(
      (project) =>
        project.lastPrompt.toLowerCase().includes(query) ||
        project.name?.toLowerCase().includes(query)
    );
  }, [projects, searchValue]);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchValue(e.target.value);
  };

  const createChat = () => {
    close();
    //Create a new project
    //Handles refocusing id & non duplicate logic internally
    projectStore.createProject('new project');
    navigate('/');
  };

  const handleDelete = (id: string) => {
    setCurrentProjectId(id);
    setDeleteModalOpen(true);
  };

  const confirmDelete = async () => {
    await deleteProjectLocally(currentProjectId, ipcRenderer);
    setCurrentProjectId('');
    setDeleteModalOpen(false);
  };

  const handleShare = async (taskId: string) => {
    close();
    share(taskId);
  };

  useLayoutEffect(() => {
    const PANEL_WIDTH = 360;
    const GAP = 8;
    const MARGIN = 8;

    const updateAnchor = () => {
      const sidebarTitleEl = document.getElementById(
        'sidebar-active-task-title-btn'
      );
      const topBarTitleEl = document.getElementById('active-task-title-btn');

      let anchorEl: HTMLElement | null = null;
      if (sidebarTitleEl) {
        const r = sidebarTitleEl.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          anchorEl = sidebarTitleEl;
        }
      }
      if (!anchorEl && topBarTitleEl) {
        anchorEl = topBarTitleEl;
      }

      if (anchorEl) {
        const rect = anchorEl.getBoundingClientRect();
        let left = rect.left;
        if (left + PANEL_WIDTH > window.innerWidth - MARGIN) {
          left = window.innerWidth - MARGIN - PANEL_WIDTH;
        }
        if (left < MARGIN) {
          left = MARGIN;
        }
        const top = rect.bottom + GAP;
        setAnchorStyle({ left, top });
      } else {
        setAnchorStyle(null);
      }
    };

    if (isOpen) {
      updateAnchor();
      window.addEventListener('resize', updateAnchor);
    }

    return () => {
      window.removeEventListener('resize', updateAnchor);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setSearchValue('');
    }
  }, [isOpen]);

  if (!chatStore) {
    return <div>Loading...</div>;
  }

  return (
    <AnimatePresence>
      {isOpen && anchorStyle && (
        <>
          {/* alert dialog */}
          <AlertDialog
            isOpen={deleteModalOpen}
            onClose={() => setDeleteModalOpen(false)}
            onConfirm={confirmDelete}
            title={t('layout.delete-task')}
            message={t('layout.are-you-sure-you-want-to-delete')}
            confirmText={t('layout.delete')}
            cancelText={t('layout.cancel')}
          />
          {/* background cover */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-transparent"
            onClick={close}
          />
          {/* Project panel below project title (sidebar when expanded, else TopBar) */}
          <motion.div
            initial={false}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -8, opacity: 0 }}
            transition={{ type: 'spring', damping: 22, stiffness: 220 }}
            onMouseLeave={close}
            ref={panelRef}
            className="fixed z-50 flex max-h-[80vh] w-[360px] flex-col overflow-hidden rounded-xl bg-ds-bg-neutral-subtle-default p-2 shadow-perfect"
            style={{
              left: anchorStyle.left,
              top: anchorStyle.top,
            }}
          >
            <div className="flex items-center justify-between py-2 pl-2">
              {/* Search */}
              <SearchInput value={searchValue} onChange={handleSearch} />
              <Button variant="ghost" size="md" onClick={createChat}>
                <Plus className="duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)] h-8 w-8 text-ds-icon-neutral-muted-default transition-colors group-hover:text-ds-icon-neutral-default-default" />
              </Button>
            </div>
            <div className="scrollbar-hide mt-2 min-h-0 flex-1 overflow-y-auto">
              <div className="flex flex-col gap-3 px-sm">
                {visibleProjects.map((project) => (
                  <div
                    key={project.id}
                    onClick={() => {
                      projectStore.setActiveProject(project.id);
                      navigate(`/`);
                      close();
                    }}
                    className="duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)] relative flex w-full max-w-full cursor-pointer items-center justify-between gap-sm rounded-xl border border-solid border-ds-border-neutral-subtle-default bg-ds-bg-neutral-default-default px-4 py-3 shadow-history-item transition-colors hover:bg-ds-bg-neutral-default-hover"
                  >
                    {project.isRunning ? (
                      <FolderClock className="h-5 w-5 flex-shrink-0 text-ds-icon-status-running-default-default" />
                    ) : (
                      <FolderCheck className="h-5 w-5 flex-shrink-0 text-ds-icon-neutral-subtle-default" />
                    )}

                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <TooltipSimple
                        align="start"
                        className="pointer-events-auto w-[300px] select-text text-wrap break-words bg-ds-bg-neutral-default-default p-2 text-label-xs shadow-perfect"
                        content={
                          <div>{project.name || t('layout.new-project')}</div>
                        }
                      >
                        <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-body-sm font-semibold text-ds-text-neutral-default-default">
                          {project.name || t('layout.new-project')}
                        </span>
                      </TooltipSimple>
                    </div>

                    <div className="flex flex-shrink-0 items-center gap-2">
                      <TooltipSimple content={t('chat.token')}>
                        <Tag
                          variant="primary"
                          tone="information"
                          emphasis="default"
                          size="xs"
                          className="gap-1.5"
                        >
                          <img src={tokenIcon} alt="" className="h-3 w-3" />
                          <span className="text-label-xs">
                            {formatTokenCount(project.totalTokens)}
                          </span>
                        </Tag>
                      </TooltipSimple>

                      <TooltipSimple content={t('layout.tasks')}>
                        <Tag
                          variant="primary"
                          tone="default"
                          emphasis="default"
                          size="xs"
                          className="gap-1.5"
                        >
                          <ListChecks className="h-3 w-3" />
                          <span className="text-label-xs">
                            {formatCompactCount(project.taskCount)}
                          </span>
                        </Tag>
                      </TooltipSimple>
                    </div>

                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          size="icon"
                          onClick={(e) => e.stopPropagation()}
                          variant="ghost"
                          className="flex-shrink-0"
                        >
                          <Ellipsis
                            size={16}
                            className="text-ds-text-neutral-default-default"
                          />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[98px] rounded-[12px] border border-solid border-ds-border-neutral-default-default bg-ds-bg-neutral-default-default p-sm">
                        <div className="space-y-1">
                          <PopoverClose asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="w-full"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleShare(project.id);
                              }}
                            >
                              <Share size={16} />
                              {t('layout.share')}
                            </Button>
                          </PopoverClose>

                          <PopoverClose asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="w-full"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(project.id);
                              }}
                            >
                              <Trash2
                                size={16}
                                className="text-ds-icon-neutral-default-default group-hover:text-ds-icon-status-error-default-default"
                              />
                              {t('layout.delete')}
                            </Button>
                          </PopoverClose>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
