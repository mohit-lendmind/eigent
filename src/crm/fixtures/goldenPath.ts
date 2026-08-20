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
  CRM_SCHEMA_VERSION,
  type Case,
  type Client,
  type ComplianceRecord,
  type ConflictRecord,
  type CriterionCheck,
  type CrmDocument,
  type DocChecklistItem,
  type Product,
  type RetentionEntry,
  type StreamEntry,
  type WorklistItem,
} from '../domain/types';
import { case392 } from './case392';
import { case417 } from './case417';
import { goldenPathChecklist } from './checklists';
import { adviserEleanorVance, goldenPathClients } from './clients';
import { compliance417 } from './compliance';
import { goldenPathConflicts } from './conflicts';
import { goldenPathCriteria } from './criteria';
import { goldenPathDocuments } from './documents';
import { pipelineClientStubs, pipelineStubs } from './pipeline';
import { goldenPathProducts } from './products';
import { goldenPathRetention } from './retention';
import { stream392 } from './stream392';
import { stream417 } from './stream417';
import { goldenPathWorklist } from './worklist';

const pipelineStubClients: Client[] = pipelineClientStubs.map((stub) => ({
  id: stub.id,
  ref: stub.id,
  firstName: stub.firstName,
  lastName: stub.lastName,
  initials: stub.initials,
  tint: 'muted',
  textCls: 'muted',
  cases: [],
  since: Date.UTC(2026, 0, 1),
  schemaVersion: CRM_SCHEMA_VERSION,
}));

export interface GoldenPathBundle {
  adviser: typeof adviserEleanorVance;
  clients: Client[];
  cases: Case[];
  documents: CrmDocument[];
  checklist: DocChecklistItem[];
  worklist: WorklistItem[];
  conflicts: ConflictRecord[];
  stream: Record<string, StreamEntry[]>;
  criteria: CriterionCheck[];
  products: Product[];
  compliance: ComplianceRecord[];
  retention: RetentionEntry[];
}

export const goldenPathBundle: GoldenPathBundle = {
  adviser: adviserEleanorVance,
  clients: [...goldenPathClients, ...pipelineStubClients],
  cases: [case417, case392, ...pipelineStubs],
  documents: goldenPathDocuments,
  checklist: goldenPathChecklist,
  worklist: goldenPathWorklist,
  conflicts: goldenPathConflicts,
  stream: {
    c417: stream417,
    c392: stream392,
  },
  criteria: goldenPathCriteria,
  products: goldenPathProducts,
  compliance: [compliance417],
  retention: goldenPathRetention,
};
