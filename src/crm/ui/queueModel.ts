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

// FR-016/017/018 — the Today "needs-you" queue model. It is fold-sourced: every
// row is built from state that already lives in the persisted CRM stores (the
// mirrored gate approvals + the open worklist items), never from a live edge
// read. Gates are pinned above worklist rows and sorted SLA→tier→age; each row
// carries a freshness badge derived from the case's fold source status. The one
// live approval subscription belongs to the open gate card (see GateCard), not
// here — this selector renders the durable mirror.

import type { GateDescriptor } from '../agentContracts/gates';
import { gateById } from '../agentContracts/gates';
import type { WorklistItem, WorklistKind } from '../domain/types';
import type {
  CaseFreshness,
  MirroredGate,
  SourceStatus,
} from '../fold/eventLogStore';
import { useCrmEventLogStore } from '../fold/eventLogStore';
import { useCrmWorkstreamStore } from '../workstreamStore';
import type { CrmTone } from './tones';

export type QueueSource = 'gate' | 'worklist' | 'fold';
export type Freshness = 'live' | 'as-of' | 'stale';

export interface QueueRow {
  id: string;
  source: QueueSource;
  caseId: string;
  tone: string;
  title: string;
  meta?: string;
  freshness: Freshness;
  sla?: { dueAt: number; tier: 1 | 2 | 3 };
  gate?: GateDescriptor;
}

const MINUTE_MS = 60_000;

// A fold source status collapses to the three-state freshness badge the row
// renders: a live fold reads 'live', any degraded/failed source reads 'stale',
// and a case we have never folded (or have no freshness for) reads 'as-of'.
function freshnessFor(
  caseId: string,
  freshness: Record<string, CaseFreshness>
): Freshness {
  const status: SourceStatus | undefined = freshness[caseId]?.sourceStatus;
  if (status === 'live') return 'live';
  if (status === 'stale' || status === 'failed' || status === 'no-project') {
    return 'stale';
  }
  return 'as-of';
}

// A worklist item's kind reads as a tone: a conflict is veto-grade (danger), a
// criteria/signature gap regulated-routine (warning), a retention win success,
// an approval brand, and a plain doc request informational.
const WORKLIST_TONE: Record<WorklistKind, CrmTone> = {
  conflict: 'danger',
  criteria: 'warning',
  doc: 'info',
  approval: 'brand',
  retention: 'success',
  signature: 'warning',
};

// A gate's triage tier reads as urgency: tier 1 danger, tier 2 warning, else
// neutral. Kept local so the queue model owns its own tone story.
function gateTone(tier: 1 | 2 | 3): CrmTone {
  if (tier === 1) return 'danger';
  if (tier === 2) return 'warning';
  return 'neutral';
}

// Pure core: fold state in, ordered rows out. Gates first (pinned), each with an
// SLA due-at derived from the descriptor's slaMinutes off its raise time, sorted
// soonest-due → most-urgent-tier → oldest. Worklist rows follow, oldest-first.
export function buildTodayQueue(
  openGates: Record<string, MirroredGate>,
  worklistItems: Record<string, WorklistItem>,
  freshness: Record<string, CaseFreshness>
): QueueRow[] {
  const gateRows: QueueRow[] = [];
  for (const mirror of Object.values(openGates)) {
    if (mirror.status !== 'open') continue;
    const descriptor = gateById(mirror.gateId);
    const dueAt = mirror.raisedAt + descriptor.slaMinutes * MINUTE_MS;
    gateRows.push({
      id: mirror.id,
      source: 'gate',
      caseId: mirror.caseId,
      tone: gateTone(descriptor.tier),
      title: mirror.title,
      meta: descriptor.id,
      freshness: freshnessFor(mirror.caseId, freshness),
      sla: { dueAt, tier: descriptor.tier },
      gate: descriptor,
    });
  }
  gateRows.sort((a, b) => {
    const dueA = a.sla!.dueAt;
    const dueB = b.sla!.dueAt;
    if (dueA !== dueB) return dueA - dueB;
    if (a.sla!.tier !== b.sla!.tier) return a.sla!.tier - b.sla!.tier;
    return openGates[a.id].raisedAt - openGates[b.id].raisedAt;
  });

  const worklistRows: QueueRow[] = [];
  for (const item of Object.values(worklistItems)) {
    if (item.status !== 'open') continue;
    worklistRows.push({
      id: item.id,
      source: 'worklist',
      caseId: item.caseId,
      tone: WORKLIST_TONE[item.kind] ?? 'neutral',
      title: item.title,
      meta: item.detail || undefined,
      freshness: freshnessFor(item.caseId, freshness),
    });
  }
  worklistRows.sort((a, b) => {
    const createdA = worklistItems[a.id].createdAt;
    const createdB = worklistItems[b.id].createdAt;
    return createdA - createdB;
  });

  return [...gateRows, ...worklistRows];
}

/** Fold-sourced Today queue: mirrored gate approvals pinned, then open worklist. */
export function selectTodayQueue(): QueueRow[] {
  const { openGates, freshness } = useCrmEventLogStore.getState();
  const { worklistItems } = useCrmWorkstreamStore.getState();
  return buildTodayQueue(openGates, worklistItems, freshness);
}

// Pure core: a degraded queue is one whose source failed for at least one case
// backing a rendered row — the surface must warn rather than silently show a
// stale queue. All three QueueSources can trip it (finding 20): the failure is
// attributed to the gate mirror when a failed case backs an open gate row, to
// the worklist when it backs an open worklist row, else to the fold. The gate
// and worklist maps are optional so the frozen zero-source-arg callers still
// resolve (attribution falls back to 'fold').
export function computeQueueDegraded(
  freshness: Record<string, CaseFreshness>,
  openGates: Record<string, MirroredGate> = {},
  worklistItems: Record<string, WorklistItem> = {}
): {
  degraded: boolean;
  failedSource?: QueueSource;
} {
  const failedCases = new Set<string>();
  for (const [caseId, entry] of Object.entries(freshness)) {
    if (
      entry.sourceStatus === 'failed' ||
      entry.sourceStatus === 'no-project'
    ) {
      failedCases.add(caseId);
    }
  }
  if (failedCases.size === 0) return { degraded: false };

  const gateBacked = Object.values(openGates).some(
    (g) => g.status === 'open' && failedCases.has(g.caseId)
  );
  if (gateBacked) return { degraded: true, failedSource: 'gate' };

  const worklistBacked = Object.values(worklistItems).some(
    (w) => w.status === 'open' && failedCases.has(w.caseId)
  );
  if (worklistBacked) return { degraded: true, failedSource: 'worklist' };

  return { degraded: true, failedSource: 'fold' };
}

/** True when any queue source has failed — the surface shows a banner. */
export function selectQueueDegraded(): {
  degraded: boolean;
  failedSource?: QueueSource;
} {
  const { openGates, freshness } = useCrmEventLogStore.getState();
  const { worklistItems } = useCrmWorkstreamStore.getState();
  return computeQueueDegraded(freshness, openGates, worklistItems);
}
