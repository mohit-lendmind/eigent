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

// Journey 3 (SC-003) — the Today queue model. Two fold sources (mirrored gate
// approvals + open worklist items) merge into one ordered queue: gates are
// pinned above worklist rows and sorted SLA→tier→age, each row carries a
// freshness badge derived from the case's fold status, and a failed source
// raises the degraded flag. The queue is built from persisted state alone — no
// live read per row — so this is all pure/selector logic.

import type { WorklistItem } from '@/crm/domain/types';
import type { CaseFreshness, MirroredGate } from '@/crm/fold/eventLogStore';
import { useCrmEventLogStore } from '@/crm/fold/eventLogStore';
import {
  buildTodayQueue,
  computeQueueDegraded,
  selectQueueDegraded,
  selectTodayQueue,
} from '@/crm/ui/queueModel';
import { useCrmWorkstreamStore } from '@/crm/workstreamStore';
import { beforeEach, describe, expect, it } from 'vitest';

const RAISED = Date.UTC(2026, 5, 1, 9, 0, 0);

function gate(
  overrides: Partial<MirroredGate> &
    Pick<MirroredGate, 'id' | 'gateId' | 'caseId'>
): MirroredGate {
  return {
    projectId: `proj_${overrides.caseId}`,
    approvalId: `appr_${overrides.id}`,
    title: `Gate ${overrides.gateId}`,
    reasons: [],
    raisedAt: RAISED,
    status: 'open',
    ...overrides,
  };
}

function worklist(
  overrides: Partial<WorklistItem> &
    Pick<WorklistItem, 'id' | 'caseId' | 'kind'>
): WorklistItem {
  return {
    title: `Task ${overrides.id}`,
    detail: 'detail',
    status: 'open',
    createdAt: RAISED,
    schemaVersion: 1,
    ...overrides,
  };
}

function freshnessMap(
  entries: Record<string, CaseFreshness>
): Record<string, CaseFreshness> {
  return entries;
}

describe('queueModel — Journey 3: merge, pin, sort, freshness, degraded (SC-003)', () => {
  beforeEach(() => {
    useCrmEventLogStore.getState().resetForTests();
    useCrmWorkstreamStore.getState().resetForTests();
    localStorage.clear();
  });

  it('merges two sources with gates pinned above worklist rows', () => {
    const rows = buildTodayQueue(
      { g1: gate({ id: 'g1', gateId: 'G1', caseId: 'c1' }) },
      { w1: worklist({ id: 'w1', caseId: 'c2', kind: 'doc' }) },
      {}
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].source).toBe('gate');
    expect(rows[1].source).toBe('worklist');
  });

  it('sorts gates by SLA due-at, then tier, then age', () => {
    // G4a (sla 120, tier 1) is due before G1 (sla 240, tier 2) at equal raise.
    const rows = buildTodayQueue(
      {
        slow: gate({ id: 'slow', gateId: 'G1', caseId: 'c1' }),
        fast: gate({ id: 'fast', gateId: 'G4a', caseId: 'c2' }),
      },
      {},
      {}
    );
    expect(rows.map((r) => r.id)).toEqual(['fast', 'slow']);
    expect(rows[0].sla).toEqual({
      dueAt: RAISED + 120 * 60_000,
      tier: 1,
    });
  });

  it('breaks an SLA tie by tier then by raise age', () => {
    // Two gates whose due-at coincide: G4a raised later (120m) vs G1 raised
    // 120m earlier (240m) both due at the same instant — tier 1 wins.
    const earlier = RAISED - 120 * 60_000;
    const rows = buildTodayQueue(
      {
        g1: gate({ id: 'g1', gateId: 'G1', caseId: 'c1', raisedAt: earlier }),
        g4a: gate({ id: 'g4a', gateId: 'G4a', caseId: 'c2', raisedAt: RAISED }),
      },
      {},
      {}
    );
    // Both due at RAISED + 120m; G4a is tier 1, so it sorts first.
    expect(rows[0].id).toBe('g4a');
  });

  it('derives a freshness badge from the case fold status', () => {
    const rows = buildTodayQueue(
      {
        live: gate({ id: 'live', gateId: 'G1', caseId: 'c-live' }),
        stale: gate({ id: 'stale', gateId: 'G1', caseId: 'c-stale' }),
        cold: gate({ id: 'cold', gateId: 'G1', caseId: 'c-cold' }),
      },
      {},
      freshnessMap({
        'c-live': { lastFoldedAt: 1, sourceStatus: 'live' },
        'c-stale': { lastFoldedAt: 1, sourceStatus: 'failed' },
      })
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get('live')!.freshness).toBe('live');
    expect(byId.get('stale')!.freshness).toBe('stale');
    expect(byId.get('cold')!.freshness).toBe('as-of');
  });

  it('excludes resolved gates and resolved worklist items', () => {
    const rows = buildTodayQueue(
      {
        g1: gate({ id: 'g1', gateId: 'G1', caseId: 'c1', status: 'resolved' }),
      },
      {
        w1: worklist({
          id: 'w1',
          caseId: 'c2',
          kind: 'doc',
          status: 'resolved',
        }),
      },
      {}
    );
    expect(rows).toHaveLength(0);
  });

  it('flags a degraded queue when a fold source failed', () => {
    expect(computeQueueDegraded({}).degraded).toBe(false);
    const degraded = computeQueueDegraded({
      c1: { lastFoldedAt: 1, sourceStatus: 'no-project' },
    });
    expect(degraded.degraded).toBe(true);
    expect(degraded.failedSource).toBe('fold');
  });

  it('reads live store state through the zero-arg selectors', () => {
    useCrmEventLogStore
      .getState()
      .mirrorOpenGate(gate({ id: 'g1', gateId: 'G1', caseId: 'c1' }));
    useCrmEventLogStore
      .getState()
      .setCaseFreshness('c1', { lastFoldedAt: 1, sourceStatus: 'failed' });
    useCrmWorkstreamStore
      .getState()
      .upsertWorklistItems([worklist({ id: 'w1', caseId: 'c2', kind: 'doc' })]);

    const rows = selectTodayQueue();
    expect(rows.map((r) => r.source)).toEqual(['gate', 'worklist']);
    expect(selectQueueDegraded().degraded).toBe(true);
  });

  it('returns an empty queue when nothing is open (all-clear / first-run)', () => {
    expect(buildTodayQueue({}, {}, {})).toEqual([]);
    expect(selectTodayQueue()).toEqual([]);
  });
});
