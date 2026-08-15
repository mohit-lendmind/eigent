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

import { getAuthStore } from '@/store/authStore';
import { useProjectStore } from '@/store/projectStore';
import { useSpaceStore } from '@/store/spaceStore';

interface TaskFileCleanup {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
}

/**
 * Task ids the renderer holds for a project, across all of its chat stores.
 * Workspace files on disk are keyed by task id, so this is what the cleanup
 * IPC needs in order to name them.
 */
export function localTaskIdsForProject(projectId: string): string[] {
  const project = useProjectStore.getState().projects[projectId];
  if (!project) return [];
  return Object.values(project.chatStores ?? {}).flatMap((chatStore) =>
    Object.keys(chatStore.getState().tasks ?? {})
  );
}

/**
 * Drop a Project from the renderer and delete its workspace files.
 *
 * File cleanup is best-effort and never blocks the removal: a project whose
 * folder is already gone must still leave the store, or the row stays on
 * screen with nothing behind it. The Space meta is removed explicitly because
 * `removeProject` returns early for a project that only ever existed as a
 * meta row (one listed in the hub but never opened in this renderer).
 */
export async function deleteProjectLocally(
  projectId: string,
  ipcRenderer?: TaskFileCleanup | null
): Promise<void> {
  const taskIds = localTaskIdsForProject(projectId);
  if (ipcRenderer && taskIds.length > 0) {
    const { email } = getAuthStore();
    await Promise.allSettled(
      taskIds.map((taskId) =>
        ipcRenderer.invoke('delete-task-files', email, taskId, projectId)
      )
    );
  }
  useProjectStore.getState().removeProject(projectId);
  useSpaceStore.getState().removeProjectMeta(projectId);
}
