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

import { CRM_SCHEMA_VERSION, type CriterionCheck } from '../domain/types';

export const goldenPathCriteria: CriterionCheck[] = [
  {
    id: 'crit-1',
    caseId: 'c417',
    group: 'lending',
    cat: 'Property',
    label: 'Standard construction (brick & tile)',
    status: 'pass',
    reasoning:
      'Subject property assessed as standard construction. Accepted by all 38 lenders in scope.',
    schemaVersion: CRM_SCHEMA_VERSION,
  },
  {
    id: 'crit-2',
    caseId: 'c417',
    group: 'lending',
    cat: 'LTV',
    label: 'Loan-to-value 85% within limits',
    status: 'pass',
    reasoning:
      '£242,250 against £285,000 = 85.0% LTV — within the 90% maximum for 36 of 38 lenders.',
    schemaVersion: CRM_SCHEMA_VERSION,
  },
  {
    id: 'crit-3',
    caseId: 'c417',
    group: 'lending',
    cat: 'Policy',
    label: 'First-time buyer eligible',
    status: 'pass',
    reasoning: 'Neither applicant has owned property before.',
    schemaVersion: CRM_SCHEMA_VERSION,
  },
  {
    id: 'crit-4',
    caseId: 'c417',
    group: 'lending',
    cat: 'Employment',
    label: 'Applicant 2 within probation',
    status: 'warning',
    reasoning:
      'Daniel started 6 Jan 2026 (5 months, in probation). Some lenders require 6–12 months continuous service.',
    impacts: [
      { lender: 'Skipton BS', status: 'fail', note: 'needs 6 mo' },
      { lender: 'Halifax', status: 'pass', note: 'from 1st payslip' },
      { lender: 'Nationwide', status: 'pass', note: 'teachers ok' },
      { lender: 'Coventry BS', status: 'fail', note: 'probation excl.' },
    ],
    schemaVersion: CRM_SCHEMA_VERSION,
  },
  {
    id: 'crit-5',
    caseId: 'c417',
    group: 'lending',
    cat: 'Policy',
    label: 'Gifted deposit acceptable',
    status: 'warning',
    reasoning:
      '£2,000 gift from a parent is acceptable with a signed gifted-deposit letter. Letter requested — required before submission.',
    impacts: [{ lender: 'All', status: 'pass', note: 'letter on file' }],
    schemaVersion: CRM_SCHEMA_VERSION,
  },
  {
    id: 'crit-6',
    caseId: 'c417',
    group: 'lending',
    cat: 'Credit',
    label: 'Adverse credit — none',
    status: 'pass',
    reasoning:
      'No CCJs, defaults or missed payments. Both on the electoral roll.',
    schemaVersion: CRM_SCHEMA_VERSION,
  },
  {
    id: 'crit-7',
    caseId: 'c417',
    group: 'affordability',
    cat: 'Income',
    label: 'Combined income £82,100',
    status: 'info',
    reasoning:
      'Aisha £43,600 (basic + 50% overtime) + Daniel £38,500 = £82,100 considered income.',
    schemaVersion: CRM_SCHEMA_VERSION,
  },
  {
    id: 'crit-8',
    caseId: 'c417',
    group: 'affordability',
    cat: 'Affordability',
    label: 'Loan-to-income 2.95× — comfortable',
    status: 'pass',
    reasoning:
      '£242,250 ÷ £82,100 = 2.95×, well within standard 4.49× caps. Maximum standard borrowing ~£369,450.',
    schemaVersion: CRM_SCHEMA_VERSION,
  },
  {
    id: 'crit-9',
    caseId: 'c417',
    group: 'affordability',
    cat: 'Affordability',
    label: 'Stress test at reversion',
    status: 'pass',
    reasoning:
      'Stressed payment £1,690 (8.49%) leaves a £1,180 monthly surplus after committed expenditure.',
    schemaVersion: CRM_SCHEMA_VERSION,
  },
  {
    id: 'crit-10',
    caseId: 'c417',
    group: 'affordability',
    cat: 'Affordability',
    label: 'Net disposable surplus healthy',
    status: 'pass',
    reasoning:
      'Modelled monthly surplus £1,180 after mortgage, credit and essential expenditure.',
    schemaVersion: CRM_SCHEMA_VERSION,
  },
];
