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
import { isLegacySpace } from '@/lib/spaceLabel';
import type {
  ProjectMode,
  ProjectRuntimeStore,
  ProjectWorkdirMode,
} from '@/store/projectRuntimeStore';
import { useSpaceStore } from '@/store/spaceStore';

/**
 * Thrown when something tries to create a Project inside a legacy Space. Legacy
 * Spaces are read-only — see {@link canCreateProjectInSpace}. UI entry points
 * disable creation up front; this is the backstop that guarantees the invariant
 * for any caller that slips through.
 */
export class LegacySpaceProjectError extends Error {
  constructor() {
    super('Cannot create a Project inside a legacy Space.');
    this.name = 'LegacySpaceProjectError';
  }
}

interface CreateSyncedProjectInSpaceInput {
  projectStore: ProjectRuntimeStore;
  spaceId: string;
  name?: string;
  description?: string;
  mode?: ProjectMode | null;
  workdirMode?: ProjectWorkdirMode | null;
  metadata?: Record<string, unknown>;
  setActive?: boolean;
}

interface CreateSyncedProjectInSpaceResult {
  projectId: string;
  spaceId: string;
}

export const createSyncedProjectInSpace = async ({
  projectStore,
  spaceId,
  name = 'new project',
  description,
  mode,
  workdirMode,
  metadata,
  setActive = true,
}: CreateSyncedProjectInSpaceInput): Promise<CreateSyncedProjectInSpaceResult> => {
  // A bare `legacy_` id is always legacy; otherwise consult the loaded Space
  // metadata.
  const requestedSpace = useSpaceStore.getState().getSpaceById(spaceId);
  if (
    spaceId.startsWith('legacy_') ||
    (requestedSpace && isLegacySpace(requestedSpace))
  ) {
    throw new LegacySpaceProjectError();
  }

  // Conversation truth lives in the aion Project the chat bridge creates; the
  // renderer keeps only the local shell that points at it.
  const projectId = projectStore.createProject(
    name,
    description,
    generateUniqueId(),
    undefined,
    undefined,
    setActive,
    {
      spaceId,
      mode,
      workdirMode,
      metadata: { ...metadata, serverSynced: false },
    }
  );
  return { projectId, spaceId };
};
