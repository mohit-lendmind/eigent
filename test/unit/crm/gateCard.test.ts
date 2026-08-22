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

// SC-005 surface half — the approval gate card. It must render from the frozen
// gate registry alone (tier + SLA shown, batch control inert), a G1 onboarding
// card must show the full draft plus its provenance, approving must hand back
// the edited draft, and subscribeOpenGate — the ONE live approval subscription
// M2 holds — must fire exactly once when the persisted mirror resolves.

import { gateById } from '@/crm/agentContracts/gates';
import type { MirroredGate } from '@/crm/fold/eventLogStore';
import { useCrmEventLogStore } from '@/crm/fold/eventLogStore';
import { GateCard, subscribeOpenGate } from '@/crm/ui/GateCard';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

describe('GateCard — renders from the registry, approves the edited draft', () => {
  it('shows the gate name, tier, and SLA from the descriptor alone', () => {
    render(
      createElement(GateCard, {
        gate: gateById('G7'),
        onApprove: () => {},
      })
    );
    expect(screen.getByText(gateById('G7').name)).toBeInTheDocument();
    expect(screen.getByText(/Tier 2/)).toBeInTheDocument();
    expect(screen.getByText(/SLA 240m/)).toBeInTheDocument();
  });

  it('keeps the batch control inert in M2', () => {
    render(
      createElement(GateCard, { gate: gateById('G1'), onApprove: () => {} })
    );
    const batch = screen.getByRole('button', { name: 'Batch' });
    expect(batch).toBeDisabled();
  });

  it('shows a G1 draft with provenance and returns the edited draft on approve', () => {
    const onApprove = vi.fn();
    const onEdit = vi.fn();
    render(
      createElement(GateCard, {
        gate: gateById('G1'),
        draft: { full: 'Dear client', editable: true },
        provenance: {
          disclosureRef: 'IDD v3',
          reasons: ['New case reached onboarding'],
        },
        onApprove,
        onEdit,
      })
    );
    expect(screen.getByText(/IDD v3/)).toBeInTheDocument();
    expect(screen.getByText('New case reached onboarding')).toBeInTheDocument();

    const textarea = screen.getByLabelText('Onboarding draft');
    fireEvent.change(textarea, { target: { value: 'Dear client, edited' } });
    expect(onEdit).toHaveBeenCalledWith('Dear client, edited');

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onApprove).toHaveBeenCalledWith('Dear client, edited');
  });

  it('approves a non-draft gate with no edited draft', () => {
    const onApprove = vi.fn();
    render(createElement(GateCard, { gate: gateById('G7'), onApprove }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onApprove).toHaveBeenCalledWith(undefined);
  });
});

describe('subscribeOpenGate — the one live approval subscription', () => {
  beforeEach(() => {
    useCrmEventLogStore.getState().resetForTests();
    localStorage.clear();
  });

  function openGate(): MirroredGate {
    return {
      id: 'g-live',
      gateId: 'G1',
      caseId: 'c1',
      projectId: 'proj_c1',
      approvalId: 'appr_1',
      title: 'Gate G1',
      reasons: [],
      raisedAt: 1,
      status: 'open',
    };
  }

  it('fires once when the mirrored gate resolves', () => {
    useCrmEventLogStore.getState().mirrorOpenGate(openGate());
    const onResolved = vi.fn();
    const unsubscribe = subscribeOpenGate('proj_c1', 'appr_1', onResolved);
    expect(onResolved).not.toHaveBeenCalled();

    useCrmEventLogStore.getState().resolveMirroredGate('g-live', 'allow', 2);
    expect(onResolved).toHaveBeenCalledTimes(1);
    expect(onResolved).toHaveBeenCalledWith('allow');

    // A further store change must not re-fire the one-shot subscription.
    useCrmEventLogStore.getState().setCaseFreshness('c1', {
      lastFoldedAt: 3,
      sourceStatus: 'live',
    });
    expect(onResolved).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('fires immediately if the mirror is already resolved on subscribe', () => {
    const resolved = {
      ...openGate(),
      status: 'resolved' as const,
      decision: 'deny',
      resolvedAt: 5,
    };
    useCrmEventLogStore.getState().mirrorOpenGate(resolved);
    const onResolved = vi.fn();
    const unsubscribe = subscribeOpenGate('proj_c1', 'appr_1', onResolved);
    expect(onResolved).toHaveBeenCalledWith('deny');
    unsubscribe();
  });
});
