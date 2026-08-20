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

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('moveStage', () => {
  beforeEach(() => {
    useCrmClientsStore.getState().resetForTests();
    useCrmCasesStore.getState().resetForTests();
    useCrmDocumentsStore.getState().resetForTests();
    useCrmWorkstreamStore.getState().resetForTests();
    seedCrmGoldenPath({ ignoreDevGate: true });
  });

  it('moves case to a valid stage and appends an ActivityEvent', async () => {
    useCrmCasesStore.getState().moveStage('c417', 'APPLICATION');
    expect(useCrmCasesStore.getState().casesById.c417.stage).toBe(
      'APPLICATION'
    );
    await flushMicrotasks();
    const activities =
      useCrmWorkstreamStore.getState().activityByCase.c417 ?? [];
    expect(activities.some((a) => a.kind === 'stage-change')).toBe(true);
  });

  it('throws for an unknown stage', () => {
    expect(() =>
      // @ts-expect-error — invalid stage on purpose
      useCrmCasesStore.getState().moveStage('c417', 'NOT_A_STAGE')
    ).toThrow();
  });
});
