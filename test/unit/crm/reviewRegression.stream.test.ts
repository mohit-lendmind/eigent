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

// Regression tests for review findings #4 (stream cap eviction that actually
// shrinks: 50 past cap → length == cap, one coalesced marker, truncatedCount
// accounts for all evictions) and #5 (persist slice never drops protected
// entries — unresolved conflict/approval + markers; over-cap persist when
// nothing is evictable).

import {
  CRM_SCHEMA_VERSION,
  STREAM_ENTRIES_PER_CASE_CAP,
  useCrmWorkstreamStore,
} from '@/crm';
import { beforeEach, describe, expect, it } from 'vitest';

function resetWs(): void {
  useCrmWorkstreamStore.getState().resetForTests();
  localStorage.clear();
}

describe('review regression — stream cap findings 4/5', () => {
  beforeEach(() => {
    resetWs();
  });

  it('pushing 50 past cap: length == cap, ONE coalesced marker, truncatedCount accounts for all evictions (finding 4)', () => {
    // Fill up to cap with plain done entries (all evictable).
    for (let i = 0; i < STREAM_ENTRIES_PER_CASE_CAP; i += 1) {
      useCrmWorkstreamStore.getState().pushStreamEntry('cX', {
        kind: 'done',
        iconTone: 'muted',
        when: i,
        title: `d-${i}`,
      });
    }
    // Now push 50 more one-by-one. Each push triggers cap enforcement.
    for (let j = 0; j < 50; j += 1) {
      useCrmWorkstreamStore.getState().pushStreamEntry('cX', {
        kind: 'done',
        iconTone: 'muted',
        when: STREAM_ENTRIES_PER_CASE_CAP + j,
        title: `d-new-${j}`,
      });
    }
    const arr = useCrmWorkstreamStore.getState().streamByCase.cX;
    // Length must equal cap. The first push both evicts one and mints a
    // marker (length lands at cap+1); the next push over-evicts by two to
    // return to cap, and subsequent pushes stay at cap.
    expect(arr.length).toBe(STREAM_ENTRIES_PER_CASE_CAP);
    // ONE coalesced marker (never many).
    const markers = arr.filter((e) => (e.truncatedCount ?? 0) > 0);
    expect(markers.length).toBe(1);
    // The marker's truncatedCount accounts for every eviction — including
    // the extra one incurred by the marker taking a slot at first mint.
    expect(markers[0].truncatedCount).toBe(51);
  });

  it('persist partialize slice never drops unresolved conflict/approval linked entries (finding 5)', () => {
    // Seed a case with cap-worth of unresolved-linked conflict entries + one
    // more that triggers cap enforcement. NOTHING is evictable, so both push
    // and persist paths must retain the full over-cap array rather than
    // silently dropping protected entries.
    useCrmWorkstreamStore.getState().upsertWorklistItems([
      {
        id: 'wl-unresolved-persist',
        caseId: 'cP',
        kind: 'conflict',
        title: 'open',
        detail: '',
        status: 'open',
        createdAt: 0,
        schemaVersion: CRM_SCHEMA_VERSION,
      },
    ]);
    for (let i = 0; i < STREAM_ENTRIES_PER_CASE_CAP + 5; i += 1) {
      useCrmWorkstreamStore.getState().pushStreamEntry('cP', {
        kind: 'conflict',
        iconTone: 'muted',
        when: i,
        title: `c-${i}`,
        linkedWorklistId: 'wl-unresolved-persist',
      });
    }
    // Force a persist write.
    useCrmWorkstreamStore.setState((s) => ({ ...s }));
    const raw = localStorage.getItem('crm-workstream-store');
    expect(raw).not.toBeNull();
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const persistedArr = parsed.state.streamByCase.cP as unknown[];
    // Persist over-cap rather than silently drop protected entries.
    expect(persistedArr.length).toBe(STREAM_ENTRIES_PER_CASE_CAP + 5);
    // No truncation marker was minted (nothing was evictable).
    const markerCount = persistedArr.filter(
      (e) =>
        typeof (e as { truncatedCount?: number }).truncatedCount === 'number' &&
        (e as { truncatedCount: number }).truncatedCount > 0
    ).length;
    expect(markerCount).toBe(0);
  });

  it('cap enforcement never evicts a truncation marker even when other entries are evictable (finding 4/5)', () => {
    // Force one eviction to mint a marker.
    for (let i = 0; i < STREAM_ENTRIES_PER_CASE_CAP + 1; i += 1) {
      useCrmWorkstreamStore.getState().pushStreamEntry('cM', {
        kind: 'done',
        iconTone: 'muted',
        when: i,
        title: `d-${i}`,
      });
    }
    const withMarker = useCrmWorkstreamStore.getState().streamByCase.cM;
    expect(withMarker.some((e) => (e.truncatedCount ?? 0) > 0)).toBe(true);

    // Push another burst — marker must survive; only done entries evict.
    for (let j = 0; j < 25; j += 1) {
      useCrmWorkstreamStore.getState().pushStreamEntry('cM', {
        kind: 'done',
        iconTone: 'muted',
        when: 10_000 + j,
        title: `d-more-${j}`,
      });
    }
    const arr = useCrmWorkstreamStore.getState().streamByCase.cM;
    const markers = arr.filter((e) => (e.truncatedCount ?? 0) > 0);
    // Still exactly one marker, and its count grew to cover subsequent evictions.
    expect(markers.length).toBe(1);
    expect(markers[0].truncatedCount).toBeGreaterThanOrEqual(1 + 25);
  });

  it('capStreamForPersist respects never-evict — an over-cap array of unresolved-linked entries survives partialize verbatim (finding 5)', () => {
    // Two protected entries + fill with evictable done entries. Persist path
    // must keep the two protected entries in the persisted slice.
    useCrmWorkstreamStore.getState().upsertWorklistItems([
      {
        id: 'wl-approval',
        caseId: 'cE',
        kind: 'approval',
        title: 'approve me',
        detail: '',
        status: 'open',
        createdAt: 0,
        schemaVersion: CRM_SCHEMA_VERSION,
      },
    ]);
    useCrmWorkstreamStore.getState().pushStreamEntry('cE', {
      kind: 'approval',
      iconTone: 'muted',
      when: 0,
      title: 'approval-1',
      linkedWorklistId: 'wl-approval',
    });
    useCrmWorkstreamStore.getState().pushStreamEntry('cE', {
      kind: 'approval',
      iconTone: 'muted',
      when: 1,
      title: 'approval-2',
      linkedWorklistId: 'wl-approval',
    });
    for (let i = 0; i < STREAM_ENTRIES_PER_CASE_CAP; i += 1) {
      useCrmWorkstreamStore.getState().pushStreamEntry('cE', {
        kind: 'done',
        iconTone: 'muted',
        when: 100 + i,
        title: `d-${i}`,
      });
    }
    // Force persist.
    useCrmWorkstreamStore.setState((s) => ({ ...s }));
    const raw = localStorage.getItem('crm-workstream-store');
    if (!raw) throw new Error('persist did not write');
    const parsed = JSON.parse(raw);
    const persisted = parsed.state.streamByCase.cE as Array<{
      kind: string;
      linkedWorklistId?: string;
    }>;
    // Protected entries must be in the persisted slice.
    const protectedCount = persisted.filter(
      (e) => e.kind === 'approval' && e.linkedWorklistId === 'wl-approval'
    ).length;
    expect(protectedCount).toBe(2);
  });
});
