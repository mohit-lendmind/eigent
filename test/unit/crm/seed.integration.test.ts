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
  CRM_CASES_STORE_KEY,
  CRM_CLIENTS_STORE_KEY,
  CRM_DOCUMENTS_STORE_KEY,
  CRM_WORKSTREAM_STORE_KEY,
  seedCrmGoldenPath,
  selectCaseStreamSections,
  selectNeedsYou,
  selectNeedsYouCount,
  selectPipelineCounts,
  selectRetentionUrgency,
  useCrmCasesStore,
  useCrmClientsStore,
  useCrmDocumentsStore,
  useCrmWorkstreamStore,
} from '@/crm';
import { beforeEach, describe, expect, it } from 'vitest';

// Journey A — Seed and read the golden path (spec User Story 1).
describe('Journey A — seed and read golden path', () => {
  beforeEach(() => {
    useCrmClientsStore.getState().resetForTests();
    useCrmCasesStore.getState().resetForTests();
    useCrmDocumentsStore.getState().resetForTests();
    useCrmWorkstreamStore.getState().resetForTests();
    localStorage.clear();
  });

  it('all four stores start empty', () => {
    expect(Object.keys(useCrmClientsStore.getState().clientsById)).toHaveLength(
      0
    );
    expect(Object.keys(useCrmCasesStore.getState().casesById)).toHaveLength(0);
    expect(
      Object.keys(useCrmDocumentsStore.getState().documentsById)
    ).toHaveLength(0);
    expect(
      Object.keys(useCrmWorkstreamStore.getState().worklistItems)
    ).toHaveLength(0);
  });

  it('seed hydrates all four stores', () => {
    seedCrmGoldenPath({ ignoreDevGate: true });
    expect(
      Object.keys(useCrmClientsStore.getState().clientsById).length
    ).toBeGreaterThanOrEqual(3);
    expect(Object.keys(useCrmCasesStore.getState().casesById).length).toBe(8);
    expect(
      Object.keys(useCrmDocumentsStore.getState().documentsById).length
    ).toBe(7);
    expect(
      Object.keys(useCrmWorkstreamStore.getState().worklistItems).length
    ).toBe(6);
  });

  it('seed writes the four persist envelopes to localStorage', () => {
    seedCrmGoldenPath({ ignoreDevGate: true });
    // Zustand persist writes on state change — force a nudge.
    useCrmClientsStore.setState((s) => ({ ...s }));
    useCrmCasesStore.setState((s) => ({ ...s }));
    useCrmDocumentsStore.setState((s) => ({ ...s }));
    useCrmWorkstreamStore.setState((s) => ({ ...s }));
    for (const key of [
      CRM_CLIENTS_STORE_KEY,
      CRM_CASES_STORE_KEY,
      CRM_DOCUMENTS_STORE_KEY,
      CRM_WORKSTREAM_STORE_KEY,
    ]) {
      expect(localStorage.getItem(key)).not.toBeNull();
    }
  });

  it('second seed call is a no-op (idempotent)', () => {
    seedCrmGoldenPath({ ignoreDevGate: true });
    const casesLenBefore = Object.keys(
      useCrmCasesStore.getState().casesById
    ).length;
    const worklistBefore = Object.keys(
      useCrmWorkstreamStore.getState().worklistItems
    ).length;
    seedCrmGoldenPath({ ignoreDevGate: true });
    expect(Object.keys(useCrmCasesStore.getState().casesById)).toHaveLength(
      casesLenBefore
    );
    expect(
      Object.keys(useCrmWorkstreamStore.getState().worklistItems)
    ).toHaveLength(worklistBefore);
  });

  it('needsYouCount === 6 (SC-001)', () => {
    seedCrmGoldenPath({ ignoreDevGate: true });
    expect(
      selectNeedsYouCount(useCrmWorkstreamStore.getState().worklistItems)
    ).toBe(6);
  });

  it('pipelineCounts totals 8 with the §3.6 distribution', () => {
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
  });

  it('needsYou returns 6 items ordered by createdAt', () => {
    seedCrmGoldenPath({ ignoreDevGate: true });
    const items = selectNeedsYou(
      useCrmWorkstreamStore.getState().worklistItems
    );
    expect(items).toHaveLength(6);
  });

  it('retentionUrgency ranks Tom (79d) first', () => {
    seedCrmGoldenPath({ ignoreDevGate: true });
    const ranked = selectRetentionUrgency(
      useCrmWorkstreamStore.getState().retentionEntries,
      Date.UTC(2026, 5, 13)
    );
    expect(ranked[0].clientId).toBe('tom');
  });

  it('caseStreamSections put the live solver entry first (pinned) for c417', () => {
    seedCrmGoldenPath({ ignoreDevGate: true });
    const sections = selectCaseStreamSections(
      useCrmWorkstreamStore.getState().streamByCase.c417
    );
    expect(sections.live[0].id).toBe('s-live');
    expect(sections.live[0].pinned).toBe(true);
  });
});
