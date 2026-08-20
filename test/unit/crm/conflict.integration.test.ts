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

import {
  seedCrmGoldenPath,
  useCrmCasesStore,
  useCrmClientsStore,
  useCrmDocumentsStore,
  useCrmWorkstreamStore,
} from '@/crm';
import {
  clearAllCrmState,
  exportCaseFile,
  importCaseFile,
} from '@/crm/caseFile';
import type { Pence } from '@/crm/domain/money';
import { CONFLICT_C417_DANIEL_INCOME_BASIC } from '@/crm/fixtures/conflicts';
import { beforeEach, describe, expect, it } from 'vitest';

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// Journey B — Resolve conflict atomically with a persisted audit.
describe('Journey B — atomic conflict resolution', () => {
  beforeEach(() => {
    useCrmClientsStore.getState().resetForTests();
    useCrmCasesStore.getState().resetForTests();
    useCrmDocumentsStore.getState().resetForTests();
    useCrmWorkstreamStore.getState().resetForTests();
    localStorage.clear();
    seedCrmGoldenPath({ ignoreDevGate: true });
  });

  it('one call produces all 7 side-effects (spec User Story 2 acceptance #1)', async () => {
    // Initial state assertions
    const before = useCrmCasesStore.getState().casesById.c417;
    const beforeDaniel = before.applicants.find((a) => a.clientId === 'daniel');
    const beforeField = beforeDaniel?.profile.income?.fields.find(
      (f) => f.k === 'basic'
    );
    expect(beforeField?.conflictId).toBe(CONFLICT_C417_DANIEL_INCOME_BASIC);

    const d5Before = useCrmDocumentsStore.getState().documentsById.d5;
    const salaryInsightBefore = d5Before.insights.find(
      (i) => i.label === 'Salary income basic'
    );
    expect(salaryInsightBefore?.conflict).toBe(true);

    const w1Before = useCrmWorkstreamStore.getState().worklistItems.w1;
    expect(w1Before.status).toBe('open');

    const streamLenBefore = (
      useCrmWorkstreamStore.getState().streamByCase.c417 ?? []
    ).length;

    // Single call: resolve
    useCrmCasesStore
      .getState()
      .resolveConflict(CONFLICT_C417_DANIEL_INCOME_BASIC, {
        chosenValue: { t: 'money', v: 3_850_000 as Pence },
        method: 'confirm-value',
        resolvedBy: 'EV',
        reasoning: 'Contract is the authoritative source',
      });
    await flushMicrotasks();

    // (a) field mutation
    const after = useCrmCasesStore.getState().casesById.c417;
    const afterDaniel = after.applicants.find((a) => a.clientId === 'daniel');
    const afterField = afterDaniel?.profile.income?.fields.find(
      (f) => f.k === 'basic'
    );
    expect(afterField?.value).toEqual({ t: 'money', v: 3_850_000 });
    expect(afterField?.src).toBe('det');
    // conflictId reference cleared on the field
    expect(afterField?.conflictId).toBeUndefined();

    // (b) ConflictRecord: resolved + values retained
    const conflict =
      useCrmCasesStore.getState().conflictsById[
        CONFLICT_C417_DANIEL_INCOME_BASIC
      ];
    expect(conflict.resolvedAt).toBeGreaterThan(0);
    expect(conflict.resolvedBy).toBe('EV');
    expect(conflict.values).toHaveLength(2);
    const values = conflict.values.map((v) =>
      v.value.t === 'money' ? Number(v.value.v) : 0
    );
    expect(values).toContain(3_850_000);
    expect(values).toContain(3_730_000);

    // (c) document insight flip
    const d5After = useCrmDocumentsStore.getState().documentsById.d5;
    const salaryInsightAfter = d5After.insights.find(
      (i) => i.label === 'Salary income basic'
    );
    expect(salaryInsightAfter?.conflict).toBe(false);

    // (d) worklist w1 resolved (retained)
    const w1After = useCrmWorkstreamStore.getState().worklistItems.w1;
    expect(w1After).toBeDefined();
    expect(w1After.status).toBe('resolved');
    expect(w1After.resolvedBy).toBe('EV');

    // (e) stream entry with reasoning trace
    const streamAfter =
      useCrmWorkstreamStore.getState().streamByCase.c417 ?? [];
    expect(streamAfter.length).toBe(streamLenBefore + 1);
    const doneEntry = streamAfter[streamAfter.length - 1];
    expect(doneEntry.kind).toBe('done');
    expect(doneEntry.trace).toBeDefined();
    expect(doneEntry.trace?.confidence).toBe(1);
    expect(doneEntry.trace?.alternatives?.length).toBeGreaterThanOrEqual(1);

    // (f) FieldChangeEvent
    const events = useCrmWorkstreamStore
      .getState()
      .getFieldChangeEventsForField('c417', 'daniel', 'income', 'basic');
    const resolutionEvent = events.find(
      (e) => e.reason === 'conflict-resolution'
    );
    expect(resolutionEvent).toBeDefined();
    expect(resolutionEvent?.conflictId).toBe(CONFLICT_C417_DANIEL_INCOME_BASIC);

    // (g) section completeness recomputed — should still be a number.
    expect(afterDaniel?.profile.income?.completeness).toBeGreaterThan(0);
  });

  it('idempotent — second call is a no-op', async () => {
    useCrmCasesStore
      .getState()
      .resolveConflict(CONFLICT_C417_DANIEL_INCOME_BASIC, {
        chosenValue: { t: 'money', v: 3_850_000 as Pence },
        method: 'confirm-value',
        resolvedBy: 'EV',
      });
    await flushMicrotasks();

    const streamLen = (useCrmWorkstreamStore.getState().streamByCase.c417 ?? [])
      .length;
    const events = useCrmWorkstreamStore
      .getState()
      .getFieldChangeEventsForField('c417', 'daniel', 'income', 'basic')
      .filter((e) => e.reason === 'conflict-resolution').length;

    useCrmCasesStore
      .getState()
      .resolveConflict(CONFLICT_C417_DANIEL_INCOME_BASIC, {
        chosenValue: { t: 'money', v: 3_730_000 as Pence },
        method: 'ask-client',
        resolvedBy: 'someone-else',
      });
    await flushMicrotasks();

    expect(
      (useCrmWorkstreamStore.getState().streamByCase.c417 ?? []).length
    ).toBe(streamLen);
    expect(
      useCrmWorkstreamStore
        .getState()
        .getFieldChangeEventsForField('c417', 'daniel', 'income', 'basic')
        .filter((e) => e.reason === 'conflict-resolution').length
    ).toBe(events);
  });

  it('round-trips through export → wipe → import (Journey C dep)', async () => {
    useCrmCasesStore
      .getState()
      .resolveConflict(CONFLICT_C417_DANIEL_INCOME_BASIC, {
        chosenValue: { t: 'money', v: 3_850_000 as Pence },
        method: 'confirm-value',
        resolvedBy: 'EV',
        reasoning: 'Contract is authoritative',
      });
    await flushMicrotasks();

    const exportResult = exportCaseFile('c417');
    if (!('records' in exportResult)) throw new Error('export failed');

    clearAllCrmState();
    expect(Object.keys(useCrmCasesStore.getState().casesById).length).toBe(0);

    const importResult = importCaseFile(exportResult);
    expect(importResult).toEqual(expect.objectContaining({ ok: true }));

    // Post-import: resolved conflict, event, and done-kind stream entry all reappear
    const conflict =
      useCrmCasesStore.getState().conflictsById[
        CONFLICT_C417_DANIEL_INCOME_BASIC
      ];
    expect(conflict?.resolvedAt).toBeGreaterThan(0);
    const events = useCrmWorkstreamStore
      .getState()
      .getFieldChangeEventsForField('c417', 'daniel', 'income', 'basic')
      .filter((e) => e.reason === 'conflict-resolution');
    expect(events.length).toBeGreaterThanOrEqual(1);
    const stream = useCrmWorkstreamStore.getState().streamByCase.c417 ?? [];
    expect(stream.some((e) => e.kind === 'done' && e.trace)).toBe(true);
  });
});
