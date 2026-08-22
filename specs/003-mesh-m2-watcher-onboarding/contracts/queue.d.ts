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

// Frozen M2 — the Today needs-you queue + gate card (M2 rendering contract).
import type { GateDescriptor } from '../../002-mesh-m1-contracts-audit-spine/contracts/gates';
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
/** Fold-sourced: reads persisted worklist/fold state + mirrored gate approvals. Gates pinned; sort SLA→tier→age. */
export declare function selectTodayQueue(): QueueRow[];
export declare function selectQueueDegraded(): {
  degraded: boolean;
  failedSource?: QueueSource;
};

export interface GateCardProps {
  gate: GateDescriptor;
  draft?: { full: string; editable: true };
  provenance?: { disclosureRef?: string; reasons: string[] };
  onApprove: (editedDraft?: string) => void;
  onEdit?: (next: string) => void;
}
/** M2 holds exactly ONE live approval subscription — for the open gate card only. */
export declare function subscribeOpenGate(
  projectId: string,
  approvalId: string,
  onResolved: (decision: string) => void
): () => void;
