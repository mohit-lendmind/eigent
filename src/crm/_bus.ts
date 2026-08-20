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

// Downstream stores register write-side callbacks here at import time so
// upstream stores (which cannot import them without breaking FR-014's
// one-directional rule) can dispatch synchronously.
//
// One-way flow: cases → workstream (audit events, activity, resolve worklist);
// cases → documents (flip insight conflict).

import type {
  ActivityEvent,
  CaseId,
  DocumentId,
  FactFindSectionKey,
  FieldChangeEvent,
  StreamEntry,
  WorklistId,
  WorklistResolution,
} from './domain/types';

export interface WorkstreamSideBus {
  appendFieldChangeEvent: (
    event: Omit<FieldChangeEvent, 'id' | 'schemaVersion'>
  ) => void;
  noteActivity: (caseId: CaseId, activity: ActivityEvent) => void;
  pushStreamEntry: (
    caseId: CaseId,
    entry: Omit<StreamEntry, 'id' | 'schemaVersion' | 'caseId'> & {
      caseId?: CaseId;
    }
  ) => void;
  resolveWorklistItem: (
    id: WorklistId,
    opts: { resolution: WorklistResolution; resolvedBy: string }
  ) => WorklistItemResolveResult;
  findWorklistItemByConflict: (
    conflictId: string
  ) => { id: WorklistId; status: 'open' | 'resolved' } | null;
}

export interface DocumentsSideBus {
  flipInsightConflict: (
    docId: DocumentId,
    section: FactFindSectionKey,
    fieldKey: string,
    conflict: boolean
  ) => void;
}

export type WorklistItemResolveResult =
  'resolved' | 'already-resolved' | 'unknown';

let workstreamBus: WorkstreamSideBus | null = null;
let documentsBus: DocumentsSideBus | null = null;

export function registerWorkstreamBus(bus: WorkstreamSideBus): void {
  workstreamBus = bus;
}

export function registerDocumentsBus(bus: DocumentsSideBus): void {
  documentsBus = bus;
}

export function getWorkstreamBus(): WorkstreamSideBus | null {
  return workstreamBus;
}

export function getDocumentsBus(): DocumentsSideBus | null {
  return documentsBus;
}
