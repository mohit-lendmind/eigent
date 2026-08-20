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
import { newCrmId, type CrmIdPrefix } from './ids';

describe('ids', () => {
  const prefixes: CrmIdPrefix[] = [
    'client',
    'case',
    'doc',
    'insight',
    'wl',
    'stream',
    'event',
    'conflict',
    'stream_trunc',
    'activity',
  ];

  it('every prefix produces an id starting with prefix_', () => {
    for (const p of prefixes) {
      const id = newCrmId(p);
      expect(id.startsWith(`${p}_`)).toBe(true);
    }
  });

  it('produces unique ids across many sequential calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const id = newCrmId('stream');
      seen.add(id);
    }
    expect(seen.size).toBe(1000);
  });
});
