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

import type { Pence } from '../domain/money';
import { CRM_SCHEMA_VERSION, type ConflictRecord } from '../domain/types';

export const CONFLICT_C417_DANIEL_INCOME_BASIC =
  'conflict_c417_daniel_income_basic';

export const conflict417DanielIncomeBasic: ConflictRecord = {
  id: CONFLICT_C417_DANIEL_INCOME_BASIC,
  caseId: 'c417',
  clientId: 'daniel',
  section: 'income',
  fieldKey: 'basic',
  values: [
    {
      value: { t: 'money', v: 3_850_000 as Pence },
      source: {
        kind: 'document',
        docId: 'd5',
        insightLabel: 'Salary income basic',
        quote: 'Annual salary: £38,500 (MPS3, Outer London weighting)',
      },
      confidence: 0.94,
    },
    {
      value: { t: 'money', v: 3_730_000 as Pence },
      source: {
        kind: 'document',
        docId: 'd7',
        insightLabel: 'Annualised salary income basic',
        quote: 'Gross this period: £3,108.33 · Period: 1 (annualised £37,300)',
      },
      confidence: 0.92,
    },
  ],
  detectedAt: Date.UTC(2026, 5, 3, 10, 8),
  detectedBy: 'system',
  schemaVersion: CRM_SCHEMA_VERSION,
};

export const goldenPathConflicts: ConflictRecord[] = [
  conflict417DanielIncomeBasic,
];
