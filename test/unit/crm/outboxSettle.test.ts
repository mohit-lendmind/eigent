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

// Journey 3 (SC-004) — an adviser edit round-trips through the outbox. The edit
// applies to the F01 store at once and durably queues one record; the record is
// SOURCE (survives an environment-key wipe that clears derived state); a flush
// ships it via a mocked carrier; and when the canonical echo folds it settles
// EXACTLY once — matched by the pinned minus-writer-fields hash — with no state
// change and a referential no-op on a duplicate echo. A storage-quota edit is
// refused synchronously with a typed refusal + an OUTBOX_QUOTA item, and an
// unwired bus is loud, never a silent drop.

import {
  flushOutbox,
  OUTBOX_MAX_UNSETTLED,
  recordLocalEvent,
  seedCrmGoldenPath,
  useCrmCasesStore,
  useCrmClientsStore,
  useCrmDocumentsStore,
  useCrmWorkstreamStore,
  type LocalEventCandidate,
} from '@/crm';
import { assertBusWired } from '@/crm/_bus';
import type { Pence } from '@/crm/domain/money';
import { buildChain } from '@/crm/fixtures/caselog/buildChain';
import { foldEntries, selectUnsettledOutbox } from '@/crm/fold/caseLogFold';
import {
  getCrmEventLogStore,
  type OutboxRecord,
} from '@/crm/fold/eventLogStore';
import { configureOutboxCarrier } from '@/crm/fold/outbox';
import { beforeEach, describe, expect, it } from 'vitest';

const CASE = 'c417';

async function waitForOutbox(minLength: number): Promise<OutboxRecord[]> {
  for (let i = 0; i < 100; i++) {
    const outbox = getCrmEventLogStore().getState().outbox;
    if (outbox.length >= minLength) return outbox;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`outbox never reached length ${minLength}`);
}

function editDanielBasicIncome(v: number): void {
  useCrmCasesStore.getState().setFactFindField(
    CASE,
    'daniel',
    'income',
    'basic',
    {
      t: 'money',
      v: v as Pence,
    },
    { changedBy: 'EV' }
  );
}

function danielBasicIncome(): number | undefined {
  const c = useCrmCasesStore.getState().casesById[CASE];
  const daniel = c?.applicants.find((a) => a.clientId === 'daniel');
  const field = daniel?.profile.income?.fields.find((f) => f.k === 'basic');
  return field?.value.t === 'money' ? Number(field.value.v) : undefined;
}

describe('Journey 3 — outbox round-trip (SC-004)', () => {
  beforeEach(() => {
    useCrmClientsStore.getState().resetForTests();
    useCrmCasesStore.getState().resetForTests();
    useCrmDocumentsStore.getState().resetForTests();
    useCrmWorkstreamStore.getState().resetForTests();
    getCrmEventLogStore().getState().resetForTests();
    localStorage.clear();
    configureOutboxCarrier(null);
    seedCrmGoldenPath({ ignoreDevGate: true });
    // Seeding uses upsert paths, not the LWW write paths, so the outbox starts
    // clean; guard the invariant so a later seed change cannot mask a leak.
    getCrmEventLogStore().getState().resetForTests();
  });

  it('an edit applies locally and queues one unsettled outbox record', async () => {
    editDanielBasicIncome(4_000_000);
    expect(danielBasicIncome()).toBe(4_000_000);

    const outbox = await waitForOutbox(1);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].state).toBe('queued');
    expect(outbox[0].caseId).toBe(CASE);
    expect(selectUnsettledOutbox(CASE)).toBe(1);
  });

  it('the record is SOURCE — an environment-key wipe preserves the unflushed edit', async () => {
    editDanielBasicIncome(4_000_000);
    await waitForOutbox(1);

    // Rehydrate under a foreign environment key: derived state is wiped, but the
    // unflushed outbox (the only copy of the local edit) must survive (FR-013).
    // A differing persist version forces zustand to run migrate — the env-key
    // guard lives in that branch (a same-version rehydrate shallow-merges and
    // never wipes).
    const store = getCrmEventLogStore();
    const persisted = {
      state: {
        ...store.getState(),
        storageEnvironmentKey: 'foreign-env-1',
        watermarks: { [CASE]: '9' },
      },
      version: 0,
    };
    localStorage.setItem('crm-eventlog-store', JSON.stringify(persisted));
    await useCrmEventLogStore_rehydrate();

    const after = getCrmEventLogStore().getState();
    expect(after.outbox).toHaveLength(1);
    expect(after.outbox[0].state).toBe('queued');
    expect(after.watermarks[CASE]).toBeUndefined(); // derived state wiped
  });

  it('flush ships queued records via the mocked carrier', async () => {
    editDanielBasicIncome(4_000_000);
    await waitForOutbox(1);

    const seen: string[] = [];
    configureOutboxCarrier(async (_projectId, record) => {
      seen.push(record.id);
      return { ok: true, artifactId: `art_${record.id}` };
    });

    const result = await flushOutbox('proj_c417');
    expect(result.flushed).toBe(1);
    expect(seen).toHaveLength(1);
    expect(getCrmEventLogStore().getState().outbox[0].state).toBe('flushed');
  });

  it('the canonical echo settles the record exactly once, with no state change', async () => {
    editDanielBasicIncome(4_000_000);
    const outbox = await waitForOutbox(1);
    const candidate = outbox[0].entryCandidate as LocalEventCandidate;

    // The writer stamps the candidate into a genesis-rooted chain; its settle
    // hash (entry minus seq/prevHash/hash) matches the queued record's.
    const echo = await buildChain([candidate]);
    const valueBeforeEcho = danielBasicIncome();

    await foldEntries(CASE, echo);

    expect(danielBasicIncome()).toBe(valueBeforeEcho); // no double-apply
    expect(selectUnsettledOutbox(CASE)).toBe(0);
    expect(getCrmEventLogStore().getState().outbox[0].state).toBe('settled');

    // A duplicate echo is a referential no-op — nothing in the outbox changes.
    const outboxRef = getCrmEventLogStore().getState().outbox;
    await foldEntries(CASE, echo);
    expect(getCrmEventLogStore().getState().outbox).toBe(outboxRef);
    expect(selectUnsettledOutbox(CASE)).toBe(0);
  });

  it('a storage-quota edit is refused synchronously with a typed refusal + OUTBOX_QUOTA item', async () => {
    // Saturate the unsettled ceiling directly (500 sha256 enqueues would be
    // needlessly slow); the quota gate keys off unsettled depth alone.
    const store = getCrmEventLogStore();
    for (let i = 0; i < OUTBOX_MAX_UNSETTLED; i++) {
      store.getState().enqueueOutbox({
        id: `outbox_${CASE}_filler_${i}`,
        caseId: CASE,
        entryCandidate: {} as LocalEventCandidate,
        settleHash: `fill_${i}`,
        state: 'queued',
        queuedAt: i,
      });
    }

    const candidate = {
      kind: 'lm.caselog/1',
      caseId: CASE,
      firmId: 'lendmind',
      at: 1,
      actor: { kind: 'adviser', id: 'EV' },
      event: {
        type: 'field-change',
        payload: { clientId: 'daniel', section: 'income', fieldKey: 'basic' },
      },
      origin: { artifactId: 'outbox/quota', runId: '' },
      versions: { model: '', promptSha: '', skillSemver: '', skillSha: '' },
    } as unknown as LocalEventCandidate;

    const refusal = await recordLocalEvent(candidate);
    expect(refusal).toEqual({ ok: false, reason: 'quota' });

    // No silent drop: the ceiling still holds and an OUTBOX_QUOTA item is raised.
    expect(
      store.getState().outbox.filter((r) => r.state !== 'settled')
    ).toHaveLength(OUTBOX_MAX_UNSETTLED);
    const item = Object.values(
      useCrmWorkstreamStore.getState().worklistItems
    ).find((w) => w.reasonCode === 'OUTBOX_QUOTA');
    expect(item).toBeDefined();
  });

  it('a non-LWW candidate is refused (M1 accepts last-writer-wins kinds only)', async () => {
    const candidate = {
      kind: 'lm.caselog/1',
      caseId: CASE,
      firmId: 'lendmind',
      at: 1,
      actor: { kind: 'adviser', id: 'EV' },
      event: { type: 'stage-transition', payload: { stage: 'DIP' } },
      origin: { artifactId: 'outbox/x', runId: '' },
      versions: { model: '', promptSha: '', skillSemver: '', skillSha: '' },
    } as unknown as LocalEventCandidate;

    const refusal = await recordLocalEvent(candidate);
    expect(refusal).toEqual({ ok: false, reason: 'halted-unsupported' });
  });

  it('an unwired outbox bus is loud, not a silent no-op (FR-020)', () => {
    // NODE_ENV is 'test', so isDevLike() → true and the assertion throws.
    expect(() => assertBusWired(null, 'eventlog')).toThrow(/not wired/);
    expect(() => assertBusWired({}, 'eventlog')).not.toThrow();
  });
});

// Zustand persist attaches a rehydrate() to the store; wrap it so the test reads
// cleanly and awaits the (async) storage read.
async function useCrmEventLogStore_rehydrate(): Promise<void> {
  const store = getCrmEventLogStore() as unknown as {
    persist: { rehydrate: () => Promise<void> | void };
  };
  await store.persist.rehydrate();
}
