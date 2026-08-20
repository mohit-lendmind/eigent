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

import { CRM_SCHEMA_VERSION, type RetentionEntry } from '../domain/types';

// daysLeft values match the design reference's stated numbers against the
// canonical seed clock (2026-06-13, the "as of" date the design docs describe).
export const goldenPathRetention: RetentionEntry[] = [
  {
    clientId: 'tom',
    ref: 'LM-C-1187',
    endsAt: Date.UTC(2026, 7, 31),
    daysLeft: 79,
    lender: 'Coventry BS',
    rate: 1.84,
    status: 'case-open',
    schemaVersion: CRM_SCHEMA_VERSION,
  },
  {
    clientId: 'marcus_bell',
    ref: 'LM-C-1402',
    endsAt: Date.UTC(2026, 8, 14),
    daysLeft: 93,
    lender: 'Santander',
    rate: 2.19,
    status: 'due',
    schemaVersion: CRM_SCHEMA_VERSION,
  },
  {
    clientId: 'sofia_russo',
    ref: 'LM-C-0998',
    endsAt: Date.UTC(2026, 10, 2),
    daysLeft: 142,
    lender: 'Halifax',
    rate: 1.99,
    status: 'horizon',
    schemaVersion: CRM_SCHEMA_VERSION,
  },
  {
    clientId: 'henry_watanabe',
    ref: 'LM-C-1655',
    endsAt: Date.UTC(2026, 10, 20),
    daysLeft: 160,
    lender: 'NatWest',
    rate: 4.41,
    status: 'horizon',
    schemaVersion: CRM_SCHEMA_VERSION,
  },
];
