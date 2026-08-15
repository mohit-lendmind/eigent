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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSessionPreviewSlice, usePageTabStore } from './pageTabStore';
import { SPACE_SCHEMA_VERSION, useSpaceStore } from './spaceStore';

const authStoreMock = vi.hoisted(() => ({
  state: {
    user_id: 2,
    email: 'new@example.com',
  },
}));

vi.mock('@/store/authStore', () => ({
  getAuthStore: () => authStoreMock.state,
}));

describe('spaceStore user scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authStoreMock.state = {
      email: 'new@example.com',
      user_id: 2,
    };
    globalThis.electronAPI = {
      ...globalThis.electronAPI,
      terminalDispose: vi.fn().mockResolvedValue({ success: true }),
    };
    usePageTabStore.setState({
      sessionPreviewProjectId: null,
      sessionPreviewByProject: {},
    });
    useSpaceStore.setState({
      activeSpaceId: 'space_old_blank',
      spaces: {
        space_old_blank: {
          id: 'space_old_blank',
          name: 'Untitled Space',
          userId: '1',
          sourceType: 'blank',
          status: 'active',
          schemaVersion: SPACE_SCHEMA_VERSION,
          createdAt: 1,
          updatedAt: 3,
        },
        legacy_1: {
          id: 'legacy_1',
          name: 'Legacy Space',
          userId: '1',
          sourceType: 'legacy',
          status: 'active',
          schemaVersion: SPACE_SCHEMA_VERSION,
          createdAt: 1,
          updatedAt: 2,
          metadata: { legacy: true },
        },
        space_new_blank: {
          id: 'space_new_blank',
          name: 'Untitled Space',
          userId: '2',
          sourceType: 'blank',
          status: 'active',
          schemaVersion: SPACE_SCHEMA_VERSION,
          createdAt: 1,
          updatedAt: 4,
        },
      },
      lastVisitedProjectBySpace: {
        space_old_blank: 'project_old',
        space_new_blank: 'project_new',
      },
      projectsBySpaceId: {
        space_old_blank: {
          project_old: {
            id: 'project_old',
            userId: '1',
            spaceId: 'space_old_blank',
            name: 'Old project',
            status: 'active',
            createdAt: 1,
            updatedAt: 1,
          },
        },
        space_new_blank: {
          project_new: {
            id: 'project_new',
            userId: '2',
            spaceId: 'space_new_blank',
            name: 'New project',
            status: 'active',
            createdAt: 1,
            updatedAt: 1,
          },
        },
      },
      projectIdIndex: {
        project_old: 'space_old_blank',
        project_new: 'space_new_blank',
      },
    });
  });

  it('disposes project preview shells when their Space is deleted', () => {
    const pageTabs = usePageTabStore.getState();
    pageTabs.setSessionPreviewProject('project_old');
    pageTabs.toggleSessionPreview();
    pageTabs.choosePreviewTabType(
      getSessionPreviewSlice(usePageTabStore.getState()).activeTabId!,
      'terminal'
    );
    const terminal = getSessionPreviewSlice(usePageTabStore.getState()).tabs[0];
    const shellId = terminal.type === 'terminal' ? terminal.shellId : undefined;

    useSpaceStore.getState().deleteSpace('space_old_blank');

    expect(globalThis.electronAPI.terminalDispose).toHaveBeenCalledWith(
      shellId
    );
    expect(
      usePageTabStore.getState().sessionPreviewByProject.project_old
    ).toBeUndefined();
  });

  it('removes spaces and project metadata from the previous signed-in user', () => {
    useSpaceStore.getState().resetForUser(2);

    const state = useSpaceStore.getState();
    expect(Object.keys(state.spaces)).toEqual(['space_new_blank']);
    expect(state.activeSpaceId).toBe('space_new_blank');
    expect(Object.keys(state.projectsBySpaceId)).toEqual(['space_new_blank']);
    expect(state.projectIdIndex).toEqual({ project_new: 'space_new_blank' });
    expect(state.lastVisitedProjectBySpace).toEqual({
      space_new_blank: 'project_new',
    });
  });
});
