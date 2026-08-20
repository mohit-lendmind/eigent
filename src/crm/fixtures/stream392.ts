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

import { CRM_SCHEMA_VERSION, type StreamEntry } from '../domain/types';

export const stream392: StreamEntry[] = [
  {
    id: 's-392-doc',
    caseId: 'c392',
    kind: 'external',
    iconTone: 'brand',
    when: Date.UTC(2026, 5, 11, 14, 0),
    timestamp: Date.UTC(2026, 5, 11, 14, 0),
    title: "Tom's 2nd-year accounts outstanding",
    body: 'Reminder sent 2 days ago; auto-chase queued.',
    linkedWorklistId: 'w5',
    trace: {
      claim: 'Year-2 accounts required to evidence director income',
      working: [
        '1. Y1 net profit £71,200 on file',
        '2. Y2 net profit unpopulated',
        '3. Reminder sent 2026-06-09',
      ],
      evidence: [{ kind: 'policy', label: 'Lender minimum 2 yr accounts' }],
      confidence: 0.88,
    },
    schemaVersion: CRM_SCHEMA_VERSION,
  },
  {
    id: 's-392-retn',
    caseId: 'c392',
    kind: 'done',
    iconTone: 'status-warning',
    when: Date.UTC(2026, 5, 11, 12, 0),
    timestamp: Date.UTC(2026, 5, 11, 12, 0),
    title: 'Case auto-opened from retention radar',
    body: "…so you don't miss the product-transfer window.",
    trace: {
      claim: 'Retention window is active — auto-opened case c392',
      working: [
        '1. Fixed rate ends 31 Aug 2026',
        '2. 79 days remaining',
        '3. Product transfer window now open',
      ],
      evidence: [{ kind: 'policy', label: 'Retention automation policy' }],
      confidence: 0.95,
    },
    schemaVersion: CRM_SCHEMA_VERSION,
  },
];
