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

// FR-022 — the three leading-indicator metrics. The pure core computes them from
// explicit inputs (median fact-find span, % approved-unedited, modeled minutes
// saved) and reports sample sizes so "no data yet" reads as null, not zero. The
// live selector derives the drafts leg from the durable G1 gate mirror.

import { useCrmEventLogStore } from '@/crm/fold/eventLogStore';
import {
  computeLeadingMetrics,
  MINUTES_SAVED_PER_DRAFT,
  MINUTES_SAVED_PER_WATCHER_DECISION,
  selectLeadingMetrics,
} from '@/crm/ui/leadingMetrics';
import { beforeEach, describe, expect, it } from 'vitest';

const RAISED = Date.UTC(2026, 5, 1, 9, 0, 0);

describe('leadingMetrics — FR-022 leading indicators', () => {
  beforeEach(() => {
    useCrmEventLogStore.getState().resetForTests();
    localStorage.clear();
  });

  it('reports null metrics with zero samples on an empty firm (first-run)', () => {
    const m = computeLeadingMetrics({});
    expect(m.timeToFactFindMs).toBeNull();
    expect(m.draftsApprovedUneditedPct).toBeNull();
    expect(m.adviserMinutesSaved).toBe(0);
    expect(m.sampleSizes).toEqual({
      drafts: 0,
      factFind: 0,
      watcherDecisions: 0,
    });
  });

  it('takes the median of ready fact-find spans and ignores unfinished ones', () => {
    const m = computeLeadingMetrics({
      factFind: [
        { startedAt: 0, readyAt: 10 * 60_000 },
        { startedAt: 0, readyAt: 30 * 60_000 },
        { startedAt: 0, readyAt: 50 * 60_000 },
        { startedAt: 0 }, // still open — excluded
      ],
    });
    expect(m.timeToFactFindMs).toBe(30 * 60_000);
    expect(m.sampleSizes.factFind).toBe(3);
  });

  it('counts only approved drafts and treats a missing edit flag as unedited', () => {
    const m = computeLeadingMetrics({
      drafts: [
        { raisedAt: 0, approvedAt: 1 }, // approved, unedited (no flag)
        { raisedAt: 0, approvedAt: 1, edited: true }, // approved, edited
        { raisedAt: 0 }, // still open — excluded
      ],
    });
    expect(m.sampleSizes.drafts).toBe(2);
    expect(m.draftsApprovedUneditedPct).toBe(50);
  });

  it('models adviser-minutes-saved from approved drafts and watcher decisions', () => {
    const m = computeLeadingMetrics({
      drafts: [
        { raisedAt: 0, approvedAt: 1 },
        { raisedAt: 0, approvedAt: 1 },
      ],
      watcherDecisions: 3,
    });
    expect(m.adviserMinutesSaved).toBe(
      2 * MINUTES_SAVED_PER_DRAFT + 3 * MINUTES_SAVED_PER_WATCHER_DECISION
    );
  });

  it('derives the drafts leg from the live G1 gate mirror', () => {
    const store = useCrmEventLogStore.getState();
    store.mirrorOpenGate({
      id: 'g1-open',
      gateId: 'G1',
      caseId: 'c1',
      projectId: 'p1',
      approvalId: 'a1',
      title: 'Onboarding send',
      reasons: [],
      raisedAt: RAISED,
      status: 'open',
    });
    store.mirrorOpenGate({
      id: 'g1-done',
      gateId: 'G1',
      caseId: 'c2',
      projectId: 'p2',
      approvalId: 'a2',
      title: 'Onboarding send',
      reasons: [],
      raisedAt: RAISED,
      status: 'open',
    });
    useCrmEventLogStore
      .getState()
      .resolveMirroredGate('g1-done', 'allow', RAISED + 60_000);

    const m = selectLeadingMetrics({ watcherDecisions: 1 });
    // One G1 resolved with allow → one approved draft; the open one is excluded.
    expect(m.sampleSizes.drafts).toBe(1);
    expect(m.draftsApprovedUneditedPct).toBe(100);
    expect(m.adviserMinutesSaved).toBe(
      MINUTES_SAVED_PER_DRAFT + MINUTES_SAVED_PER_WATCHER_DECISION
    );
  });
});
