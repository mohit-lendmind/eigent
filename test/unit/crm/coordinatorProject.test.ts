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

// FR-003 (finding 2) — the firm coordinator Project MUST be maintained, not
// re-minted every session. The id is persisted to the firm store, so across a
// simulated restart (the in-memory promise cache cleared, the store retained)
// the resolver reuses the SAME project rather than creating a new one. A drifting
// coordinator would fragment the case-pointer index and duplicate the watcher
// schedule — the exact durability failure this test guards.

import {
  firmCoordinatorProject,
  resetCaseProjectCaches,
} from '@/crm/agents/caseProject';
import { configureAgentEdge } from '@/crm/agents/edge';
import { useCrmFirmStore } from '@/crm/firmStore';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeEdge } from './fakeEdge';

const FIRM = 'firm-alpha';

describe('firm coordinator project — persisted across sessions (FR-003)', () => {
  beforeEach(() => {
    resetCaseProjectCaches();
    useCrmFirmStore.getState().resetForTests();
    localStorage.clear();
  });
  afterEach(() => {
    configureAgentEdge(null);
  });

  it('creates the coordinator once and reuses it after a restart', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);

    const first = await firmCoordinatorProject(FIRM);
    expect(edge.projects.has(first)).toBe(true);
    // The id was persisted so a later session can find it.
    expect(useCrmFirmStore.getState().getCoordinatorProject(FIRM)).toBe(first);

    // Simulate a restart: drop the in-memory promise cache, keep the store.
    resetCaseProjectCaches();
    const second = await firmCoordinatorProject(FIRM);

    // Same project, and no second createProject happened — exactly one project
    // exists on the edge.
    expect(second).toBe(first);
    expect(edge.projects.size).toBe(1);
  });

  it('mints a distinct coordinator per firm', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);

    const alpha = await firmCoordinatorProject('firm-alpha');
    const beta = await firmCoordinatorProject('firm-beta');
    expect(alpha).not.toBe(beta);
    expect(useCrmFirmStore.getState().getCoordinatorProject('firm-beta')).toBe(
      beta
    );
  });
});
