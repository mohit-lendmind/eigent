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

describe('confirmSynthesizedField', () => {
  beforeEach(() => {
    useCrmClientsStore.getState().resetForTests();
    useCrmCasesStore.getState().resetForTests();
    useCrmDocumentsStore.getState().resetForTests();
    useCrmWorkstreamStore.getState().resetForTests();
    seedCrmGoldenPath({ ignoreDevGate: true });
  });

  it('flips src syn → det and records confirmedAt/By', async () => {
    // Aisha's marital status is seeded as syn
    useCrmCasesStore
      .getState()
      .confirmSynthesizedField('c417', 'aisha', 'personal', 'maritalStatus', {
        confirmedBy: 'EV',
      });
    await flushMicrotasks();
    const aisha = useCrmCasesStore
      .getState()
      .casesById.c417.applicants.find((a) => a.clientId === 'aisha');
    const field = aisha?.profile.personal?.fields.find(
      (f) => f.k === 'maritalStatus'
    );
    expect(field?.src).toBe('det');
    expect(field?.confirmedAt).toBeGreaterThan(0);
    expect(field?.confirmedBy).toBe('EV');
  });

  it("emits a FieldChangeEvent with reason 'confirm-synthesized'", async () => {
    useCrmCasesStore
      .getState()
      .confirmSynthesizedField('c417', 'aisha', 'personal', 'dependants', {
        confirmedBy: 'EV',
      });
    await flushMicrotasks();
    const events = useCrmWorkstreamStore
      .getState()
      .getFieldChangeEventsForField('c417', 'aisha', 'personal', 'dependants');
    expect(events.some((e) => e.reason === 'confirm-synthesized')).toBe(true);
  });
});
