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

// Finding 1 (blocker) regression — the gate card must not bleed its edited-draft
// state across card switches. TodayQueue rendered <GateCard> without a React key
// inside a conditional that stays truthy when the selected gate changes from one
// open gate to another, so React reused the instance and the `edited` draft state
// (seeded on first mount) was never re-initialised. An adviser who opened one open
// G1 card and then another would see — and, on Approve, chain-record — the WRONG
// case's regulated draft body. These tests select between two open gates and assert
// the textarea shows the NEWLY-selected gate's own draft. They fail without the
// `key={selectedGate.id}` remount and pass with it.

import type { MirroredGate } from '@/crm/fold/eventLogStore';
import { useCrmEventLogStore } from '@/crm/fold/eventLogStore';
import { TodayQueue } from '@/crm/ui/TodayQueue';
import { useCrmWorkstreamStore } from '@/crm/workstreamStore';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

function openGate(overrides: Partial<MirroredGate>): MirroredGate {
  return {
    id: 'gate',
    gateId: 'G1',
    caseId: 'case',
    projectId: 'proj',
    approvalId: 'appr',
    title: 'Gate',
    reasons: ['a reason'],
    raisedAt: 1,
    status: 'open',
    ...overrides,
  };
}

describe('TodayQueue — switching between two open gate cards (finding 1)', () => {
  beforeEach(() => {
    useCrmEventLogStore.getState().resetForTests();
    useCrmWorkstreamStore.getState().resetForTests();
    localStorage.clear();
  });
  afterEach(cleanup);

  it('shows the second G1 draft after switching from the first, not the first draft', () => {
    const store = useCrmEventLogStore.getState();
    store.mirrorOpenGate(
      openGate({
        id: 'G1_caseA',
        caseId: 'caseA',
        projectId: 'proj_a',
        approvalId: 'appr_a',
        title: 'Case A — welcome pack',
        draftFull: 'Dear Alice and Andrew, welcome to the firm.',
        raisedAt: 1,
      })
    );
    store.mirrorOpenGate(
      openGate({
        id: 'G1_caseB',
        caseId: 'caseB',
        projectId: 'proj_b',
        approvalId: 'appr_b',
        title: 'Case B — welcome pack',
        draftFull: 'Dear Bob and Bianca, welcome to the firm.',
        raisedAt: 2,
      })
    );

    render(createElement(TodayQueue));

    // Open case A's card: its own draft shows.
    fireEvent.click(screen.getByText('Case A — welcome pack'));
    expect(screen.getByLabelText('crm.gate.draft-label')).toHaveValue(
      'Dear Alice and Andrew, welcome to the firm.'
    );

    // Switch to case B's card: it MUST show case B's own draft. Without the
    // per-gate key the reused instance keeps case A's `edited` body — the exact
    // state bleed that let an approval chain-record the wrong case's letter.
    fireEvent.click(screen.getByText('Case B — welcome pack'));
    expect(screen.getByLabelText('crm.gate.draft-label')).toHaveValue(
      'Dear Bob and Bianca, welcome to the firm.'
    );
  });

  it('shows the G1 full draft (not an empty box) after first opening a G7 card', () => {
    const store = useCrmEventLogStore.getState();
    // A propose-only G7 card carries no editable draft, so its GateCard mounts
    // with an empty `edited`. Selecting a G1 card afterwards must present the full
    // draft (FR-018), not the empty textarea a reused instance would keep.
    store.mirrorOpenGate(
      openGate({
        id: 'G7_caseX',
        gateId: 'G7',
        caseId: 'caseX',
        projectId: 'proj_x',
        approvalId: 'appr_x',
        title: 'Case X — retention nudge',
        raisedAt: 1,
      })
    );
    store.mirrorOpenGate(
      openGate({
        id: 'G1_caseY',
        gateId: 'G1',
        caseId: 'caseY',
        projectId: 'proj_y',
        approvalId: 'appr_y',
        title: 'Case Y — welcome pack',
        draftFull: 'Dear Yasmin, welcome to the firm.',
        raisedAt: 2,
      })
    );

    render(createElement(TodayQueue));

    // The G7 card is propose-only: no editable draft box.
    fireEvent.click(screen.getByText('Case X — retention nudge'));
    expect(screen.queryByLabelText('crm.gate.draft-label')).toBeNull();

    // Switching to the G1 card must reveal the full draft, not an empty box.
    fireEvent.click(screen.getByText('Case Y — welcome pack'));
    expect(screen.getByLabelText('crm.gate.draft-label')).toHaveValue(
      'Dear Yasmin, welcome to the firm.'
    );
  });
});
