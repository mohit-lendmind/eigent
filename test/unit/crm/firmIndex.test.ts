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

import { resetCaseProjectCaches } from '@/crm/agents/caseProject';
import { configureAgentEdge } from '@/crm/agents/edge';
import {
  publishCasePointer,
  readFirmIndex,
  type CaseIndexPointer,
} from '@/crm/agents/firmIndex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeEdge } from './fakeEdge';

function pointer(overrides: Partial<CaseIndexPointer>): CaseIndexPointer {
  return {
    caseId: 'c1',
    firmId: 'firm-alpha',
    aionProjectId: 'proj-c1',
    stage: 'fact-find',
    logHeadSeq: '1',
    updatedAt: 1,
    ...overrides,
  };
}

describe('firm index — per-case pointers, latest-per-caseId', () => {
  beforeEach(() => {
    resetCaseProjectCaches();
  });
  afterEach(() => {
    configureAgentEdge(null);
  });

  it('does not lose a case when many pointers are published concurrently', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);
    const firmId = 'firm-alpha';

    const ids = Array.from({ length: 25 }, (_, i) => `c${i + 1}`);
    // Publish all pointers at once — the append-only, one-name-per-case design
    // must not drop any under concurrency.
    await Promise.all(
      ids.map((caseId, i) =>
        publishCasePointer(
          pointer({
            caseId,
            firmId,
            aionProjectId: `proj-${caseId}`,
            logHeadSeq: String(i + 1),
          })
        )
      )
    );

    const index = await readFirmIndex(firmId);
    expect(index.map((p) => p.caseId).sort()).toEqual(ids.slice().sort());
  });

  it('a republished case supersedes its earlier pointer', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);
    const firmId = 'firm-beta';

    await publishCasePointer(
      pointer({ caseId: 'c9', firmId, stage: 'fact-find', logHeadSeq: '1' })
    );
    await publishCasePointer(
      pointer({ caseId: 'c9', firmId, stage: 'application', logHeadSeq: '14' })
    );

    const index = await readFirmIndex(firmId);
    expect(index).toHaveLength(1);
    expect(index[0].stage).toBe('application');
    expect(index[0].logHeadSeq).toBe('14');
  });

  it('reads an empty index as no cases, not an error', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);
    const index = await readFirmIndex('firm-empty');
    expect(index).toEqual([]);
  });
});
