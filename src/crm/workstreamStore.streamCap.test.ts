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
import { CRM_SCHEMA_VERSION } from './domain/types';
import {
  STREAM_ENTRIES_PER_CASE_CAP,
  useCrmWorkstreamStore,
} from './workstreamStore';

describe('stream cap enforcement', () => {
  beforeEach(() => {
    useCrmWorkstreamStore.getState().resetForTests();
  });

  it('evicts oldest done entry when cap exceeded, inserts truncation marker', () => {
    // Fill with N done entries.
    for (let i = 0; i < STREAM_ENTRIES_PER_CASE_CAP; i++) {
      useCrmWorkstreamStore.getState().pushStreamEntry('cA', {
        kind: 'done',
        iconTone: 'muted',
        when: i,
        title: `d-${i}`,
      });
    }
    useCrmWorkstreamStore.getState().pushStreamEntry('cA', {
      kind: 'done',
      iconTone: 'muted',
      when: STREAM_ENTRIES_PER_CASE_CAP + 1,
      title: 'd-new',
    });
    const arr = useCrmWorkstreamStore.getState().streamByCase.cA;
    expect(arr.length).toBe(STREAM_ENTRIES_PER_CASE_CAP + 1);
    const truncationMarker = arr.find((e) =>
      e.title.startsWith('Older activity truncated')
    );
    expect(truncationMarker).toBeDefined();
    expect(truncationMarker?.truncatedCount).toBeGreaterThanOrEqual(1);
  });

  it("never evicts an unresolved 'conflict' entry linked to an open worklist item", () => {
    // Seed unresolved worklist item + conflict entry.
    useCrmWorkstreamStore.getState().upsertWorklistItems([
      {
        id: 'wl-unresolved',
        caseId: 'cB',
        kind: 'conflict',
        title: 'unresolved',
        detail: '',
        status: 'open',
        createdAt: 0,
        schemaVersion: CRM_SCHEMA_VERSION,
      },
    ]);
    for (let i = 0; i < STREAM_ENTRIES_PER_CASE_CAP; i++) {
      useCrmWorkstreamStore.getState().pushStreamEntry('cB', {
        kind: 'conflict',
        iconTone: 'muted',
        when: i,
        title: `conf-${i}`,
        linkedWorklistId: 'wl-unresolved',
      });
    }
    // Try to append one more — no eligible entries, so soft-append is allowed.
    useCrmWorkstreamStore.getState().pushStreamEntry('cB', {
      kind: 'conflict',
      iconTone: 'muted',
      when: STREAM_ENTRIES_PER_CASE_CAP,
      title: 'conf-new',
      linkedWorklistId: 'wl-unresolved',
    });
    const arr = useCrmWorkstreamStore.getState().streamByCase.cB;
    expect(arr.length).toBe(STREAM_ENTRIES_PER_CASE_CAP + 1);
    // No truncation marker (no eviction occurred).
    expect(
      arr.some((e) => e.title.startsWith('Older activity truncated'))
    ).toBe(false);
  });

  it('a conflict entry linked to a resolved worklist item IS evictable', () => {
    useCrmWorkstreamStore.getState().upsertWorklistItems([
      {
        id: 'wl-resolved',
        caseId: 'cC',
        kind: 'conflict',
        title: 'resolved',
        detail: '',
        status: 'resolved',
        resolvedAt: 100,
        resolvedBy: 'EV',
        createdAt: 0,
        schemaVersion: CRM_SCHEMA_VERSION,
      },
    ]);
    // Fill up with resolved-linked conflict entries.
    for (let i = 0; i < STREAM_ENTRIES_PER_CASE_CAP; i++) {
      useCrmWorkstreamStore.getState().pushStreamEntry('cC', {
        kind: 'conflict',
        iconTone: 'muted',
        when: i,
        title: `conf-${i}`,
        linkedWorklistId: 'wl-resolved',
      });
    }
    useCrmWorkstreamStore.getState().pushStreamEntry('cC', {
      kind: 'conflict',
      iconTone: 'muted',
      when: STREAM_ENTRIES_PER_CASE_CAP + 1,
      title: 'conf-new',
      linkedWorklistId: 'wl-resolved',
    });
    const arr = useCrmWorkstreamStore.getState().streamByCase.cC;
    const truncMarker = arr.find((e) =>
      e.title.startsWith('Older activity truncated')
    );
    expect(truncMarker).toBeDefined();
  });
});
