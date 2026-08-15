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
import { getAuthEnvironmentKey } from '@/lib/authEnvironment';
import {
  isLegacySpace,
  isPlaceholderProjectName,
  isPlaceholderSpaceNameStatic,
} from '@/lib/spaceLabel';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { usePageTabStore } from './pageTabStore';
import type {
  ProjectMetadata,
  ProjectMode,
  ProjectWorkdirMode,
} from './projectRuntimeStore';

export const SPACE_SCHEMA_VERSION = 2;
const SPACE_STORE_PERSIST_VERSION = 3;
export const DEFAULT_LOCAL_USER_ID = 'local';
const INITIAL_BLANK_SPACE_CREATED_FROM = 'initial_hydrate';

export type SpaceSourceType = 'blank' | 'folder' | 'legacy';
export type SpaceStatus = 'active' | 'disconnected' | 'archived';

export interface Space {
  id: string;
  name: string;
  description?: string;
  userId?: string;
  /**
   * The Space on the aion edge this local record stands for. Absent while the
   * create is in flight, and absent for good on a Space the edge refused — the
   * local record still works, it just holds nothing the server can file under.
   */
  aionSpaceId?: string;
  sourceType: SpaceSourceType;
  rootPath?: string | null;
  rootFingerprint?: Record<string, unknown> | null;
  status: SpaceStatus;
  schemaVersion: number;
  createdAt: number;
  updatedAt: number;
  metadata?: {
    legacy?: boolean;
    sharedMemoryEnabled?: boolean;
    preferredWorkdirMode?: 'worktree' | 'copy' | 'direct-write';
    [key: string]: unknown;
  };
}

export interface CreateSpaceInput {
  id?: string;
  name: string;
  description?: string;
  userId?: string | number | null;
  sourceType?: SpaceSourceType;
  rootPath?: string | null;
  rootFingerprint?: Record<string, unknown> | null;
  metadata?: Space['metadata'];
  setActive?: boolean;
}

export interface SpaceProjectMeta {
  id: string;
  userId?: string;
  spaceId: string;
  name: string;
  description?: string;
  mode?: ProjectMode | null;
  workdirMode?: ProjectWorkdirMode | null;
  status: 'active' | 'archived';
  createdAt: number;
  updatedAt: number;
  metadata?: ProjectMetadata;
}

interface SpaceStore {
  storageEnvironmentKey: string;
  activeSpaceId: string | null;
  spaces: Record<string, Space>;
  lastVisitedProjectBySpace: Record<string, string>;
  projectsBySpaceId: Record<string, Record<string, SpaceProjectMeta>>;
  projectIdIndex: Record<string, string>;
  resetForUser: (userId?: string | number | null) => void;
  ensureLegacySpace: (userId?: string | number | null) => string;
  upsertProjectMetas: (projects: SpaceProjectMeta[]) => void;
  updateProjectMeta: (
    projectId: string,
    updates: Partial<Omit<SpaceProjectMeta, 'id' | 'createdAt'>>
  ) => void;
  removeProjectMeta: (projectId: string) => void;
  moveProjectMeta: (projectId: string, spaceId: string) => void;
  getProjectsForSpace: (spaceId?: string | null) => SpaceProjectMeta[];
  getProjectMeta: (projectId?: string | null) => SpaceProjectMeta | null;
  upsertSpaces: (spaces: Space[], activeSpaceId?: string | null) => void;
  createSpace: (input: CreateSpaceInput) => string;
  deleteSpace: (spaceId: string) => void;
  updateSpace: (
    spaceId: string,
    updates: Partial<Omit<Space, 'id' | 'createdAt'>>
  ) => void;
  setActiveSpace: (spaceId: string) => void;
  setLastVisitedProject: (spaceId: string, projectId: string) => void;
  archiveSpace: (spaceId: string) => void;
  relocateSpace: (
    spaceId: string,
    rootPath: string,
    rootFingerprint?: Record<string, unknown> | null
  ) => void;
  getActiveSpace: () => Space | null;
  getAllSpaces: () => Space[];
  getSpaceById: (spaceId: string | null | undefined) => Space | null;
}

const emptyEnvironmentScopedSpaceState = (): Pick<
  SpaceStore,
  | 'storageEnvironmentKey'
  | 'activeSpaceId'
  | 'spaces'
  | 'lastVisitedProjectBySpace'
  | 'projectsBySpaceId'
  | 'projectIdIndex'
> => ({
  storageEnvironmentKey: getAuthEnvironmentKey(),
  activeSpaceId: null,
  spaces: {},
  lastVisitedProjectBySpace: {},
  projectsBySpaceId: {},
  projectIdIndex: {},
});

const spaceStoreEnvironmentMatches = (state: Partial<SpaceStore> | undefined) =>
  state?.storageEnvironmentKey === getAuthEnvironmentKey();

const canonicalUserId = (userId?: string | number | null) =>
  userId === undefined || userId === null || userId === ''
    ? DEFAULT_LOCAL_USER_ID
    : String(userId);

const spaceBelongsToUser = (space: Space, userId?: string | number | null) => {
  const ownerId = canonicalUserId(userId);
  if (!space.userId) return ownerId === DEFAULT_LOCAL_USER_ID;
  return String(space.userId) === ownerId;
};

export const legacySpaceIdForUser = (userId?: string | number | null) =>
  `legacy_${canonicalUserId(userId)}`;

const normalizedProjectName = (name?: string | null) =>
  (name ?? '').trim().toLowerCase();

const isAutoCreatedProjectMeta = (project: SpaceProjectMeta) =>
  project.metadata?.serverSynced !== true &&
  (project.metadata?.autoCreatedPlaceholder === true ||
    (normalizedProjectName(project.name) === 'new project' &&
      normalizedProjectName(project.description) === 'auto-created project'));

const projectMetaWithDisplayName = (project: SpaceProjectMeta) => {
  const historyDisplayName =
    typeof project.metadata?.historyDisplayName === 'string'
      ? project.metadata.historyDisplayName.trim()
      : '';
  if (
    historyDisplayName &&
    isPlaceholderProjectName(project.name, project.id)
  ) {
    return {
      ...project,
      name: historyDisplayName,
    };
  }
  return project;
};

export const getVisibleProjectMetasForSpace = (
  projectsBySpaceId: Record<string, Record<string, SpaceProjectMeta>> = {},
  spaceId?: string | null
) =>
  Object.values(spaceId ? (projectsBySpaceId[spaceId] ?? {}) : {})
    .filter(
      (project) =>
        project.status !== 'archived' && !isAutoCreatedProjectMeta(project)
    )
    .map(projectMetaWithDisplayName)
    .sort((a, b) => b.createdAt - a.createdAt);

const hasVisibleProjectsForSpace = (
  projectsBySpaceId: Record<string, Record<string, SpaceProjectMeta>> = {},
  spaceId: string
) => getVisibleProjectMetasForSpace(projectsBySpaceId, spaceId).length > 0;

const DISPOSABLE_BLANK_SPACE_CREATED_FROM = new Set([
  INITIAL_BLANK_SPACE_CREATED_FROM,
  'home_hub_toolbar',
  'top_bar',
  'project_sidebar_space_selector',
  'workspace_space_picker',
]);

export const isDisposableBlankSpace = (
  space: Space | null | undefined,
  projectsBySpaceId: Record<string, Record<string, SpaceProjectMeta>> = {}
) => {
  if (!space || space.metadata?.legacy === true) return false;
  if (space.status !== 'active') return false;
  if (space.sourceType !== 'blank') return false;
  if (space.rootPath) return false;
  if (hasVisibleProjectsForSpace(projectsBySpaceId, space.id)) return false;
  if (space.metadata?.autoCreatedPlaceholder !== true) return false;

  const createdFrom =
    typeof space.metadata?.createdFrom === 'string'
      ? space.metadata.createdFrom
      : '';
  return (
    DISPOSABLE_BLANK_SPACE_CREATED_FROM.has(createdFrom) &&
    isPlaceholderSpaceNameStatic(space.name)
  );
};

const pruneInactiveDisposableBlankSpaces = (
  spaces: Record<string, Space> = {},
  projectsBySpaceId: Record<string, Record<string, SpaceProjectMeta>> = {},
  lastVisitedProjectBySpace: Record<string, string> = {},
  preserveSpaceId?: string | null
) => {
  const nextSpaces = { ...spaces };
  const nextLastVisitedProjectBySpace = { ...lastVisitedProjectBySpace };
  const removedIds: string[] = [];
  const canonicalLegacyId =
    Object.values(spaces).find(
      (space) =>
        space.id !== 'legacy_local' &&
        (space.metadata?.legacy === true || space.sourceType === 'legacy')
    )?.id ?? null;

  for (const [spaceId, space] of Object.entries(spaces)) {
    if (spaceId === preserveSpaceId) continue;
    const isEmptyLegacyLocalDrift =
      spaceId === 'legacy_local' &&
      Boolean(canonicalLegacyId) &&
      !hasVisibleProjectsForSpace(projectsBySpaceId, spaceId);
    if (
      !isEmptyLegacyLocalDrift &&
      !isDisposableBlankSpace(space, projectsBySpaceId)
    ) {
      continue;
    }
    delete nextSpaces[spaceId];
    delete nextLastVisitedProjectBySpace[spaceId];
    removedIds.push(spaceId);
  }

  return {
    spaces: nextSpaces,
    lastVisitedProjectBySpace: nextLastVisitedProjectBySpace,
    removedIds,
  };
};

const pruneAutoCreatedProjectMetas = (
  projectsBySpaceId: Record<string, Record<string, SpaceProjectMeta>> = {},
  projectIdIndex: Record<string, string> = {}
) => {
  const nextBySpaceId: Record<string, Record<string, SpaceProjectMeta>> = {};
  const nextIndex = { ...projectIdIndex };
  let removedCount = 0;

  for (const [spaceId, projects] of Object.entries(projectsBySpaceId)) {
    const nextProjects: Record<string, SpaceProjectMeta> = {};
    for (const [projectId, project] of Object.entries(projects)) {
      if (isAutoCreatedProjectMeta(project)) {
        delete nextIndex[projectId];
        removedCount += 1;
        continue;
      }
      nextProjects[projectId] = project;
    }
    nextBySpaceId[spaceId] = nextProjects;
  }

  return {
    projectsBySpaceId: nextBySpaceId,
    projectIdIndex: nextIndex,
    removedCount,
  };
};

const activeSpacesByRecentUpdate = (spaces: Record<string, Space>) =>
  Object.values(spaces)
    .filter((space) => space.status === 'active')
    .sort((a, b) => b.updatedAt - a.updatedAt);

const pickHydratedActiveSpaceId = (
  spaces: Record<string, Space>,
  currentActiveSpaceId: string | null | undefined,
  localLegacyId: string,
  preferredSpaceId?: string | null
) => {
  if (preferredSpaceId && spaces[preferredSpaceId]?.status === 'active') {
    return preferredSpaceId;
  }

  const currentActiveSpace = currentActiveSpaceId
    ? spaces[currentActiveSpaceId]
    : null;
  if (
    currentActiveSpace &&
    currentActiveSpace.status === 'active' &&
    currentActiveSpace.id !== localLegacyId
  ) {
    return currentActiveSpace.id;
  }

  const activeSpaces = activeSpacesByRecentUpdate(spaces);
  return (
    activeSpaces.find((space) => !isLegacySpace(space))?.id ??
    activeSpaces[0]?.id ??
    null
  );
};

export const useSpaceStore = create<SpaceStore>()(
  persist(
    (set, get) => ({
      storageEnvironmentKey: getAuthEnvironmentKey(),
      activeSpaceId: null,
      spaces: {},
      lastVisitedProjectBySpace: {},
      projectsBySpaceId: {},
      projectIdIndex: {},

      resetForUser: (userId) =>
        set((state) => {
          const nextSpaces: Record<string, Space> = {};
          for (const [spaceId, space] of Object.entries(state.spaces)) {
            if (spaceBelongsToUser(space, userId)) {
              nextSpaces[spaceId] = space;
            }
          }

          const nextProjectsBySpaceId: Record<
            string,
            Record<string, SpaceProjectMeta>
          > = {};
          const nextProjectIdIndex: Record<string, string> = {};
          for (const spaceId of Object.keys(nextSpaces)) {
            const projects = state.projectsBySpaceId[spaceId];
            if (!projects) continue;
            nextProjectsBySpaceId[spaceId] = projects;
            for (const projectId of Object.keys(projects)) {
              nextProjectIdIndex[projectId] = spaceId;
            }
          }

          const nextLastVisitedProjectBySpace: Record<string, string> = {};
          for (const [spaceId, projectId] of Object.entries(
            state.lastVisitedProjectBySpace
          )) {
            if (nextProjectsBySpaceId[spaceId]?.[projectId]) {
              nextLastVisitedProjectBySpace[spaceId] = projectId;
            }
          }

          const localLegacyId = legacySpaceIdForUser(DEFAULT_LOCAL_USER_ID);
          return {
            storageEnvironmentKey: getAuthEnvironmentKey(),
            spaces: nextSpaces,
            activeSpaceId: pickHydratedActiveSpaceId(
              nextSpaces,
              state.activeSpaceId,
              localLegacyId
            ),
            lastVisitedProjectBySpace: nextLastVisitedProjectBySpace,
            projectsBySpaceId: nextProjectsBySpaceId,
            projectIdIndex: nextProjectIdIndex,
          };
        }),

      upsertSpaces: (spaces, activeSpaceId) =>
        set((state) => {
          const nextSpaces = { ...state.spaces };
          for (const space of spaces) {
            nextSpaces[space.id] = space;
          }
          return {
            spaces: nextSpaces,
            activeSpaceId:
              activeSpaceId === undefined ? state.activeSpaceId : activeSpaceId,
          };
        }),

      ensureLegacySpace: (userId) => {
        const ownerId = canonicalUserId(userId);
        const spaceId = legacySpaceIdForUser(ownerId);
        const existing = get().spaces[spaceId];
        if (existing) {
          if (!get().activeSpaceId) {
            set({ activeSpaceId: spaceId });
          }
          return spaceId;
        }

        const now = Date.now();
        const legacySpace: Space = {
          id: spaceId,
          name: 'Legacy Space',
          description: 'Projects created before the Space layer migration.',
          userId: ownerId,
          sourceType: 'legacy',
          rootPath: null,
          rootFingerprint: null,
          status: 'active',
          schemaVersion: SPACE_SCHEMA_VERSION,
          createdAt: now,
          updatedAt: now,
          metadata: {
            legacy: true,
          },
        };

        set((state) => ({
          spaces: {
            ...state.spaces,
            [spaceId]: legacySpace,
          },
          activeSpaceId: state.activeSpaceId ?? spaceId,
        }));
        return spaceId;
      },

      upsertProjectMetas: (projects) =>
        set((state) => {
          const nextBySpaceId: Record<
            string,
            Record<string, SpaceProjectMeta>
          > = { ...state.projectsBySpaceId };
          const nextIndex = { ...state.projectIdIndex };

          for (const project of projects) {
            const previousSpaceId = nextIndex[project.id];
            const previousProject =
              (previousSpaceId
                ? nextBySpaceId[previousSpaceId]?.[project.id]
                : undefined) ?? nextBySpaceId[project.spaceId]?.[project.id];
            if (
              previousSpaceId &&
              previousSpaceId !== project.spaceId &&
              nextBySpaceId[previousSpaceId]
            ) {
              nextBySpaceId[previousSpaceId] = {
                ...nextBySpaceId[previousSpaceId],
              };
              delete nextBySpaceId[previousSpaceId][project.id];
            }

            const shouldKeepPreviousDisplayName =
              previousProject &&
              isPlaceholderProjectName(project.name, project.id) &&
              !isPlaceholderProjectName(previousProject.name, project.id);
            const historyDisplayName =
              typeof project.metadata?.historyDisplayName === 'string'
                ? project.metadata.historyDisplayName.trim()
                : '';
            const shouldUseHistoryDisplayName =
              !shouldKeepPreviousDisplayName &&
              historyDisplayName &&
              isPlaceholderProjectName(project.name, project.id);

            nextBySpaceId[project.spaceId] = {
              ...(nextBySpaceId[project.spaceId] ?? {}),
              [project.id]: {
                ...previousProject,
                ...project,
                name: shouldKeepPreviousDisplayName
                  ? previousProject.name
                  : shouldUseHistoryDisplayName
                    ? historyDisplayName
                    : project.name,
                metadata:
                  project.metadata === undefined
                    ? previousProject?.metadata
                    : {
                        ...previousProject?.metadata,
                        ...project.metadata,
                      },
              },
            };
            nextIndex[project.id] = project.spaceId;
          }

          return {
            projectsBySpaceId: nextBySpaceId,
            projectIdIndex: nextIndex,
          };
        }),

      updateProjectMeta: (projectId, updates) => {
        const existing = get().getProjectMeta(projectId);
        if (!existing) return;
        get().upsertProjectMetas([
          {
            ...existing,
            ...updates,
            metadata:
              updates.metadata === undefined
                ? existing.metadata
                : {
                    ...existing.metadata,
                    ...updates.metadata,
                  },
            updatedAt: Date.now(),
          },
        ]);
      },

      removeProjectMeta: (projectId) =>
        set((state) => {
          const spaceId = state.projectIdIndex[projectId];
          if (!spaceId) return state;
          const nextBySpaceId = { ...state.projectsBySpaceId };
          const nextSpaceProjects = { ...(nextBySpaceId[spaceId] ?? {}) };
          delete nextSpaceProjects[projectId];
          nextBySpaceId[spaceId] = nextSpaceProjects;
          const nextIndex = { ...state.projectIdIndex };
          delete nextIndex[projectId];
          const nextLastVisitedProjectBySpace = {
            ...state.lastVisitedProjectBySpace,
          };
          if (nextLastVisitedProjectBySpace[spaceId] === projectId) {
            delete nextLastVisitedProjectBySpace[spaceId];
          }
          return {
            projectsBySpaceId: nextBySpaceId,
            projectIdIndex: nextIndex,
            lastVisitedProjectBySpace: nextLastVisitedProjectBySpace,
          };
        }),

      moveProjectMeta: (projectId, spaceId) => {
        const existing = get().getProjectMeta(projectId);
        if (!existing) return;
        get().upsertProjectMetas([
          {
            ...existing,
            spaceId,
            updatedAt: Date.now(),
          },
        ]);
      },

      getProjectsForSpace: (spaceId) => {
        const { projectsBySpaceId } = get();
        if (spaceId) {
          return getVisibleProjectMetasForSpace(projectsBySpaceId, spaceId);
        }
        return Object.values(projectsBySpaceId)
          .flatMap((projects) => Object.values(projects))
          .filter(
            (project) =>
              project.status !== 'archived' &&
              !isAutoCreatedProjectMeta(project)
          )
          .sort((a, b) => b.createdAt - a.createdAt);
      },

      getProjectMeta: (projectId) => {
        if (!projectId) return null;
        const { projectIdIndex, projectsBySpaceId } = get();
        const spaceId = projectIdIndex[projectId];
        return spaceId ? projectsBySpaceId[spaceId]?.[projectId] || null : null;
      },

      createSpace: (input) => {
        const now = Date.now();
        const id = input.id ?? `space_${generateUniqueId()}`;
        const ownerId = canonicalUserId(input.userId);
        const space: Space = {
          id,
          name: input.name,
          description: input.description,
          userId: ownerId,
          sourceType: input.sourceType ?? 'blank',
          rootPath: input.rootPath ?? null,
          rootFingerprint: input.rootFingerprint ?? null,
          status: 'active',
          schemaVersion: SPACE_SCHEMA_VERSION,
          createdAt: now,
          updatedAt: now,
          metadata: input.metadata,
        };

        set((state) => ({
          spaces: {
            ...state.spaces,
            [id]: space,
          },
          ...(input.setActive !== false ? { activeSpaceId: id } : {}),
        }));

        return id;
      },

      deleteSpace: (spaceId) => {
        const current = get();
        if (!current.spaces[spaceId]) return;
        const removedProjectIds = Object.keys(
          current.projectsBySpaceId[spaceId] ?? {}
        );
        for (const projectId of removedProjectIds) {
          usePageTabStore.getState().removeSessionPreviewProject(projectId);
        }
        set((state) => {
          if (!state.spaces[spaceId]) return state;
          const nextSpaces = { ...state.spaces };
          delete nextSpaces[spaceId];
          const nextProjectsBySpaceId = { ...state.projectsBySpaceId };
          delete nextProjectsBySpaceId[spaceId];
          const nextProjectIdIndex = { ...state.projectIdIndex };
          for (const projectId of removedProjectIds) {
            delete nextProjectIdIndex[projectId];
          }
          const nextLastVisitedProjectBySpace = {
            ...state.lastVisitedProjectBySpace,
          };
          delete nextLastVisitedProjectBySpace[spaceId];
          const nextActiveSpaceId =
            state.activeSpaceId === spaceId
              ? Object.keys(nextSpaces)[0] || null
              : state.activeSpaceId;
          return {
            spaces: nextSpaces,
            activeSpaceId: nextActiveSpaceId,
            projectsBySpaceId: nextProjectsBySpaceId,
            projectIdIndex: nextProjectIdIndex,
            lastVisitedProjectBySpace: nextLastVisitedProjectBySpace,
          };
        });
      },

      updateSpace: (spaceId, updates) =>
        set((state) => {
          const space = state.spaces[spaceId];
          if (!space) return state;
          return {
            spaces: {
              ...state.spaces,
              [spaceId]: {
                ...space,
                ...updates,
                metadata: {
                  ...space.metadata,
                  ...updates.metadata,
                },
                updatedAt: Date.now(),
              },
            },
          };
        }),

      setActiveSpace: (spaceId) => {
        if (!get().spaces[spaceId]) {
          console.warn(`Space ${spaceId} not found`);
          return;
        }
        set((state) => {
          const pruned = pruneInactiveDisposableBlankSpaces(
            state.spaces,
            state.projectsBySpaceId,
            state.lastVisitedProjectBySpace,
            spaceId
          );
          return {
            activeSpaceId: spaceId,
            spaces: pruned.spaces,
            lastVisitedProjectBySpace: pruned.lastVisitedProjectBySpace,
          };
        });
      },

      setLastVisitedProject: (spaceId, projectId) =>
        set((state) => ({
          lastVisitedProjectBySpace: {
            ...state.lastVisitedProjectBySpace,
            [spaceId]: projectId,
          },
        })),

      archiveSpace: (spaceId) => {
        get().updateSpace(spaceId, { status: 'archived' });
      },

      relocateSpace: (spaceId, rootPath, rootFingerprint) =>
        get().updateSpace(spaceId, {
          rootPath,
          rootFingerprint: rootFingerprint ?? null,
          status: 'active',
        }),

      getActiveSpace: () => {
        const { activeSpaceId, spaces } = get();
        return activeSpaceId ? spaces[activeSpaceId] || null : null;
      },

      getAllSpaces: () =>
        Object.values(get().spaces).sort((a, b) => b.updatedAt - a.updatedAt),

      getSpaceById: (spaceId) => {
        if (!spaceId) return null;
        return get().spaces[spaceId] || null;
      },
    }),
    {
      name: 'eigent-space-store',
      version: SPACE_STORE_PERSIST_VERSION,
      migrate: (persistedState) => {
        const state = persistedState as Partial<SpaceStore> | undefined;
        if (!state) return persistedState as SpaceStore;
        if (!spaceStoreEnvironmentMatches(state)) {
          return emptyEnvironmentScopedSpaceState() as SpaceStore;
        }
        const pruned = pruneAutoCreatedProjectMetas(
          state.projectsBySpaceId,
          state.projectIdIndex
        );
        const prunedSpaces = pruneInactiveDisposableBlankSpaces(
          state.spaces ?? {},
          pruned.projectsBySpaceId,
          state.lastVisitedProjectBySpace ?? {},
          state.activeSpaceId ?? null
        );
        return {
          ...state,
          storageEnvironmentKey: getAuthEnvironmentKey(),
          activeSpaceId: state.activeSpaceId ?? null,
          spaces: prunedSpaces.spaces,
          lastVisitedProjectBySpace: prunedSpaces.lastVisitedProjectBySpace,
          projectsBySpaceId: pruned.projectsBySpaceId,
          projectIdIndex: pruned.projectIdIndex,
        } as SpaceStore;
      },
      partialize: (state) => ({
        storageEnvironmentKey: state.storageEnvironmentKey,
        activeSpaceId: state.activeSpaceId,
        spaces: state.spaces,
        lastVisitedProjectBySpace: state.lastVisitedProjectBySpace,
        projectsBySpaceId: state.projectsBySpaceId,
        projectIdIndex: state.projectIdIndex,
      }),
    }
  )
);

if (typeof queueMicrotask === 'function') {
  queueMicrotask(() => {
    const state = useSpaceStore.getState();
    if (!spaceStoreEnvironmentMatches(state)) {
      useSpaceStore.setState(emptyEnvironmentScopedSpaceState());
      console.warn(
        '[spaceStore] Cleared persisted spaces after API environment changed.'
      );
      return;
    }
    const pruned = pruneAutoCreatedProjectMetas(
      state.projectsBySpaceId,
      state.projectIdIndex
    );
    const prunedSpaces = pruneInactiveDisposableBlankSpaces(
      state.spaces,
      pruned.projectsBySpaceId,
      state.lastVisitedProjectBySpace,
      state.activeSpaceId
    );
    if (pruned.removedCount === 0 && prunedSpaces.removedIds.length === 0) {
      return;
    }
    useSpaceStore.setState({
      spaces: prunedSpaces.spaces,
      lastVisitedProjectBySpace: prunedSpaces.lastVisitedProjectBySpace,
      projectsBySpaceId: pruned.projectsBySpaceId,
      projectIdIndex: pruned.projectIdIndex,
    });
    if (pruned.removedCount > 0) {
      console.warn(
        `[spaceStore] Removed ${pruned.removedCount} auto-created Project metadata entr${
          pruned.removedCount === 1 ? 'y' : 'ies'
        }.`
      );
    }
    if (prunedSpaces.removedIds.length > 0) {
      console.warn(
        `[spaceStore] Removed ${prunedSpaces.removedIds.length} empty placeholder Space entr${
          prunedSpaces.removedIds.length === 1 ? 'y' : 'ies'
        }.`
      );
    }
  });
}

export type { SpaceStore };
