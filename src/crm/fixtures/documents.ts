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

import { CRM_SCHEMA_VERSION, type CrmDocument } from '../domain/types';

const t = (year: number, month: number, day: number, hour: number, min = 0) =>
  Date.UTC(year, month, day, hour, min);

export const goldenPathDocuments: CrmDocument[] = [
  {
    id: 'd1',
    owner: 'aisha',
    name: 'Passport_AOkafor.jpg',
    type: 'Identity',
    status: 'COMPLETED',
    size: 1_800_000,
    when: t(2026, 5, 3, 9, 14),
    iconTone: 'brand',
    attribution: 0.99,
    insights: [
      {
        id: 'i-d1-1',
        label: 'Full name',
        value: 'Aisha N. Okafor',
        conf: 0.99,
      },
      { id: 'i-d1-2', label: 'DOB', value: '11 Feb 1994', conf: 0.99 },
      {
        id: 'i-d1-3',
        label: 'Nationality',
        value: 'British',
        conf: 0.98,
      },
    ],
    schemaVersion: CRM_SCHEMA_VERSION,
  },
  {
    id: 'd2',
    owner: 'aisha',
    name: 'Payslip_March.pdf',
    type: 'Payslip',
    status: 'COMPLETED',
    size: 212_000,
    when: t(2026, 5, 3, 9, 15),
    iconTone: 'status-success',
    attribution: 0.97,
    insights: [
      {
        id: 'i-d2-1',
        label: 'Annual income',
        value: '£42,000',
        conf: 0.96,
      },
      {
        id: 'i-d2-2',
        label: 'Employer',
        value: 'Manchester Univ. NHS Trust',
        conf: 0.95,
      },
      { id: 'i-d2-3', label: 'NI', value: 'NX••••••C', conf: 0.92 },
    ],
    schemaVersion: CRM_SCHEMA_VERSION,
  },
  {
    id: 'd3',
    owner: 'aisha',
    name: 'P60_2024-25.pdf',
    type: 'P60',
    status: 'COMPLETED',
    size: 188_000,
    when: t(2026, 5, 3, 9, 16),
    iconTone: 'status-success',
    attribution: 0.98,
    insights: [
      {
        id: 'i-d3-1',
        label: 'Total pay in year',
        value: '£44,920',
        conf: 0.97,
      },
      {
        id: 'i-d3-2',
        label: 'Tax year',
        value: '2024–25',
        conf: 0.99,
      },
    ],
    schemaVersion: CRM_SCHEMA_VERSION,
  },
  {
    id: 'd4',
    owner: 'daniel',
    name: 'Statement_Joint_Mar-May.pdf',
    type: 'Bank statement',
    status: 'COMPLETED',
    size: 640_000,
    when: t(2026, 5, 3, 9, 17),
    iconTone: 'brand',
    attribution: 0.74,
    joint: true,
    insights: [
      {
        id: 'i-d4-1',
        label: 'Account holders',
        value: 'A Okafor & D Reyes',
        conf: 0.93,
      },
      {
        id: 'i-d4-2',
        label: 'Deposit evidenced',
        value: '£40,750 saved',
        conf: 0.9,
        good: true,
      },
      {
        id: 'i-d4-3',
        label: 'Gift credit',
        value: '£2,000 · 14 Aug',
        conf: 0.86,
      },
    ],
    schemaVersion: CRM_SCHEMA_VERSION,
  },
  {
    id: 'd5',
    owner: 'daniel',
    name: 'Contract_TraffordHS.pdf',
    type: 'Employment contract',
    status: 'COMPLETED',
    size: 301_000,
    when: t(2026, 5, 3, 9, 18),
    iconTone: 'status-warning',
    attribution: 0.95,
    insights: [
      {
        id: 'i-d5-1',
        label: 'Employer',
        value: 'Trafford High School',
        conf: 0.96,
      },
      {
        id: 'i-d5-2',
        label: 'Start date',
        value: '06 Jan 2026',
        conf: 0.95,
        flag: true,
      },
      {
        id: 'i-d5-3',
        label: 'Salary income basic',
        value: '£38,500',
        conf: 0.94,
        conflict: true,
      },
    ],
    schemaVersion: CRM_SCHEMA_VERSION,
  },
  {
    id: 'd6',
    owner: 'daniel',
    name: 'IMG_2098.HEIC',
    type: 'unclassified',
    status: 'PROCESSING',
    size: 2_100_000,
    when: t(2026, 5, 3, 10, 0),
    iconTone: 'muted',
    attribution: null,
    insights: [],
    schemaVersion: CRM_SCHEMA_VERSION,
  },
  {
    id: 'd7',
    owner: 'daniel',
    name: 'Payslip_TraffordHS_Jan.pdf',
    type: 'Payslip',
    status: 'COMPLETED',
    size: 198_000,
    when: t(2026, 5, 3, 9, 17),
    iconTone: 'status-warning',
    attribution: 0.92,
    insights: [
      {
        id: 'i-d7-1',
        label: 'Gross this period',
        value: '£3,108.33',
        conf: 0.94,
      },
      {
        id: 'i-d7-2',
        label: 'Annualised salary income basic',
        value: '£37,300',
        conf: 0.92,
        conflict: true,
      },
      {
        id: 'i-d7-3',
        label: 'Employer',
        value: 'Trafford High School',
        conf: 0.95,
      },
    ],
    schemaVersion: CRM_SCHEMA_VERSION,
  },
];
