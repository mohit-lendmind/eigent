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

import { CRM_SCHEMA_VERSION, type WorklistItem } from '../domain/types';
import { CONFLICT_C417_DANIEL_INCOME_BASIC } from './conflicts';

const now = Date.UTC(2026, 5, 3, 8, 0);

export const goldenPathWorklist: WorklistItem[] = [
  {
    id: 'w1',
    caseId: 'c417',
    kind: 'conflict',
    title: "Confirm Daniel's salary",
    detail:
      'Contract states £38,500; first payslip annualises to £37,300. £1,200 variance to resolve.',
    cta: 'Resolve',
    tab: 'documents',
    status: 'open',
    createdAt: now,
    linkedConflictId: CONFLICT_C417_DANIEL_INCOME_BASIC,
    schemaVersion: CRM_SCHEMA_VERSION,
  },
  {
    id: 'w2',
    caseId: 'c417',
    kind: 'criteria',
    title: 'Daniel is within probation',
    detail:
      'Started 6 Jan 2026 (5 months). 4 of 38 lenders decline; teachers accepted by most from day one.',
    cta: 'Review sourcing',
    tab: 'sourcing',
    status: 'open',
    createdAt: now,
    schemaVersion: CRM_SCHEMA_VERSION,
  },
  {
    id: 'w3',
    caseId: 'c417',
    kind: 'doc',
    title: 'Gifted deposit letter needed',
    detail:
      "£2,000 gift from Aisha's mother requires a signed gifted-deposit letter before submission.",
    cta: 'Request',
    tab: 'comms',
    auto: true,
    status: 'open',
    createdAt: now,
    schemaVersion: CRM_SCHEMA_VERSION,
  },
  {
    id: 'w4',
    caseId: 'c417',
    kind: 'approval',
    title: 'Fact find ready to approve',
    detail:
      'AI built 31 fields across both applicants from 5 documents. 2 inferred fields await your confirmation.',
    cta: 'Review',
    tab: 'factfind',
    status: 'open',
    createdAt: now,
    schemaVersion: CRM_SCHEMA_VERSION,
  },
  {
    id: 'w5',
    caseId: 'c392',
    kind: 'doc',
    title: "Tom's 2nd-year accounts outstanding",
    detail:
      'Year-2 net profit missing — needed to evidence self-employed income. Reminder sent 2 days ago.',
    cta: 'Chase',
    tab: 'documents',
    auto: true,
    status: 'open',
    createdAt: now,
    schemaVersion: CRM_SCHEMA_VERSION,
  },
  {
    id: 'w6',
    caseId: 'c392',
    kind: 'retention',
    title: "Tom's fixed rate ends in 79 days",
    detail:
      'Remortgage case auto-opened. Product transfer window now open — source to retain the client.',
    cta: 'Open case',
    tab: 'overview',
    status: 'open',
    createdAt: now,
    schemaVersion: CRM_SCHEMA_VERSION,
  },
];
