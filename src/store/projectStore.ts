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

import { generateUniqueId } from '@/lib';
import type { SessionNavLeadPresentation } from '@/lib/sessionNavLead';
import { getSessionNavLeadPresentation } from '@/lib/sessionNavLead';
import { isPlaceholderProjectName } from '@/lib/spaceLabel';
import { ChatTaskStatus } from '@/types/constants';
import { create } from 'zustand';
import {
  createChatStoreInstance,
  hasActiveSSEConnection,
  VanillaChatStore,
} from './chatStore';
import { usePageTabStore } from './pageTabStore';
import { useSpaceStore, type SpaceProjectMeta } from './spaceStore';

export enum ProjectType {
  NORMAL = 'normal',
  REPLAY = 'replay',
}

export type ProjectMode = 'single-agent' | 'workforce';
export type ProjectWorkdirMode =
  | 'worktree'
  | 'copy'
  | 'direct-write'
  | 'artifact-only';

interface TaskQueue {
  task_id: string;
  run_id?: string;
  content: string;
  timestamp: number;
  attaches: File[];
  executionId?: string;
  triggerTaskId?: string;
  triggerId?: number;
  triggerName?: string;
  processing?: boolean;
}

/**
 * Model selection captured for a Project so follow-up runs reuse the same
 * model instead of the global default. Field names mirror the provider /
 * history payloads (`model_platform`, `model_type`) and authStore state
 * (`modelType`, `cloud_model_type`, `codex_model_type`).
 */
interface ProjectModelSelection {
  modelType: 'cloud' | 'local' | 'custom' | 'codex_subscription';
  cloud_model_type?: string;
  codex_model_type?: string;
  provider_id?: number;
  model_platform?: string;
  model_type?: string;
}

interface ProjectMetadata {
  tags?: string[];
  priority?: 'low' | 'medium' | 'high';
  status?: 'active' | 'completed' | 'archived';
  achievedAt?: number | null;
  legacyRootPath?: string | null;
  baseSnapshotId?: string | null;
  legacyAlias?: string;
  workdirProbe?: {
    probedAt: number;
    preferredWorkdirMode?: ProjectWorkdirMode;
    actualWorkdirMode?: ProjectWorkdirMode;
    reason?: string;
  };
  /**Save history id for replay reuse purposes.
   * TODO(history): Remove historyId handling to support per projectId
   * instead in history api
   */
  historyId?: string;
  historyDisplayName?: string;
  /** Per-Project model pin; reused by startTask for follow-up runs. */
  modelSelection?: ProjectModelSelection;
  serverSynced?: boolean;
  autoCreatedPlaceholder?: boolean;
}

interface Project {
  id: string;
  spaceId?: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  mode?: ProjectMode | null;
  workdirMode?: ProjectWorkdirMode | null;
  // PR-X4 bridge: a Project is the durable session and new Runs append to the
  // primary chatStore. The map stays for old persisted Projects until the
  // runtime store is fully migrated.
  chatStores: { [chatId: string]: VanillaChatStore };
  chatStoreTimestamps: { [chatId: string]: number };
  activeChatId: string | null;
  queuedMessages: Array<TaskQueue>; // Project-level queued messages
  metadata?: ProjectMetadata;
}

const statusFromProject = (project: Project): 'active' | 'archived' =>
  project.metadata?.status === 'archived' ? 'archived' : 'active';

const projectToSpaceProjectMeta = (
  project: Project
): SpaceProjectMeta | null => {
  if (!project.spaceId) return null;
  return {
    id: project.id,
    spaceId: project.spaceId,
    name: project.name,
    description: project.description,
    mode: project.mode ?? null,
    workdirMode: project.workdirMode ?? null,
    status: statusFromProject(project),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    metadata: project.metadata,
  };
};

const projectShellFromMeta = (meta: SpaceProjectMeta): Project => ({
  id: meta.id,
  spaceId: meta.spaceId,
  name: meta.name,
  description: meta.description,
  createdAt: meta.createdAt,
  updatedAt: meta.updatedAt,
  mode: meta.mode ?? null,
  workdirMode: meta.workdirMode ?? null,
  chatStores: {},
  chatStoreTimestamps: {},
  activeChatId: null,
  queuedMessages: [],
  metadata: {
    ...meta.metadata,
    status: meta.metadata?.status ?? meta.status,
    serverSynced: true,
  },
});

const mergeProjectMeta = (
  existing: Project | undefined,
  meta: SpaceProjectMeta
): Project => {
  const shell = projectShellFromMeta(meta);
  if (!existing) return shell;
  const shouldKeepExistingName =
    isPlaceholderProjectName(meta.name, meta.id) &&
    !isPlaceholderProjectName(existing.name, existing.id);
  return {
    ...existing,
    spaceId: meta.spaceId,
    name: shouldKeepExistingName ? existing.name : meta.name || existing.name,
    description: meta.description ?? existing.description,
    mode: meta.mode ?? existing.mode ?? null,
    workdirMode: meta.workdirMode ?? existing.workdirMode ?? null,
    metadata: {
      ...existing.metadata,
      ...meta.metadata,
      status: meta.metadata?.status ?? meta.status,
      serverSynced: true,
    },
    updatedAt: meta.updatedAt,
  };
};

const getPrimaryChatId = (project: Project): string | null => {
  if (project.activeChatId && project.chatStores[project.activeChatId]) {
    return project.activeChatId;
  }

  const chatIds = Object.keys(project.chatStores);
  if (chatIds.length === 0) return null;

  return chatIds.sort(
    (a, b) =>
      (project.chatStoreTimestamps?.[a] ?? project.createdAt) -
      (project.chatStoreTimestamps?.[b] ?? project.createdAt)
  )[0];
};

const upsertSpaceProjectMetaFromProject = (project: Project) => {
  const meta = projectToSpaceProjectMeta(project);
  if (meta) {
    useSpaceStore.getState().upsertProjectMetas([meta]);
  }
};

interface CreateProjectOptions {
  spaceId?: string;
  mode?: ProjectMode | null;
  workdirMode?: ProjectWorkdirMode | null;
  metadata?: Partial<ProjectMetadata>;
  createdAt?: number;
  updatedAt?: number;
}

interface ProjectStore {
  activeProjectId: string | null;
  projects: { [projectId: string]: Project };
  /** Preloaded sidebar icon state from history (stable while hydrating). */
  navLeadByProjectId: Record<string, SessionNavLeadPresentation>;
  /**
   * Projects whose IDB cache was just detected stale during this session.
   * The in-memory hydrated state keeps rendering (so the current view is
   * not interrupted), but every active-project transition evicts the
   * entry so the next selection falls through to a fresh history load.
   */
  staleProjectIds: Set<string>;
  /**
   * Drop a project's runtime state (chatStores + nav lead) **without**
   * removing its SpaceProjectMeta. Used by the stale-cache eviction path:
   * we want the project to keep showing up in the sidebar and Spaces Hub,
   * just with no in-memory state, so the next selection re-runs the
   * history load. Distinct from `removeProject`, which also tears down
   * the Space metadata and is intended for genuine project deletion.
   */
  _evictProjectRuntime: (projectId: string) => void;
  /**
   * If `activeProjectId` is currently in `staleProjectIds` and we are
   * transitioning to a different project (or to null), evict the runtime
   * state of the outgoing one. Call this immediately before any direct
   * write to `activeProjectId` so all transition paths (`setActiveProject`,
   * `createProject`) honour the stale-eviction contract.
   */
  _evictStaleOnTransition: (nextProjectId: string | null) => void;

  // Project management
  /**
   *
   * @param name
   * @param description
   * @param projectId
   * @param type
   * @param historyId
   * @returns projectId
   */
  createProject: (
    name: string,
    description?: string,
    projectId?: string,
    type?: ProjectType,
    historyId?: string,
    setActive?: boolean,
    options?: CreateProjectOptions
  ) => string;
  setActiveProject: (projectId: string | null) => void;
  setActiveSpaceAndProject: (spaceId: string, projectId: string) => void;
  setProjectSpace: (projectId: string, spaceId: string) => void;
  cleanupAutoCreatedEmptyProjects: () => void;
  removeProject: (projectId: string) => void;
  updateProject: (
    projectId: string,
    updates: Partial<Omit<Project, 'id' | 'createdAt'>>
  ) => void;
  setProjectNavLead: (
    projectId: string,
    lead: SessionNavLeadPresentation
  ) => void;
  setProjectNavLeads: (
    leads: Record<string, SessionNavLeadPresentation>
  ) => void;

  // Project-level queued messages management
  addQueuedMessage: (
    projectId: string,
    content: string,
    attaches: File[],
    task_id?: string,
    executionId?: string,
    triggerTaskId?: string,
    triggerId?: number,
    triggerName?: string
  ) => string | null;
  removeQueuedMessage: (projectId: string, taskId: string) => TaskQueue;
  restoreQueuedMessage: (projectId: string, messageData: TaskQueue) => void;
  clearQueuedMessages: (projectId: string) => void;
  markQueuedMessageAsProcessing: (projectId: string, taskId: string) => void;

  // Chat store state management
  createChatStore: (projectId: string, chatName?: string) => string | null;
  appendInitChatStore: (
    projectId: string,
    customTaskId?: string,
    chatName?: string
  ) => { taskId: string; chatStore: VanillaChatStore } | null;
  setActiveChatStore: (projectId: string, chatId: string) => void;
  removeChatStore: (projectId: string, chatId: string) => void;
  saveChatStore: (
    projectId: string,
    chatId: string,
    state: VanillaChatStore
  ) => void;
  getChatStore: (
    projectId?: string,
    chatId?: string
  ) => VanillaChatStore | null;
  /**
   * Pure read helper for render paths. It never creates a Project or chat store.
   * Use this when missing runtime state should render as empty/loading.
   */
  peekActiveChatStore: (projectId?: string) => VanillaChatStore | null;
  /**
   * Pure read helper for the active Project. Project/chat creation must happen
   * through explicit user actions or `appendInitChatStore`, not from render.
   */
  getActiveChatStore: (projectId?: string) => VanillaChatStore | null;
  getAllChatStores: (
    projectId: string
  ) => Array<{ chatId: string; chatStore: VanillaChatStore }>;

  // Utility methods
  getAllProjects: (spaceId?: string) => Project[];
  getProjectById: (projectId: string) => Project | null;
  getProjectTotalTokens: (projectId: string) => number;
  isEmptyProject: (project: Project) => boolean;

  //History ID
  setHistoryId: (projectId: string, historyId: string) => void;
  getHistoryId: (projectId: string | null) => string | null;

  // Per-Project model selection
  setProjectModel: (
    projectId: string,
    modelSelection: ProjectModelSelection
  ) => void;
  getProjectModel: (projectId: string | null) => ProjectModelSelection | null;
}

// Helper function to check if a project is empty/unused
const isEmptyProject = (project: Project): boolean => {
  try {
    // Check if project has only one chat store
    const chatStoreIds = Object.keys(project.chatStores);
    if (chatStoreIds.length !== 1) {
      return false;
    }

    const chatStore = project.chatStores[chatStoreIds[0]];
    if (!chatStore || !chatStore.getState) {
      return false;
    }

    const chatState = chatStore.getState();
    const taskIds = Object.keys(chatState.tasks);

    // Check if chat store has only one task
    if (taskIds.length !== 1) {
      return false;
    }

    const task = chatState.tasks[taskIds[0]];
    if (!task) {
      return false;
    }

    // Check if project has any queued messages
    if (project.queuedMessages && project.queuedMessages.length > 0) {
      return false;
    }

    // Check if task is in initial/empty state
    const isEmpty =
      Array.isArray(task.messages) &&
      task.messages.length === 0 &&
      task.summaryTask === '' &&
      task.progressValue === 0 &&
      task.isPending === false &&
      task.status === ChatTaskStatus.PENDING &&
      task.taskTime === 0 &&
      task.tokens === 0 &&
      task.elapsed === 0 &&
      task.hasWaitComfirm === false;

    return isEmpty;
  } catch (error) {
    console.warn('[store] Error checking if project is empty:', error);
    return false;
  }
};

const normalizedText = (value?: string | null) =>
  (value ?? '').trim().toLowerCase();

const isAutoCreatedEmptyProject = (project: Project): boolean =>
  project.metadata?.serverSynced !== true &&
  (project.metadata?.autoCreatedPlaceholder === true ||
    (normalizedText(project.name) === 'new project' &&
      normalizedText(project.description) === 'auto-created project')) &&
  isEmptyProject(project);

const projectStore = create<ProjectStore>()((set, get) => ({
  activeProjectId: null,
  projects: {},
  navLeadByProjectId: {},
  staleProjectIds: new Set<string>(),

  setProjectNavLead: (projectId, lead) =>
    set((state) => ({
      navLeadByProjectId: {
        ...state.navLeadByProjectId,
        [projectId]: lead,
      },
    })),

  setProjectNavLeads: (leads) =>
    set((state) => {
      const next = { ...state.navLeadByProjectId };
      for (const [projectId, lead] of Object.entries(leads)) {
        // Don't clobber a live lead: if the project already has an active
        // chat store the subscription registry is maintaining a real-time
        // lead (running spinner, etc.) that the history summary cannot know
        // about.
        const project = state.projects[projectId];
        const hasLiveStore = Boolean(
          project &&
          (project.activeChatId
            ? project.chatStores[project.activeChatId]
            : Object.keys(project.chatStores ?? {}).length > 0)
        );
        if (!hasLiveStore) {
          next[projectId] = lead;
        }
      }
      return { navLeadByProjectId: next };
    }),

  createProject: (
    name: string,
    description?: string,
    projectId?: string,
    type?: ProjectType,
    historyId?: string,
    setActive: boolean = true,
    options?: CreateProjectOptions
  ) => {
    const resolvedSpaceId =
      options?.spaceId ?? useSpaceStore.getState().activeSpaceId ?? undefined;

    // Project is the session container in the Space IA. Explicit "New Project"
    // actions must always create a fresh container instead of silently focusing
    // an existing empty one.
    const targetProjectId = projectId ?? generateUniqueId();
    const now = Date.now();
    const createdAt = options?.createdAt ?? now;
    const updatedAt = options?.updatedAt ?? now;

    // Create initial chat store for the project
    const initialChatId = generateUniqueId();
    const initialChatStore = createChatStoreInstance();

    // Initialize the chat store with a task using the create() function
    if (type !== ProjectType.REPLAY) initialChatStore.getState().create();

    // Create new project with default chat store
    const newProject: Project = {
      id: targetProjectId,
      spaceId: resolvedSpaceId,
      name,
      description,
      createdAt,
      updatedAt,
      mode: options?.mode ?? null,
      workdirMode: options?.workdirMode ?? null,
      chatStores: {
        [initialChatId]: initialChatStore,
      },
      chatStoreTimestamps: {
        [initialChatId]: now,
      },
      activeChatId: initialChatId,
      queuedMessages: [], // Initialize empty queued messages array
      metadata: {
        status: 'active',
        historyId: historyId,
        tags: type === ProjectType.REPLAY ? ['replay'] : [],
        ...(description === 'Auto-created project'
          ? { autoCreatedPlaceholder: true }
          : {}),
        ...options?.metadata,
      },
    };

    console.log('[store] Creating a new project');
    // Evict stale runtime state of the outgoing active project before we
    // overwrite activeProjectId — `setActiveProject` is bypassed here so
    // we must invoke the eviction contract ourselves.
    if (setActive) {
      get()._evictStaleOnTransition(targetProjectId);
    }
    set((state) => ({
      projects: {
        ...state.projects,
        [targetProjectId]: newProject,
      },
      ...(setActive ? { activeProjectId: targetProjectId } : {}),
    }));
    upsertSpaceProjectMetaFromProject(newProject);

    return targetProjectId;
  },

  setActiveProject: (projectId: string | null) => {
    // Stale-cache eviction: if the outgoing active project was a stale-
    // hydrated entry, drop its runtime state so the next selection forces
    // a fresh history load. Keeps the Space metadata intact so the
    // project still shows up in the sidebar.
    get()._evictStaleOnTransition(projectId);

    if (!projectId) {
      set({ activeProjectId: null });
      return;
    }

    const { projects } = get();
    const meta = useSpaceStore.getState().getProjectMeta(projectId);

    if (!projects[projectId]) {
      if (!meta) {
        console.warn(`Project ${projectId} not found`);
        return;
      }
      set((state) => ({
        projects: {
          ...state.projects,
          [projectId]: projectShellFromMeta(meta),
        },
      }));
    } else if (meta) {
      set((state) => ({
        projects: {
          ...state.projects,
          [projectId]: mergeProjectMeta(state.projects[projectId], meta),
        },
      }));
    }
    const project = get().projects[projectId];
    const projectSpaceId = project?.spaceId;
    if (projectSpaceId) {
      const spaceStore = useSpaceStore.getState();
      if (spaceStore.getSpaceById(projectSpaceId)) {
        spaceStore.setActiveSpace(projectSpaceId);
        spaceStore.setLastVisitedProject(projectSpaceId, projectId);
      }
    }

    set({ activeProjectId: projectId });

    // Update project's updatedAt
    set((state) => ({
      projects: {
        ...state.projects,
        [projectId]: {
          ...state.projects[projectId],
          updatedAt: Date.now(),
        },
      },
    }));
  },

  setActiveSpaceAndProject: (spaceId: string, projectId: string) => {
    const { projects } = get();
    if (!projects[projectId]) {
      console.warn(`Project ${projectId} not found`);
      return;
    }
    useSpaceStore.getState().setActiveSpace(spaceId);
    get().setActiveProject(projectId);
  },

  setProjectSpace: (projectId: string, spaceId: string) => {
    const { projects } = get();

    if (!projects[projectId]) {
      console.warn(`Project ${projectId} not found`);
      return;
    }

    set((state) => ({
      projects: {
        ...state.projects,
        [projectId]: {
          ...state.projects[projectId],
          spaceId,
          updatedAt: Date.now(),
        },
      },
    }));
    const updatedProject = get().projects[projectId];
    if (updatedProject) {
      upsertSpaceProjectMetaFromProject(updatedProject);
    }
  },

  cleanupAutoCreatedEmptyProjects: () => {
    const { projects, activeProjectId } = get();
    const projectIdsToRemove = Object.values(projects)
      .filter(isAutoCreatedEmptyProject)
      .map((project) => project.id);

    if (projectIdsToRemove.length === 0) return;

    const removedIds = new Set(projectIdsToRemove);
    const nextProjects = { ...projects };
    for (const projectId of projectIdsToRemove) {
      delete nextProjects[projectId];
      usePageTabStore.getState().removeSessionPreviewProject(projectId);
      useSpaceStore.getState().removeProjectMeta(projectId);
    }

    set((state) => {
      // Drop any leftover stale flags for ids that just disappeared.
      // Auto-created blank projects don't normally end up in
      // staleProjectIds, but staying defensive keeps the lifecycle rule
      // ("permanent runtime removal clears the stale flag") consistent.
      let nextStale = state.staleProjectIds;
      for (const projectId of removedIds) {
        if (nextStale.has(projectId)) {
          if (nextStale === state.staleProjectIds) {
            nextStale = new Set(nextStale);
          }
          nextStale.delete(projectId);
        }
      }
      return {
        projects: nextProjects,
        activeProjectId:
          activeProjectId && removedIds.has(activeProjectId)
            ? null
            : activeProjectId,
        staleProjectIds: nextStale,
      };
    });

    console.warn(
      `[ProjectStore] Removed ${projectIdsToRemove.length} auto-created empty Project(s).`
    );
  },

  createChatStore: (projectId: string, _chatName?: string) => {
    const { projects } = get();

    if (!projects[projectId]) {
      console.warn(`Project ${projectId} not found`);
      return null;
    }

    const existingPrimaryChatId = getPrimaryChatId(projects[projectId]);
    if (existingPrimaryChatId) {
      set((state) => ({
        projects: {
          ...state.projects,
          [projectId]: {
            ...state.projects[projectId],
            activeChatId: existingPrimaryChatId,
            updatedAt: Date.now(),
          },
        },
      }));
      return existingPrimaryChatId;
    }

    const chatId = generateUniqueId();
    const newChatStore = createChatStoreInstance();
    const now = Date.now();

    set((state) => ({
      projects: {
        ...state.projects,
        [projectId]: {
          ...state.projects[projectId],
          chatStores: {
            ...state.projects[projectId].chatStores,
            [chatId]: newChatStore,
          },
          chatStoreTimestamps: {
            ...state.projects[projectId].chatStoreTimestamps,
            [chatId]: now,
          },
          activeChatId: chatId,
          updatedAt: now,
        },
      },
    }));

    return chatId;
  },

  /**
   *
   * @param projectId project id to append a new chatStore to
   * @param customTaskId the taskId that will be used to initialize the new taskId
   * @param chatName [optional] used to give a chatName
   * @returns {taskId, chatStore} | null
   */
  appendInitChatStore: (
    projectId: string,
    customTaskId?: string,
    chatName?: string
  ) => {
    const {
      projects,
      createChatStore,
      getChatStore,
      setActiveChatStore: _setActiveChatStore,
      getProjectTotalTokens: _getProjectTotalTokens,
    } = get();

    if (!projectId) {
      console.warn('No active project found to appendNewChatStore');
      return null;
    }

    if (!projects[projectId]) {
      console.warn(`Project ${projectId} not found`);
      return null;
    }

    // Create new chat store & append in the current project
    const newChatId = createChatStore(projectId, chatName);

    if (!newChatId) {
      console.error('Failed to create new chat store');
      return null;
    }

    // Get the new chat store instance
    const newChatStore = getChatStore(projectId, newChatId);

    if (!newChatStore) {
      console.error('Failed to get new chat store instance');
      return null;
    }

    // Create a new task in the new chat store with the queued content
    const newTaskId = newChatStore.getState().create(customTaskId);

    //Set the initTask as the active taskId
    newChatStore.getState().setActiveTaskId(newTaskId);

    return { taskId: newTaskId, chatStore: newChatStore };
  },

  setActiveChatStore: (projectId: string, chatId: string) => {
    const { projects } = get();

    if (!projects[projectId]) {
      console.warn(`Project ${projectId} not found`);
      return;
    }

    if (!projects[projectId].chatStores[chatId]) {
      console.warn(`Chat ${chatId} not found in project ${projectId}`);
      return;
    }

    set((state) => ({
      projects: {
        ...state.projects,
        [projectId]: {
          ...state.projects[projectId],
          activeChatId: chatId,
          updatedAt: Date.now(),
        },
      },
    }));
  },

  removeChatStore: (projectId: string, chatId: string) => {
    const { projects } = get();

    if (!projects[projectId]) {
      console.warn(`Project ${projectId} not found`);
      return;
    }

    const project = projects[projectId];
    const chatStoreKeys = Object.keys(project.chatStores);

    // Don't allow removing the last chat store
    if (chatStoreKeys.length === 1) {
      console.warn('Cannot remove the last chat store from a project');
      return;
    }

    if (!project.chatStores[chatId]) {
      console.warn(`Chat ${chatId} not found in project ${projectId}`);
      return;
    }

    // If removing the active chat, switch to another one
    let newActiveChatId = project.activeChatId;
    if (project.activeChatId === chatId) {
      const remainingChats = chatStoreKeys.filter((id) => id !== chatId);
      newActiveChatId = remainingChats[0];
    }

    set((state) => {
      const newChatStores = { ...state.projects[projectId].chatStores };
      delete newChatStores[chatId];

      return {
        projects: {
          ...state.projects,
          [projectId]: {
            ...state.projects[projectId],
            chatStores: newChatStores,
            activeChatId: newActiveChatId,
            updatedAt: Date.now(),
          },
        },
      };
    });
  },

  _evictProjectRuntime: (projectId: string) => {
    set((state) => {
      const hasProject = !!state.projects[projectId];
      const hasStaleFlag = state.staleProjectIds.has(projectId);
      if (!hasProject && !hasStaleFlag) return state;

      const update: Partial<ProjectStore> = {};
      if (hasProject) {
        const nextProjects = { ...state.projects };
        delete nextProjects[projectId];
        update.projects = nextProjects;
        const nextNavLeadByProjectId = { ...state.navLeadByProjectId };
        delete nextNavLeadByProjectId[projectId];
        update.navLeadByProjectId = nextNavLeadByProjectId;
      }
      // Clearing the stale flag belongs to this helper, not the caller — if
      // the same project id is re-created later (removeProject(id) then
      // createProject(id, …)), a leftover entry in staleProjectIds would cause
      // the *fresh* runtime to be incorrectly evicted on the next transition.
      if (hasStaleFlag) {
        const nextStale = new Set(state.staleProjectIds);
        nextStale.delete(projectId);
        update.staleProjectIds = nextStale;
      }
      // Deliberately leave activeProjectId alone — every caller of this
      // helper is in the middle of a transition and will overwrite it.
      return update;
    });
  },

  _evictStaleOnTransition: (nextProjectId: string | null) => {
    const previousProjectId = get().activeProjectId;
    if (
      !previousProjectId ||
      previousProjectId === nextProjectId ||
      !get().staleProjectIds.has(previousProjectId)
    ) {
      return;
    }
    // Never evict a project that still has a live run. Eviction drops the
    // runtime chat stores, so returning to the project rebuilds it from
    // history and replays the ongoing task id -- which aborts the live
    // run's stream and kills the run on the backend. Keep the stale flag
    // so the eviction simply happens on a later, safe transition.
    const outgoingProject = get().projects[previousProjectId];
    const outgoingTaskIds = Object.values(
      outgoingProject?.chatStores ?? {}
    ).flatMap((chatStore) => Object.keys(chatStore.getState().tasks));
    if (hasActiveSSEConnection(outgoingTaskIds)) {
      return;
    }
    // _evictProjectRuntime handles staleProjectIds cleanup itself.
    get()._evictProjectRuntime(previousProjectId);
  },

  removeProject: (projectId: string) => {
    const { activeProjectId, projects } = get();

    if (!projects[projectId]) {
      console.warn(`Project ${projectId} not found`);
      return;
    }

    const newActiveId = activeProjectId === projectId ? null : activeProjectId;

    set((state) => {
      const newProjects = { ...state.projects };
      delete newProjects[projectId];
      const nextNavLeadByProjectId = { ...state.navLeadByProjectId };
      delete nextNavLeadByProjectId[projectId];
      // Drop any leftover stale flag for this id so a future recreation
      // (same id, different runtime) does not inherit the eviction signal.
      let nextStale = state.staleProjectIds;
      if (nextStale.has(projectId)) {
        nextStale = new Set(nextStale);
        nextStale.delete(projectId);
      }

      return {
        projects: newProjects,
        activeProjectId: newActiveId,
        navLeadByProjectId: nextNavLeadByProjectId,
        staleProjectIds: nextStale,
      };
    });
    usePageTabStore.getState().removeSessionPreviewProject(projectId);
    useSpaceStore.getState().removeProjectMeta(projectId);
  },

  updateProject: (
    projectId: string,
    updates: Partial<Omit<Project, 'id' | 'createdAt'>>
  ) => {
    set((state) => ({
      projects: {
        ...state.projects,
        [projectId]: {
          ...state.projects[projectId],
          ...updates,
          metadata:
            updates.metadata === undefined
              ? state.projects[projectId].metadata
              : {
                  ...state.projects[projectId].metadata,
                  ...updates.metadata,
                },
          updatedAt: Date.now(),
        },
      },
    }));
    const updatedProject = get().projects[projectId];
    if (updatedProject) {
      upsertSpaceProjectMetaFromProject(updatedProject);
    }
  },

  saveChatStore: (
    projectId: string,
    chatId: string,
    state: VanillaChatStore
  ) => {
    const { projects } = get();

    if (projects[projectId] && projects[projectId].chatStores[chatId]) {
      set((currentState) => ({
        projects: {
          ...currentState.projects,
          [projectId]: {
            ...currentState.projects[projectId],
            chatStores: {
              ...currentState.projects[projectId].chatStores,
              [chatId]: state,
            },
            updatedAt: Date.now(),
          },
        },
      }));
    }
  },

  getChatStore: (projectId?: string, chatId?: string) => {
    const { projects, activeProjectId } = get();

    // Use provided projectId or fall back to activeProjectId
    const targetProjectId = projectId || activeProjectId;

    if (targetProjectId && projects[targetProjectId]) {
      const project = projects[targetProjectId];

      // Use provided chatId or fall back to activeChatId
      const targetChatId = chatId || project.activeChatId;

      if (targetChatId && project.chatStores[targetChatId]) {
        return project.chatStores[targetChatId];
      }

      // If no active chat or chat not found, return the first available one
      const chatStoreKeys = Object.keys(project.chatStores);
      if (chatStoreKeys.length > 0) {
        return project.chatStores[chatStoreKeys[0]];
      }
    }

    return null;
  },

  peekActiveChatStore: (projectId?: string) => {
    const { projects, activeProjectId } = get();
    const targetProjectId = projectId || activeProjectId;
    if (!targetProjectId) return null;
    const project = projects[targetProjectId];
    if (!project) return null;

    if (project.activeChatId && project.chatStores[project.activeChatId]) {
      return project.chatStores[project.activeChatId];
    }

    const firstChatId = Object.keys(project.chatStores || {})[0];
    return firstChatId ? project.chatStores[firstChatId] : null;
  },

  getActiveChatStore: (projectId?: string) => {
    const { projects, activeProjectId } = get();

    const targetProjectId = projectId || activeProjectId;

    if (targetProjectId && projects[targetProjectId]) {
      const project = projects[targetProjectId];

      if (project.activeChatId && project.chatStores[project.activeChatId]) {
        return project.chatStores[project.activeChatId];
      }

      const chatStoreKeys = Object.keys(project.chatStores);
      if (chatStoreKeys.length > 0) {
        return project.chatStores[chatStoreKeys[0]];
      }
    }

    return null;
  },

  // Project-level queued messages management
  addQueuedMessage: (
    projectId: string,
    content: string,
    attaches: File[],
    task_id?: string,
    executionId?: string,
    triggerTaskId?: string,
    triggerId?: number,
    triggerName?: string
  ) => {
    const { projects } = get();

    if (!projects[projectId]) {
      console.warn(`Project ${projectId} not found`);
      return null;
    }

    // Check if message with same executionId already exists to avoid duplicates
    if (executionId) {
      const existingMessage = projects[projectId].queuedMessages.find(
        (m) => m.executionId === executionId
      );
      if (existingMessage) {
        console.warn(
          `[addQueuedMessage] Message with executionId ${executionId} already queued, skipping duplicate`
        );
        return existingMessage.task_id;
      }
    }

    const new_task_id = generateUniqueId();
    const actual_task_id = task_id || new_task_id;

    set((state) => ({
      projects: {
        ...state.projects,
        [projectId]: {
          ...state.projects[projectId],
          queuedMessages: [
            ...state.projects[projectId].queuedMessages,
            {
              task_id: actual_task_id,
              run_id: actual_task_id,
              content,
              timestamp: Date.now(),
              attaches: [...attaches],
              executionId,
              triggerTaskId,
              triggerId,
              triggerName,
            },
          ],
          updatedAt: Date.now(),
        },
      },
    }));

    console.log(
      `[addQueuedMessage] Message added successfully: task_id=${actual_task_id}, queue length now: ${get().projects[projectId].queuedMessages.length}`
    );

    return actual_task_id;
  },

  removeQueuedMessage: (projectId: string, task_id: string) => {
    const { projects } = get();

    if (!projects[projectId]) {
      console.warn(`Project ${projectId} not found`);
      return {
        task_id: '',
        run_id: '',
        content: '',
        timestamp: 0,
        attaches: [],
      };
    }

    const messageToRemove = projects[projectId].queuedMessages.find(
      (m) => m.task_id === task_id
    );

    set((state) => ({
      projects: {
        ...state.projects,
        [projectId]: {
          ...state.projects[projectId],
          queuedMessages: state.projects[projectId].queuedMessages.filter(
            (m) => m.task_id !== task_id
          ),
          updatedAt: Date.now(),
        },
      },
    }));

    return (
      messageToRemove || {
        task_id: '',
        run_id: '',
        content: '',
        timestamp: 0,
        attaches: [],
      }
    );
  },

  // Method to restore a queued message (for error handling)
  restoreQueuedMessage: (projectId: string, messageData: TaskQueue) => {
    const { projects } = get();

    if (!projects[projectId]) {
      console.warn(`Project ${projectId} not found`);
      return;
    }

    // Check if message already exists to avoid duplicates
    const existingMessage = projects[projectId].queuedMessages.find(
      (m) => m.task_id === messageData.task_id
    );
    if (existingMessage) {
      console.warn(
        `Message with task_id ${messageData.task_id} already exists`
      );
      return;
    }

    set((state) => ({
      projects: {
        ...state.projects,
        [projectId]: {
          ...state.projects[projectId],
          queuedMessages: [
            ...state.projects[projectId].queuedMessages,
            {
              ...messageData,
              run_id: messageData.run_id || messageData.task_id,
            },
          ],
          updatedAt: Date.now(),
        },
      },
    }));
  },

  clearQueuedMessages: (projectId: string) => {
    const { projects } = get();

    if (!projects[projectId]) {
      console.warn(`Project ${projectId} not found`);
      return;
    }

    set((state) => ({
      projects: {
        ...state.projects,
        [projectId]: {
          ...state.projects[projectId],
          queuedMessages: [],
          updatedAt: Date.now(),
        },
      },
    }));
  },

  markQueuedMessageAsProcessing: (projectId: string, taskId: string) => {
    const { projects } = get();

    if (!projects[projectId]) {
      console.warn(`Project ${projectId} not found`);
      return;
    }

    const message = projects[projectId].queuedMessages.find(
      (m) => m.task_id === taskId
    );

    if (!message) {
      console.warn(
        `Message with task_id ${taskId} not found in project ${projectId}`
      );
      return;
    }

    set((state) => ({
      projects: {
        ...state.projects,
        [projectId]: {
          ...state.projects[projectId],
          queuedMessages: state.projects[projectId].queuedMessages.map((m) =>
            m.task_id === taskId ? { ...m, processing: true } : m
          ),
          updatedAt: Date.now(),
        },
      },
    }));

    console.log(
      `[ProjectStore] Marked message as processing: ${taskId} in project ${projectId}`
    );
  },

  getAllChatStores: (projectId: string) => {
    const { projects } = get();

    if (projects[projectId]) {
      const project = projects[projectId];
      const chatStoreEntries = Object.entries(project.chatStores);

      // Sort by creation timestamp (oldest first)
      return chatStoreEntries
        .map(([chatId, chatStore]) => ({
          chatId,
          chatStore,
          createdAt: project.chatStoreTimestamps?.[chatId] || 0,
        }))
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(({ chatId, chatStore }) => ({
          chatId,
          chatStore,
        }));
    }

    return [];
  },

  getAllProjects: (spaceId?: string) => {
    const { projects } = get();
    const spaceStore = useSpaceStore.getState();
    const metaProjects = spaceStore
      .getProjectsForSpace(spaceId)
      .map((meta) => mergeProjectMeta(projects[meta.id], meta));
    const metaProjectIds = new Set(metaProjects.map((project) => project.id));
    const localOnlyProjects = Object.values(projects).filter(
      (project) =>
        !metaProjectIds.has(project.id) &&
        project.metadata?.serverSynced !== true &&
        (!spaceId ||
          project.spaceId === spaceId ||
          (!project.spaceId && spaceId.startsWith('legacy_')))
    );
    return [...metaProjects, ...localOnlyProjects].sort(
      (a, b) => b.createdAt - a.createdAt
    );
  },

  getProjectById: (projectId: string) => {
    const { projects } = get();
    let project: Project | null = projects[projectId] || null;
    if (!project) {
      const meta = useSpaceStore.getState().getProjectMeta(projectId);
      project = meta ? projectShellFromMeta(meta) : null;
    } else {
      const meta = useSpaceStore.getState().getProjectMeta(projectId);
      if (meta) {
        project = mergeProjectMeta(project, meta);
      }
    }

    // Ensure backwards compatibility - add queuedMessages if it doesn't exist
    if (project && !project.queuedMessages) {
      project.queuedMessages = [];
    }
    if (project?.queuedMessages) {
      project.queuedMessages = project.queuedMessages.map((message) => ({
        ...message,
        run_id: message.run_id || message.task_id,
      }));
    }

    // Ensure backwards compatibility - add chatStoreTimestamps if it doesn't exist
    if (project && !project.chatStoreTimestamps) {
      project.chatStoreTimestamps = {};
      // Initialize timestamps for existing chat stores with project creation time
      Object.keys(project.chatStores).forEach((chatId) => {
        project.chatStoreTimestamps[chatId] = project.createdAt;
      });
    }

    return project;
  },

  getProjectTotalTokens: (projectId: string) => {
    const { projects } = get();
    const project = projects[projectId];

    if (!project) {
      console.warn(`Project ${projectId} not found for token calculation`);
      return 0;
    }

    let totalTokens = 0;

    // Iterate through all chat stores in the project
    Object.values(project.chatStores).forEach((chatStore) => {
      if (chatStore && chatStore.getState) {
        const chatState = chatStore.getState();
        // Iterate through all tasks in the chat store
        Object.values(chatState.tasks).forEach((task) => {
          if (task && typeof task.tokens === 'number') {
            totalTokens += task.tokens;
          }
        });
      }
    });

    return totalTokens;
  },

  setHistoryId: (projectId: string, historyId: string) => {
    const { projects } = get();

    if (!projects[projectId]) {
      console.warn(`Project ${projectId} not found for setting history ID`);
      return;
    }

    set((state) => ({
      projects: {
        ...state.projects,
        [projectId]: {
          ...state.projects[projectId],
          metadata: {
            ...state.projects[projectId].metadata,
            historyId,
            serverSynced: true,
          },
          updatedAt: Date.now(),
        },
      },
    }));
    const updatedProject = get().projects[projectId];
    if (updatedProject) {
      upsertSpaceProjectMetaFromProject(updatedProject);
    }
  },

  getHistoryId: (projectId: string | null) => {
    if (!projectId) {
      console.warn(`Project id is null for getting history ID`);
      return null;
    }

    const { projects } = get();
    const project = projects[projectId];

    if (!project) {
      console.warn(`Project ${projectId} not found for getting history ID`);
      return null;
    }

    return project.metadata?.historyId || null;
  },

  setProjectModel: (
    projectId: string,
    modelSelection: ProjectModelSelection
  ) => {
    const { projects } = get();

    if (!projects[projectId]) {
      console.warn(`Project ${projectId} not found for setting model`);
      return;
    }

    const previous = projects[projectId].metadata?.modelSelection;
    if (
      previous &&
      previous.modelType === modelSelection.modelType &&
      previous.cloud_model_type === modelSelection.cloud_model_type &&
      previous.codex_model_type === modelSelection.codex_model_type &&
      previous.provider_id === modelSelection.provider_id &&
      previous.model_platform === modelSelection.model_platform &&
      previous.model_type === modelSelection.model_type
    ) {
      return;
    }

    set((state) => ({
      projects: {
        ...state.projects,
        [projectId]: {
          ...state.projects[projectId],
          metadata: {
            ...state.projects[projectId].metadata,
            modelSelection,
          },
          updatedAt: Date.now(),
        },
      },
    }));
    const updatedProject = get().projects[projectId];
    if (updatedProject) {
      upsertSpaceProjectMetaFromProject(updatedProject);
    }
  },

  getProjectModel: (projectId: string | null) => {
    if (!projectId) {
      return null;
    }

    const { projects } = get();
    const runtimeSelection = projects[projectId]?.metadata?.modelSelection;
    if (runtimeSelection) {
      return runtimeSelection;
    }

    // Runtime store is not persisted; fall back to the space meta, which is
    // persisted locally and hydrated from the server.
    return (
      useSpaceStore.getState().getProjectMeta(projectId)?.metadata
        ?.modelSelection ?? null
    );
  },

  isEmptyProject: (project: Project) => {
    return isEmptyProject(project);
  },
}));

export const useProjectStore = projectStore;

/**
 * Centralized live nav-lead subscription registry.
 *
 * For every Project that has an active chat store, subscribe to that chat
 * store and push the derived `SessionNavLeadPresentation` into
 * `navLeadByProjectId`. This makes the sidebar row icons react to live task
 * status changes (running → finished, etc.) without requiring each consumer
 * to subscribe to chat-store internals.
 *
 * The registry is reconciled whenever `projectStore.projects` changes (chat
 * store swap, project add/remove). Stale subscriptions are torn down.
 */
const navLeadSubscriptions = new Map<
  string,
  { chatStore: VanillaChatStore; unsubscribe: () => void }
>();

const navLeadsEqual = (
  a: SessionNavLeadPresentation | undefined,
  b: SessionNavLeadPresentation
) => !!a && a.kind === b.kind && a.Icon === b.Icon && a.spin === b.spin;

const pushLiveNavLead = (projectId: string, chatStore: VanillaChatStore) => {
  const chatState = chatStore.getState();
  const activeTask = chatState.activeTaskId
    ? chatState.tasks[chatState.activeTaskId]
    : undefined;
  if (!activeTask) return;
  const lead = getSessionNavLeadPresentation(activeTask);
  const current = projectStore.getState().navLeadByProjectId[projectId];
  if (navLeadsEqual(current, lead)) return;
  projectStore.getState().setProjectNavLead(projectId, lead);
};

const reconcileNavLeadSubscriptions = (state: ProjectStore) => {
  const seen = new Set<string>();
  for (const [projectId, project] of Object.entries(state.projects)) {
    const activeChatId = project.activeChatId;
    const chatStore = activeChatId
      ? project.chatStores[activeChatId]
      : Object.values(project.chatStores ?? {})[0];
    if (!chatStore) continue;
    seen.add(projectId);

    const existing = navLeadSubscriptions.get(projectId);
    if (existing?.chatStore === chatStore) continue;
    existing?.unsubscribe();

    pushLiveNavLead(projectId, chatStore);
    const unsubscribe = chatStore.subscribe(() =>
      pushLiveNavLead(projectId, chatStore)
    );
    navLeadSubscriptions.set(projectId, { chatStore, unsubscribe });
  }
  for (const [projectId, entry] of navLeadSubscriptions) {
    if (seen.has(projectId)) continue;
    entry.unsubscribe();
    navLeadSubscriptions.delete(projectId);
  }
};

projectStore.subscribe(reconcileNavLeadSubscriptions);
reconcileNavLeadSubscriptions(projectStore.getState());

if (typeof queueMicrotask === 'function') {
  queueMicrotask(() => {
    projectStore.getState().cleanupAutoCreatedEmptyProjects();
  });
}

export type {
  CreateProjectOptions,
  Project,
  ProjectMetadata,
  ProjectModelSelection,
  ProjectStore,
  TaskQueue,
};
