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

import { isDisposableBlankSpace, useSpaceStore } from '@/store/spaceStore';
import { ProjectGroup as ProjectGroupType } from '@/types/history';
import { useMemo } from 'react';

/**
 * The `aion*Count` arguments override their tab counts when the lists are
 * served by aion: the local arrays are read from renderer storage and are
 * empty there, so leaving them in charge would badge "0" beside a list of N.
 * Triggers have no local plane at all, so an absent aion count badges 0.
 */
export function useHomeHubCounts(
  projects: ProjectGroupType[],
  aionProjectsCount?: number,
  aionTriggersCount?: number,
  aionSpacesCount?: number
) {
  const activeSpaceId = useSpaceStore((state) => state.activeSpaceId);
  const spacesById = useSpaceStore((state) => state.spaces);
  const projectsBySpaceId = useSpaceStore((state) => state.projectsBySpaceId);

  const spacesCount = useMemo(
    () =>
      Object.values(spacesById).filter(
        (space) =>
          space.status !== 'archived' &&
          (space.id === activeSpaceId ||
            !isDisposableBlankSpace(space, projectsBySpaceId))
      ).length,
    [activeSpaceId, projectsBySpaceId, spacesById]
  );

  const projectsCount = aionProjectsCount ?? projects.length;

  return {
    spaces: aionSpacesCount ?? spacesCount,
    projects: projectsCount,
    triggers: aionTriggersCount ?? 0,
  };
}
