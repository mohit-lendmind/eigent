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

import { useHost } from '@/host';
import { deleteProjectLocally } from '@/lib/projectDeletion';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import {
  getVisibleProjectMetasForSpace,
  useSpaceStore,
  type SpaceProjectMeta,
} from '@/store/spaceStore';
import { ProjectGroup as ProjectGroupType } from '@/types/history';
import { useCallback, useMemo } from 'react';

function rowFromMeta(meta: SpaceProjectMeta): ProjectGroupType {
  return {
    project_id: meta.id,
    space_id: meta.spaceId,
    project_name: meta.name,
    total_tokens: 0,
    task_count: 0,
    total_triggers: 0,
    latest_task_date: new Date(meta.updatedAt).toISOString(),
    last_prompt: '',
    tasks: [],
    total_completed_tasks: 0,
    total_ongoing_tasks: 0,
    average_tokens_per_task: 0,
  };
}

/**
 * The hub's Project rows, read from `spaceStore.projectsBySpaceId`. That store
 * is the whole source: a Project's conversation lives in the aion Project the
 * chat bridge drives, and the renderer keeps one meta row per Project to list
 * it. Rename and delete are therefore local edits with nothing to reconcile.
 */
export function useHomeHubProjects() {
  const host = useHost();
  const ipcRenderer = host?.ipcRenderer;
  const projectStore = useProjectRuntimeStore();
  const projectsBySpaceId = useSpaceStore((state) => state.projectsBySpaceId);

  const projects = useMemo<ProjectGroupType[]>(() => {
    const rows: ProjectGroupType[] = [];
    for (const spaceId of Object.keys(projectsBySpaceId)) {
      for (const meta of getVisibleProjectMetasForSpace(
        projectsBySpaceId,
        spaceId
      )) {
        rows.push(rowFromMeta(meta));
      }
    }
    return rows.sort(
      (a, b) =>
        new Date(b.latest_task_date || 0).getTime() -
        new Date(a.latest_task_date || 0).getTime()
    );
  }, [projectsBySpaceId]);

  const handleProjectRename = useCallback(
    async (projectId: string, newName: string) => {
      // `updateProject` mirrors the name onto the meta row; a Project listed
      // but never opened in this renderer has no runtime entry to update.
      if (projectStore.getProjectById(projectId)) {
        projectStore.updateProject(projectId, { name: newName });
        return;
      }
      useSpaceStore.getState().updateProjectMeta(projectId, { name: newName });
    },
    [projectStore]
  );

  const handleProjectDelete = useCallback(
    (
      projectId: string,
      onConfirm?: (callback: () => Promise<void>) => void
    ) => {
      const deleteCallback = () => deleteProjectLocally(projectId, ipcRenderer);
      if (onConfirm) {
        onConfirm(deleteCallback);
      } else {
        void deleteCallback();
      }
    },
    [ipcRenderer]
  );

  return {
    projects,
    handleProjectRename,
    handleProjectDelete,
  };
}
