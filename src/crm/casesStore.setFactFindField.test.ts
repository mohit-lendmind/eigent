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
import type { Pence } from './domain/money';
import { seedCrmGoldenPath } from './seed';
import { useCrmWorkstreamStore } from './workstreamStore';

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('setFactFindField', () => {
  beforeEach(() => {
    useCrmClientsStore.getState().resetForTests();
    useCrmCasesStore.getState().resetForTests();
    useCrmDocumentsStore.getState().resetForTests();
    useCrmWorkstreamStore.getState().resetForTests();
    seedCrmGoldenPath({ ignoreDevGate: true });
  });

  it('emits exactly one FieldChangeEvent per edit', async () => {
    const beforeCount = useCrmWorkstreamStore
      .getState()
      .getFieldChangeEventsForField('c417', 'aisha', 'income', 'basic').length;
    useCrmCasesStore
      .getState()
      .setFactFindField(
        'c417',
        'aisha',
        'income',
        'basic',
        { t: 'money', v: 4_500_000 as Pence },
        { changedBy: 'EV' }
      );
    await flushMicrotasks();
    const afterCount = useCrmWorkstreamStore
      .getState()
      .getFieldChangeEventsForField('c417', 'aisha', 'income', 'basic').length;
    expect(afterCount).toBe(beforeCount + 1);
  });

  it('recomputes section completeness when a required field changes', () => {
    // Blank out a required field — completeness should drop.
    const before = useCrmCasesStore
      .getState()
      .casesById.c417.applicants.find((a) => a.clientId === 'aisha')?.profile
      .income?.completeness;
    useCrmCasesStore
      .getState()
      .setFactFindField(
        'c417',
        'aisha',
        'income',
        'basic',
        { t: 'text', v: '' },
        { changedBy: 'EV' }
      );
    const after = useCrmCasesStore
      .getState()
      .casesById.c417.applicants.find((a) => a.clientId === 'aisha')?.profile
      .income?.completeness;
    expect(after).toBeLessThan(before ?? 1);
  });

  it('rejects a display-string money at runtime', () => {
    expect(() =>
      useCrmCasesStore.getState().setFactFindField(
        'c417',
        'aisha',
        'income',
        'basic',
        // @ts-expect-error — intentional: runtime guard
        { t: 'money', v: '£42,000' },
        { changedBy: 'EV' }
      )
    ).toThrow();
  });

  it('captures priorValue and newValue in the event', async () => {
    useCrmCasesStore
      .getState()
      .setFactFindField(
        'c417',
        'aisha',
        'income',
        'basic',
        { t: 'money', v: 4_500_000 as Pence },
        { changedBy: 'EV' }
      );
    await flushMicrotasks();
    const events = useCrmWorkstreamStore
      .getState()
      .getFieldChangeEventsForField('c417', 'aisha', 'income', 'basic')
      .filter((e) => e.reason === 'edit');
    const last = events[events.length - 1];
    expect(last.priorValue).not.toBeNull();
    expect(last.newValue).toEqual({ t: 'money', v: 4_500_000 });
  });
});
