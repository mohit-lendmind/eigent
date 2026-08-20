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
import {
  selectCaseCompleteness,
  selectCaseStreamSections,
  selectDetSynCounts,
  selectNeedsYou,
  selectNeedsYouCount,
  selectOpenConflicts,
  selectPipelineCounts,
  selectRetentionUrgency,
} from './selectors';
import { useCrmWorkstreamStore } from './workstreamStore';

describe('selectors', () => {
  beforeEach(() => {
    useCrmClientsStore.getState().resetForTests();
    useCrmCasesStore.getState().resetForTests();
    useCrmDocumentsStore.getState().resetForTests();
    useCrmWorkstreamStore.getState().resetForTests();
  });

  it('returns stable empty constants on empty input (referential equality)', () => {
    const a = selectNeedsYou({});
    const b = selectNeedsYou({});
    expect(a).toBe(b);

    const p1 = selectRetentionUrgency([]);
    const p2 = selectRetentionUrgency([]);
    expect(p1).toBe(p2);

    const s1 = selectCaseStreamSections(undefined);
    const s2 = selectCaseStreamSections([]);
    expect(s1).toBe(s2);
  });

  it('selectNeedsYouCount === 6 after seed (SC-001)', () => {
    seedCrmGoldenPath({ ignoreDevGate: true });
    expect(
      selectNeedsYouCount(useCrmWorkstreamStore.getState().worklistItems)
    ).toBe(6);
  });

  it('selectPipelineCounts totals 8 with §3.6 distribution', () => {
    seedCrmGoldenPath({ ignoreDevGate: true });
    const counts = selectPipelineCounts(useCrmCasesStore.getState().casesById);
    expect(counts).toEqual({
      LEAD: 1,
      FACT_FIND: 2,
      SOURCING: 0,
      DIP: 1,
      APPLICATION: 1,
      VALUATION: 1,
      OFFER: 1,
      COMPLETION: 1,
    });
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(8);
  });

  it('selectCaseCompleteness(c417) sits in [0.7, 1] band (fixture-computed)', () => {
    seedCrmGoldenPath({ ignoreDevGate: true });
    const val = selectCaseCompleteness(
      'c417',
      useCrmCasesStore.getState().casesById
    );
    expect(val).toBeGreaterThan(0.7);
    expect(val).toBeLessThanOrEqual(1);
  });

  it('selectRetentionUrgency ranks Tom (79d) first', () => {
    seedCrmGoldenPath({ ignoreDevGate: true });
    const sorted = selectRetentionUrgency(
      useCrmWorkstreamStore.getState().retentionEntries,
      Date.UTC(2026, 5, 13)
    );
    expect(sorted[0].clientId).toBe('tom');
    expect(sorted[0].daysLeft).toBe(79);
  });

  it('selectCaseStreamSections returns live pinned first', () => {
    seedCrmGoldenPath({ ignoreDevGate: true });
    const sections = selectCaseStreamSections(
      useCrmWorkstreamStore.getState().streamByCase.c417
    );
    expect(sections.live.length).toBeGreaterThanOrEqual(1);
    expect(sections.live[0].id).toBe('s-live');
    expect(sections.needsYou.length).toBeGreaterThanOrEqual(1);
    expect(sections.activity.length).toBeGreaterThanOrEqual(1);
  });

  it('selectOpenConflicts includes the seeded salary conflict', () => {
    seedCrmGoldenPath({ ignoreDevGate: true });
    const open = selectOpenConflicts(useCrmCasesStore.getState().conflictsById);
    expect(open.some((c) => c.fieldKey === 'basic')).toBe(true);
  });

  it('selectNeedsYou lists items in createdAt order', () => {
    seedCrmGoldenPath({ ignoreDevGate: true });
    const items = selectNeedsYou(
      useCrmWorkstreamStore.getState().worklistItems
    );
    expect(items).toHaveLength(6);
    for (let i = 1; i < items.length; i++) {
      expect(items[i].createdAt).toBeGreaterThanOrEqual(items[i - 1].createdAt);
    }
  });

  it('selectDetSynCounts returns detable/synable counts', () => {
    seedCrmGoldenPath({ ignoreDevGate: true });
    const aisha = useCrmCasesStore
      .getState()
      .casesById.c417.applicants.find((a) => a.clientId === 'aisha');
    expect(aisha).toBeDefined();
    const counts = selectDetSynCounts(aisha!);
    expect(counts.det + counts.syn).toBeGreaterThan(0);
  });
});
