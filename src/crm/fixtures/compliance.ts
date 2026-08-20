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

import { CRM_SCHEMA_VERSION, type ComplianceRecord } from '../domain/types';

const on = (day: number) => Date.UTC(2026, 5, day);

export const compliance417: ComplianceRecord = {
  caseId: 'c417',
  disclosures: [
    {
      key: 'idd',
      label: 'Initial Disclosure Document (IDD)',
      status: 'pass',
      detail: 'Issued at first contact · 1 Jun',
      updatedAt: on(1),
    },
    {
      key: 'fee_agreement',
      label: 'Fee agreement (£499 on offer)',
      status: 'pass',
      detail: 'e-signed by both applicants · 1 Jun',
      updatedAt: on(1),
    },
    {
      key: 'privacy_notice',
      label: 'Privacy notice & GDPR consent',
      status: 'pass',
      detail: 'Acknowledged · 1 Jun',
      updatedAt: on(1),
    },
  ],
  idAndV: [
    {
      key: 'aisha_idv',
      label: 'Aisha — Electronic ID&V',
      status: 'pass',
      detail: 'Passport + facial match · IDV-90412 · 3 Jun',
      updatedAt: on(3),
    },
    {
      key: 'daniel_idv',
      label: 'Daniel — Electronic ID&V',
      status: 'pass',
      detail: 'Driving licence · IDV-90418 · 3 Jun',
      updatedAt: on(3),
    },
  ],
  aml: [
    {
      key: 'smartsearch',
      label: 'SmartSearch AML',
      status: 'pass',
      detail: 'Sanctions clear · PEP clear · adverse clear · 3 Jun',
      updatedAt: on(3),
    },
  ],
  vulnerability: [
    {
      key: 'baseline',
      label: 'Vulnerability review',
      status: 'na',
      detail:
        'No characteristics of vulnerability identified at fact find. Re-assessed each interaction under Consumer Duty.',
      updatedAt: on(3),
    },
  ],
  consumerDuty: [
    {
      key: 'products',
      label: 'Products & services',
      status: 'pass',
      detail: 'Recommendation matches recorded needs & objectives',
      updatedAt: on(3),
    },
    {
      key: 'price_value',
      label: 'Price & value',
      status: 'pass',
      detail: 'Lowest eligible true cost selected; fees fair-value assessed',
      updatedAt: on(3),
    },
    {
      key: 'understanding',
      label: 'Consumer understanding',
      status: 'pass',
      detail: 'Plain-language suitability report issued & acknowledged',
      updatedAt: on(3),
    },
    {
      key: 'support',
      label: 'Consumer support',
      status: 'pass',
      detail: 'Portal + adviser access throughout the journey',
      updatedAt: on(3),
    },
  ],
  declaration: {
    key: 'declaration',
    label: 'Fact-find accuracy declaration',
    status: 'pass',
    detail: 'e-signed in the client portal · 3 Jun',
    updatedAt: on(3),
  },
  supervision: [
    {
      key: 'ff_complete',
      label: 'Fact find complete & internally consistent',
      status: 'pass',
    },
    {
      key: 'affordability',
      label: 'Affordability evidenced & stress-tested',
      status: 'pass',
    },
    {
      key: 'suitability',
      label: 'Suitability rationale documented',
      status: 'pass',
    },
    {
      key: 'idv_aml',
      label: 'ID&V and AML checks clear',
      status: 'pass',
    },
    {
      key: 'gift_letter',
      label: 'Gifted deposit letter on file',
      status: 'pending',
    },
  ],
  schemaVersion: CRM_SCHEMA_VERSION,
};
