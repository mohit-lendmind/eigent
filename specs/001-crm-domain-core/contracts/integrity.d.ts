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

/**
 * Contract: integrity repair. FR-036, FR-037.
 * Path in implementation: src/crm/integrity.ts
 *
 * A single ordered function invoked once in a queueMicrotask after all four
 * stores have hydrated. Each pass returns its section of the report.
 */

import type {
  CaseId,
  ClientId,
  DocumentId,
  EventId,
  StreamId,
  WorklistId,
} from './stores';

export interface RepairReport {
  ranAt: number;
  envMismatch: boolean;
  placeholderClientsCreated: ClientId[]; // pass #1
  retargetedDocuments: DocumentId[]; // pass #2
  prunedWorklist: WorklistId[]; // pass #3
  prunedStream: StreamId[]; // pass #4
  prunedActivity: EventId[]; // pass #4
  recomputedCases: CaseId[]; // pass #5
}

/**
 * Runs the five ordered passes:
 *   1. Placeholder clients for cases with missing applicant.clientId
 *   2. Placeholder document owners for documents with missing owner
 *   3. Prune orphan worklist items (caseId not in cases)
 *   4. Prune orphan stream entries and activity events
 *   5. Recompute case completeness for every touched case
 *
 * Side-effects:
 *   - Appends an ActivityEvent to workstreamStore per pass that mutated state (FR-037)
 *   - Caches the report so getLastRepairReport() can surface it
 *   - console.warn describes each pruned/replaced record with its id
 *
 * Idempotent when the state is already clean (all passes no-op and return an empty report).
 */
export declare function crmIntegrityRepair(): RepairReport;

/** Returns the most recent RepairReport, or null if none has run this session. FR-037 */
export declare function getLastRepairReport(): RepairReport | null;
