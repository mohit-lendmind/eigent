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

import { describe, expect, it } from 'vitest';

import { browserSubmitFields } from '@/store/aionLocalBrowserStore';

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
