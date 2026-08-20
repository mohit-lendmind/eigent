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

import { formatSplittingElapsed } from '@/components/ChatBox/MessageItem/TokenUtils';

describe('formatSplittingElapsed', () => {
  it('reads "0s" only for a clock that never started', () => {
    expect(formatSplittingElapsed(0)).toBe('0s');
    expect(formatSplittingElapsed(-1)).toBe('0s');
    expect(formatSplittingElapsed(Number.NaN)).toBe('0s');
  });

  it('never floors a run that took time down to zero', () => {
    // A run the local stack finishes in half a second still did work; "0s"
    // there is indistinguishable from the clock never having been started.
    expect(formatSplittingElapsed(1)).toBe('0.1s');
    expect(formatSplittingElapsed(537)).toBe('0.5s');
    expect(formatSplittingElapsed(999)).toBe('1s');
  });

  it('emits no markup-significant character', () => {
    // The label is interpolated into a `Trans` value, which parses its output
    // as nodes: a "<" would be read as a malformed tag and the whole value
    // silently dropped, leaving the header reading "Worked for" with no time.
    for (const ms of [0, 1, 537, 999, 1_000, 45_400, 720_000]) {
      expect(formatSplittingElapsed(ms)).not.toMatch(/[<>&]/);
    }
  });

  it('counts whole seconds, then minutes and seconds', () => {
    expect(formatSplittingElapsed(1_000)).toBe('1s');
    expect(formatSplittingElapsed(45_400)).toBe('45s');
    expect(formatSplittingElapsed(59_999)).toBe('59s');
    expect(formatSplittingElapsed(65_000)).toBe('1m 05s');
    expect(formatSplittingElapsed(720_000)).toBe('12m 00s');
  });
});
