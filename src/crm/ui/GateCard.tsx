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

// FR-019/FR-008 — the approval gate card. It renders entirely from a
// GateDescriptor (the frozen registry, see ../agentContracts/gates): the tier
// and SLA are shown, and batching is INERT in M2 (a batchable gate says so but
// the control is disabled). A G1 onboarding card additionally shows the full
// draft with inline edit plus its provenance (disclosure ref + reasons), so the
// adviser approves what they can actually read and change. `subscribeOpenGate`
// is the ONE live approval subscription M2 holds — it watches the persisted
// gate mirror and fires when the open card's approval resolves.

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useState } from 'react';
import type { GateDescriptor } from '../agentContracts/gates';
import { useCrmEventLogStore } from '../fold/eventLogStore';
import { StatusPill } from './primitives/StatusPill';
import { tierTone } from './tones';

export interface GateCardProps {
  gate: GateDescriptor;
  draft?: { full: string; editable: true };
  provenance?: { disclosureRef?: string; reasons: string[] };
  onApprove: (editedDraft?: string) => void;
  onEdit?: (next: string) => void;
  /**
   * Deny path: an adviser must be able to reject a regulated send, not only
   * approve it (finding 18). Optional to keep the frozen GateCardProps
   * assignable; when unset the reject control is not rendered.
   */
  onReject?: () => void;
}

function tierLabel(tier: 1 | 2 | 3): string {
  if (tier === 1) return 'Tier 1 · veto-grade';
  if (tier === 2) return 'Tier 2 · regulated';
  return 'Tier 3 · operational';
}

export function GateCard({
  gate,
  draft,
  provenance,
  onApprove,
  onEdit,
  onReject,
}: GateCardProps) {
  const [edited, setEdited] = useState(draft?.full ?? '');
  const isG1 = gate.id === 'G1';
  const showDraft = isG1 && draft !== undefined;

  return (
    <section
      className="flex flex-col gap-3 rounded-lg border border-ds-bg-neutral-default-default bg-ds-bg-neutral-subtle-default p-4"
      aria-label={`Gate ${gate.id}`}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-ds-text-neutral-strong-default">
            {gate.name}
          </span>
          <span className="text-xs text-ds-text-neutral-default-default">
            {gate.id} · {gate.basis}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill tone={tierTone(gate.tier)} label={tierLabel(gate.tier)} />
          <StatusPill tone="info" label={`SLA ${gate.slaMinutes}m`} />
        </div>
      </header>

      {provenance !== undefined && (
        <div className="flex flex-col gap-1 rounded-md bg-ds-bg-neutral-muted-default p-2">
          {provenance.disclosureRef !== undefined && (
            <span className="text-xs text-ds-text-neutral-default-default">
              Disclosure: {provenance.disclosureRef}
            </span>
          )}
          <ul className="list-disc pl-4 text-xs text-ds-text-neutral-default-default">
            {provenance.reasons.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
        </div>
      )}

      {showDraft && (
        <Textarea
          aria-label="Onboarding draft"
          value={edited}
          onChange={(e) => {
            setEdited(e.target.value);
            onEdit?.(e.target.value);
          }}
        />
      )}

      <footer className="flex items-center justify-between gap-2">
        <span className="text-xs text-ds-text-neutral-muted-default">
          {gate.batchable ? 'Batchable (disabled in M2)' : 'Single approval'}
        </span>
        <div className="flex items-center gap-2">
          <Button
            disabled
            aria-disabled
            title="Batch approval is not available in M2"
          >
            Batch
          </Button>
          {onReject !== undefined && (
            <Button
              variant="secondary"
              tone="error"
              onClick={() => onReject()}
              title="Reject this send"
            >
              Reject
            </Button>
          )}
          <Button onClick={() => onApprove(showDraft ? edited : undefined)}>
            Approve
          </Button>
        </div>
      </footer>
    </section>
  );
}

// The single live approval subscription. It watches the persisted gate mirror
// for the (projectId, approvalId) the open card resolves and fires `onResolved`
// once the mirror flips to resolved — the verdict travels the edge elsewhere;
// this only reflects it into the card. Returns an unsubscribe.
export function subscribeOpenGate(
  projectId: string,
  approvalId: string,
  onResolved: (decision: string) => void
): () => void {
  let fired = false;
  const check = (state: ReturnType<typeof useCrmEventLogStore.getState>) => {
    if (fired) return;
    for (const gate of Object.values(state.openGates)) {
      if (
        gate.projectId === projectId &&
        gate.approvalId === approvalId &&
        gate.status === 'resolved' &&
        gate.decision !== undefined
      ) {
        fired = true;
        onResolved(gate.decision);
        return;
      }
    }
  };
  const unsubscribe = useCrmEventLogStore.subscribe(check);
  check(useCrmEventLogStore.getState());
  return unsubscribe;
}
