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

import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSpaceStore } from '@/store/spaceStore';
import type { ProjectGroup as ProjectGroupType } from '@/types/history';
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export function useHomeHubNavigation() {
  const navigate = useNavigate();
  const projectStore = useProjectRuntimeStore();
  const setActiveSpace = useSpaceStore((s) => s.setActiveSpace);
  const setActiveWorkspaceTab = usePageTabStore((s) => s.setActiveWorkspaceTab);
  const [loadingProjectId, setLoadingProjectId] = useState<string | null>(null);

  const openSpace = useCallback(
    (spaceId: string) => {
      setActiveSpace(spaceId);
      projectStore.setActiveProject(null);
      setActiveWorkspaceTab('workforce');
      navigate('/');
    },
    [navigate, projectStore, setActiveSpace, setActiveWorkspaceTab]
  );

  const openProject = useCallback(
    async (project: ProjectGroupType) => {
      const projectId = project.project_id;
      setLoadingProjectId(projectId);

      try {
        if (project.space_id) {
          setActiveSpace(project.space_id);
        }
        if (!projectStore.getProjectById(projectId)) {
          projectStore.createProject(
            project.project_name || 'Project',
            'Project with triggers',
            projectId
          );
        } else {
          projectStore.setActiveProject(projectId);
        }
        setActiveWorkspaceTab('project');
        navigate('/');
      } catch (error) {
        console.error('[HomeHub] Failed to open project:', error);
      } finally {
        setLoadingProjectId(null);
      }
    },
    [navigate, projectStore, setActiveSpace, setActiveWorkspaceTab]
  );

  return {
    openSpace,
    openProject,
    loadingProjectId,
  };
}
