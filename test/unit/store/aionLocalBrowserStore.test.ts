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

import { beforeEach, describe, expect, it } from 'vitest';

import {
  browserSubmitFields,
  useAionLocalBrowserStore,
} from '@/store/aionLocalBrowserStore';

describe('browserSubmitFields', () => {
  it('adds nothing when the toggle is off', () => {
    expect(browserSubmitFields(false, undefined, true)).toEqual({});
    expect(browserSubmitFields(undefined, undefined, true)).toEqual({});
  });

  it('degrades to pod execution when support is absent', () => {
    // A persisted "on" against a downgraded edge or a build without the
    // executor must not submit fields the backend would 422.
    expect(browserSubmitFields(true, 'isolated', false)).toEqual({});
    expect(browserSubmitFields(true, 'logged_in', false)).toEqual({});
  });

  it('submits local execution with the default partition left implicit', () => {
    expect(browserSubmitFields(true, undefined, true)).toEqual({
      browser_execution: 'local',
    });
    expect(browserSubmitFields(true, 'isolated', true)).toEqual({
      browser_execution: 'local',
    });
  });

  it('rides browser_session_mode only alongside local', () => {
    expect(browserSubmitFields(true, 'logged_in', true)).toEqual({
      browser_execution: 'local',
      browser_session_mode: 'logged_in',
    });
    expect(browserSubmitFields(false, 'logged_in', true)).toEqual({});
  });
});

describe('space-scoped pending choice', () => {
  beforeEach(() => {
    useAionLocalBrowserStore.setState({
      projectLocalBrowser: {},
      projectSessionMode: {},
      spaceLocalBrowser: {},
      spaceSessionMode: {},
    });
  });

  it('adoptSpaceChoice moves the pending choice onto the new project and consumes it', () => {
    const store = useAionLocalBrowserStore.getState();
    store.setSpaceLocalBrowser('space-1', true);
    store.setSpaceSessionMode('space-1', 'logged_in');
    useAionLocalBrowserStore.getState().adoptSpaceChoice('space-1', 'proj-1');
    const after = useAionLocalBrowserStore.getState();
    expect(after.projectLocalBrowser['proj-1']).toBe(true);
    expect(after.projectSessionMode['proj-1']).toBe('logged_in');
    // Consume-once: a second project created in the same space must NOT
    // inherit a stale logged-in opt-in from last time.
    expect(after.spaceLocalBrowser['space-1']).toBeUndefined();
    expect(after.spaceSessionMode['space-1']).toBeUndefined();
  });

  it('adoptSpaceChoice is a no-op when the space made no choice', () => {
    useAionLocalBrowserStore.getState().adoptSpaceChoice('space-2', 'proj-2');
    const after = useAionLocalBrowserStore.getState();
    expect(after.projectLocalBrowser['proj-2']).toBeUndefined();
    expect(after.projectSessionMode['proj-2']).toBeUndefined();
  });

  it('an explicit cloud choice on the space transfers as an explicit off', () => {
    const store = useAionLocalBrowserStore.getState();
    store.setSpaceLocalBrowser('space-3', true);
    useAionLocalBrowserStore
      .getState()
      .setSpaceLocalBrowser('space-3', false);
    useAionLocalBrowserStore.getState().adoptSpaceChoice('space-3', 'proj-3');
    const after = useAionLocalBrowserStore.getState();
    expect(after.projectLocalBrowser['proj-3']).toBe(false);
    expect(
      browserSubmitFields(
        after.projectLocalBrowser['proj-3'],
        after.projectSessionMode['proj-3'],
        true
      )
    ).toEqual({});
  });
});
