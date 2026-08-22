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

// Regression tests for review findings #2 (atomic resolveConflict:
// precompute EVERYTHING then commit; a mid-operation failure and retry
// finishes side-effects instead of no-oping) and #10 (upsertCases uses
// a single-pass upsert: touches only upserted cases, one clientsStore
// setState, back-refs computed before any commit).

import {
  CRM_SCHEMA_VERSION,
  seedCrmGoldenPath,
  useCrmCasesStore,
  useCrmClientsStore,
  useCrmDocumentsStore,
  useCrmWorkstreamStore,
  type Case,
  type Client,
} from '@/crm';
import type { Pence } from '@/crm/domain/money';
import { CONFLICT_C417_DANIEL_INCOME_BASIC } from '@/crm/fixtures/conflicts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function resetAll(): void {
  useCrmClientsStore.getState().resetForTests();
  useCrmCasesStore.getState().resetForTests();
  useCrmDocumentsStore.getState().resetForTests();
  useCrmWorkstreamStore.getState().resetForTests();
  localStorage.clear();
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('review regression — atomicity findings 2/10', () => {
  beforeEach(() => {
    resetAll();
    seedCrmGoldenPath({ ignoreDevGate: true, force: true });
  });

  it('resolveConflict: a retry after a partial completion finishes the remaining side-effects (finding 2 — resumability)', async () => {
    // Simulate a partial completion by driving a resolve that stamps the
    // conflict + case, then wiping ONE downstream side-effect (the stream
    // entry), and asserting a retry re-emits it. This matches the review's
    // "record.resolvedAt is set but stream entry never appended" bug.
    const cases = useCrmCasesStore.getState();
    cases.resolveConflict(CONFLICT_C417_DANIEL_INCOME_BASIC, {
      chosenValue: { t: 'money', v: 3_850_000 as Pence },
      method: 'confirm-value',
      resolvedBy: 'EV',
      reasoning: 'contract',
    });
    await flushMicrotasks();

    const conflict =
      useCrmCasesStore.getState().conflictsById[
        CONFLICT_C417_DANIEL_INCOME_BASIC
      ];
    expect(conflict.resolvedAt).toBeGreaterThan(0);

    // Wipe the "Conflict resolved" stream entry to simulate a mid-op crash
    // that recorded the conflict but never reached the stream push.
    const ws = useCrmWorkstreamStore.getState();
    const filtered = (ws.streamByCase.c417 ?? []).filter(
      (e) => !(e.kind === 'done' && e.title === 'Conflict resolved')
    );
    useCrmWorkstreamStore.setState({
      streamByCase: { ...ws.streamByCase, c417: filtered },
    });

    // Retry: because atomicity was precompute-then-commit AND downstream
    // dispatches are guarded by observable-state checks (stream/event
    // presence), the retry MUST re-append the missing stream entry, not
    // no-op on resolvedAt.
    cases.resolveConflict(CONFLICT_C417_DANIEL_INCOME_BASIC, {
      chosenValue: { t: 'money', v: 3_850_000 as Pence },
      method: 'confirm-value',
      resolvedBy: 'EV',
      reasoning: 'contract',
    });
    await flushMicrotasks();

    const after = useCrmWorkstreamStore.getState().streamByCase.c417 ?? [];
    const restored = after.filter(
      (e) => e.kind === 'done' && e.title === 'Conflict resolved'
    );
    expect(restored.length).toBe(1);
  });

  it('resolveConflict: throws BEFORE any state change when chosenValue.t="money" with non-number v (finding 2 — precompute validates first)', () => {
    const cases = useCrmCasesStore.getState();
    const casesSnapshot = { ...useCrmCasesStore.getState().casesById };
    const wsSnapshot = {
      ...useCrmWorkstreamStore.getState().streamByCase,
    };
    expect(() =>
      cases.resolveConflict(CONFLICT_C417_DANIEL_INCOME_BASIC, {
        // Invalid: money variant with a string v.
        chosenValue: { t: 'money', v: '3850000' as unknown as Pence },
        method: 'confirm-value',
        resolvedBy: 'EV',
      })
    ).toThrow(/Pence/);
    // No mutation should have leaked past the precompute-time validation.
    expect(useCrmCasesStore.getState().casesById).toEqual(casesSnapshot);
    expect(useCrmWorkstreamStore.getState().streamByCase).toEqual(wsSnapshot);
  });

  it('upsertCases: back-refs commit is one setState on clientsStore even for many upserts (finding 10 — single-pass)', () => {
    // Snapshot the clients store setState call count via a subscribe spy.
    const spy = vi.fn();
    const unsub = useCrmClientsStore.subscribe(spy);
    // Author two brand-new cases in ONE upsertCases call — each references
    // an existing client (daniel/olivia) so the back-ref path fires. The
    // atomicity fix means exactly one clientsStore setState is committed.
    const now = Date.now();
    const mkCase = (id: string, clientId: string): Case => ({
      id,
      ref: `LM-${id}`,
      type: 'Purchase',
      kind: 'FTB',
      label: id,
      stage: 'LEAD',
      completeness: 0,
      updated: now,
      applicants: [{ clientId, role: 'sole', profile: {}, completeness: 0 }],
      property: { address: '1', price: 1 as Pence },
      deposit: { amount: 1 as Pence, percent: 1, sources: [] },
      requirement: {
        loan: 1 as Pence,
        ltv: 1,
        ltvPercent: 1,
        lti: 1,
        termYears: 25,
        repaymentType: 'C&I',
        productType: '2yr',
      },
      affordability: {
        combinedIncome: 1 as Pence,
        monthlyCommitments: 1 as Pence,
      },
      schemaVersion: CRM_SCHEMA_VERSION,
    });
    useCrmCasesStore
      .getState()
      .upsertCases([mkCase('c-new-a', 'daniel'), mkCase('c-new-b', 'olivia')]);
    // At most one setState per upsertCases (the one committing back-refs).
    // Some invocations may commit zero if the client already has both refs.
    expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
    unsub();
    // Both cases persisted; existing cases untouched.
    const state = useCrmCasesStore.getState().casesById;
    expect(state['c-new-a']).toBeDefined();
    expect(state['c-new-b']).toBeDefined();
    expect(state['c417']).toBeDefined(); // seeded case untouched
  });

  it('upsertCases: touches only the upserted cases — pre-existing casesById entries are the SAME reference (finding 10)', () => {
    const priorC417 = useCrmCasesStore.getState().casesById['c417'];
    const priorC392 = useCrmCasesStore.getState().casesById['c392'];
    // Add a wholly new case — must not rebuild the map values for c417/c392.
    useCrmCasesStore.getState().upsertCases([
      {
        id: 'c-untouched-check',
        ref: 'LM-9999',
        type: 'Purchase',
        kind: 'FTB',
        label: 'x',
        stage: 'LEAD',
        completeness: 0,
        updated: Date.now(),
        applicants: [],
        property: { address: '1', price: 1 as Pence },
        deposit: { amount: 1 as Pence, percent: 1, sources: [] },
        requirement: {
          loan: 1 as Pence,
          ltv: 1,
          ltvPercent: 1,
          lti: 1,
          termYears: 25,
          repaymentType: 'C&I',
          productType: '2yr',
        },
        affordability: {
          combinedIncome: 1 as Pence,
          monthlyCommitments: 1 as Pence,
        },
        schemaVersion: CRM_SCHEMA_VERSION,
      },
    ]);
    // Reference equality: existing entries were carried through the spread,
    // not rebuilt. If a future implementation walks every case, the
    // shallow-equal on the `Case` object will fail.
    expect(useCrmCasesStore.getState().casesById['c417']).toBe(priorC417);
    expect(useCrmCasesStore.getState().casesById['c392']).toBe(priorC392);
  });

  it('upsertCases: back-refs for a case referencing a NEW client are queued for the client (finding 10)', () => {
    // Add a fresh client, then a case referencing them — the back-ref path
    // must merge without duplicates and without touching the other clients.
    const c: Client = {
      id: 'newclient',
      ref: 'newclient',
      firstName: 'New',
      lastName: 'Client',
      initials: 'NC',
      tint: 'placeholder',
      textCls: 'placeholder',
      cases: [],
      since: Date.now(),
      schemaVersion: CRM_SCHEMA_VERSION,
    };
    useCrmClientsStore.getState().upsertClients([c]);
    useCrmCasesStore.getState().upsertCases([
      {
        id: 'c-newref',
        ref: 'LM-newref',
        type: 'Purchase',
        kind: 'FTB',
        label: 'newref',
        stage: 'LEAD',
        completeness: 0,
        updated: Date.now(),
        applicants: [
          {
            clientId: 'newclient',
            role: 'sole',
            profile: {},
            completeness: 0,
          },
        ],
        property: { address: '1', price: 1 as Pence },
        deposit: { amount: 1 as Pence, percent: 1, sources: [] },
        requirement: {
          loan: 1 as Pence,
          ltv: 1,
          ltvPercent: 1,
          lti: 1,
          termYears: 25,
          repaymentType: 'C&I',
          productType: '2yr',
        },
        affordability: {
          combinedIncome: 1 as Pence,
          monthlyCommitments: 1 as Pence,
        },
        schemaVersion: CRM_SCHEMA_VERSION,
      },
    ]);
    const nc = useCrmClientsStore.getState().clientsById['newclient'];
    expect(nc.cases).toContain('c-newref');
    // Idempotent — a second identical upsert should not double the back-ref.
    useCrmCasesStore
      .getState()
      .upsertCases([useCrmCasesStore.getState().casesById['c-newref']]);
    const nc2 = useCrmClientsStore.getState().clientsById['newclient'];
    expect(nc2.cases.filter((cid) => cid === 'c-newref').length).toBe(1);
  });
});
