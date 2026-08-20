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
import { useCrmCasesStore } from './casesStore';
import { useCrmClientsStore } from './clientsStore';
import { useCrmDocumentsStore } from './documentsStore';
import { seedCrmGoldenPath } from './seed';
import { useCrmWorkstreamStore } from './workstreamStore';

describe('resolveWorklistItem', () => {
  beforeEach(() => {
    useCrmClientsStore.getState().resetForTests();
    useCrmCasesStore.getState().resetForTests();
    useCrmDocumentsStore.getState().resetForTests();
    useCrmWorkstreamStore.getState().resetForTests();
    seedCrmGoldenPath({ ignoreDevGate: true });
  });

  it('transitions open → resolved and retains the item (never deletes)', () => {
    useCrmWorkstreamStore.getState().resolveWorklistItem('w1', {
      resolution: { method: 'confirm-value', reasoning: 'Contract' },
      resolvedBy: 'EV',
    });
    const item = useCrmWorkstreamStore.getState().worklistItems.w1;
    expect(item).toBeDefined();
    expect(item.status).toBe('resolved');
    expect(item.resolvedBy).toBe('EV');
    expect(item.resolvedAt).toBeGreaterThan(0);
  });

  it('idempotent — second call on already-resolved is a no-op', () => {
    useCrmWorkstreamStore.getState().resolveWorklistItem('w1', {
      resolution: { method: 'confirm-value' },
      resolvedBy: 'EV',
    });
    const firstResolvedAt =
      useCrmWorkstreamStore.getState().worklistItems.w1.resolvedAt;
    useCrmWorkstreamStore.getState().resolveWorklistItem('w1', {
      resolution: { method: 'ask-client' },
      resolvedBy: 'someone-else',
    });
    const secondResolvedAt =
      useCrmWorkstreamStore.getState().worklistItems.w1.resolvedAt;
    expect(secondResolvedAt).toBe(firstResolvedAt);
    expect(useCrmWorkstreamStore.getState().worklistItems.w1.resolvedBy).toBe(
      'EV'
    );
  });

  it("worklist has no 'delete' entrypoint", () => {
    // The API surface excludes delete — only resolve.
    const state = useCrmWorkstreamStore.getState() as unknown as Record<
      string,
      unknown
    >;
    expect('deleteWorklistItem' in state).toBe(false);
  });
});
