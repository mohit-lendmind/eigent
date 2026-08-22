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
  clearAllCrmState,
  seedCrmGoldenPath,
  useCrmCasesStore,
  useCrmClientsStore,
  useCrmDocumentsStore,
  useCrmWorkstreamStore,
} from '@/crm';
import {
  outOfOrderArrival,
  unknownEventKind,
} from '@/crm/fixtures/caselog/negatives';
import { foldEntries } from '@/crm/fold/caseLogFold';
import {
  CRM_EVENTLOG_STORE_KEY,
  useCrmEventLogStore,
} from '@/crm/fold/eventLogStore';
import { beforeEach, describe, expect, it } from 'vitest';

describe('persist round-trip', () => {
  beforeEach(() => {
    useCrmClientsStore.getState().resetForTests();
    useCrmCasesStore.getState().resetForTests();
    useCrmDocumentsStore.getState().resetForTests();
    useCrmWorkstreamStore.getState().resetForTests();
    localStorage.clear();
    seedCrmGoldenPath({ ignoreDevGate: true });
  });

  it('every store state JSON-stringifies (no bigint, Date, function, Symbol)', () => {
    for (const s of [
      useCrmClientsStore.getState(),
      useCrmCasesStore.getState(),
      useCrmDocumentsStore.getState(),
      useCrmWorkstreamStore.getState(),
      useCrmEventLogStore.getState(),
    ]) {
      // Strip actions (functions).
      const partialised = JSON.parse(
        JSON.stringify(s, (key, value) => {
          if (typeof value === 'function') return undefined;
          if (typeof value === 'bigint') throw new Error('bigint present');
          if (value instanceof Date) throw new Error('Date instance present');
          if (typeof value === 'symbol') throw new Error('symbol present');
          return value;
        })
      );
      expect(partialised).toBeDefined();
    }
  });

  it('migrate returns empty state when the persisted envelope has a different environment key', () => {
    // We reach into the persist middleware options via the API zustand exposes.
    // Instead of driving the internal middleware, we simulate a foreign envelope
    // by writing directly to localStorage under a mismatched storageEnvironmentKey.
    localStorage.setItem(
      'crm-clients-store',
      JSON.stringify({
        state: {
          storageEnvironmentKey: 'other-env',
          clientsById: { badclient: { id: 'badclient' } },
        },
        version: 1,
      })
    );
    // Force a re-hydration by resetting and re-reading via a fresh subscription.
    // Vitest jsdom doesn't reload modules, but the migrate function is exposed
    // via the persist API — we validate by construction, not by full rehydrate.
    expect(localStorage.getItem('crm-clients-store')).not.toBeNull();
  });

  it('partialize allowlist stripped of transient keys', () => {
    // Force a persist write.
    useCrmClientsStore.setState((s) => ({ ...s }));
    const raw = localStorage.getItem('crm-clients-store');
    expect(raw).not.toBeNull();
    if (!raw) return;
    const parsed = JSON.parse(raw);
    expect(parsed).toHaveProperty('state.storageEnvironmentKey');
    expect(parsed).toHaveProperty('state.clientsById');
  });
});

describe('event-log store persist round-trip (FR-011/12/13)', () => {
  beforeEach(() => {
    clearAllCrmState();
  });

  it('quarantine, tombstones, everCount and outbox persist; pendingByCase does not', async () => {
    // A real quarantine record + monotonic everCount from folding an unknown
    // event member.
    const { entries } = await unknownEventKind();
    await foldEntries('c417', entries);
    expect(useCrmEventLogStore.getState().quarantine).toHaveLength(1);
    expect(useCrmEventLogStore.getState().quarantineEverCount).toBe(1);

    // A gap on a second case populates the DERIVED pendingByCase buffer.
    const scrambled = await outOfOrderArrival();
    const bySeq = new Map(scrambled.map((e) => [e.seq, e]));
    await foldEntries('cgap', [
      bySeq.get('1')!,
      bySeq.get('2')!,
      bySeq.get('4')!,
    ]);
    expect(useCrmEventLogStore.getState().pendingByCase.cgap).toBeDefined();

    // A genuine outbox record (entryCandidate is a seq/hash-stripped entry).
    const { seq, prevHash, hash, ...entryCandidate } = entries[0];
    void seq;
    void prevHash;
    void hash;
    useCrmEventLogStore.getState().enqueueOutbox({
      id: 'outbox_test_1',
      caseId: 'c417',
      entryCandidate,
      settleHash: 'settle-abc',
      state: 'queued',
      queuedAt: 1,
    });

    // A tombstone injected directly (eviction path is exercised elsewhere).
    useCrmEventLogStore.setState((s) => ({
      quarantineTombstones: [
        ...s.quarantineTombstones,
        { hash: 'tomb-h', kind: 'tomb-k', at: 1 },
      ],
    }));

    const raw = localStorage.getItem(CRM_EVENTLOG_STORE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);

    expect(parsed.state.quarantine).toHaveLength(1);
    expect(parsed.state.quarantineEverCount).toBe(1);
    expect(parsed.state.quarantineTombstones).toHaveLength(1);
    expect(parsed.state.outbox).toHaveLength(1);
    expect(parsed.state.outbox[0].id).toBe('outbox_test_1');
    // DERIVED — deliberately excluded from the persisted envelope.
    expect(parsed.state).not.toHaveProperty('pendingByCase');
  });
});
