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
import {
  CRM_SCHEMA_VERSION,
  type Applicant,
  type ApplicantProfile,
  type Case,
  type FactFindField,
  type FactFindSection,
} from '../domain/types';

const det = (
  k: string,
  label: string,
  value: FactFindField['value'],
  hint?: string,
  extras: Partial<FactFindField> = {}
): FactFindField => ({
  k,
  label,
  value,
  src: 'det',
  hint,
  ...extras,
});

const syn = (
  k: string,
  label: string,
  value: FactFindField['value'],
  hint?: string,
  extras: Partial<FactFindField> = {}
): FactFindField => ({
  k,
  label,
  value,
  src: 'syn',
  hint,
  ...extras,
});

function section(fields: FactFindField[]): FactFindSection {
  return { fields, completeness: 0 };
}

const tomProfile: ApplicantProfile = {
  personal: section([
    det('title', 'Title', { t: 'select', v: 'Mr' }),
    det('firstName', 'First name', { t: 'text', v: 'Tom' }),
    det('lastName', 'Last name', { t: 'text', v: 'Hargreaves' }),
    det('dob', 'Date of birth', { t: 'date', v: '1985-11-30' }),
    det('maritalStatus', 'Marital status', {
      t: 'select',
      v: 'Married',
    }),
    det('ni', 'National insurance', { t: 'text', v: 'AB••••••D' }, undefined, {
      mono: true,
    }),
    det('citizenship', 'Citizenship', { t: 'text', v: 'British' }),
    det('permanentUkResidency', 'Permanent UK residency', {
      t: 'toggle',
      v: true,
    }),
    det('dependants', 'Dependants', { t: 'number', v: 2 }),
  ]),
  contact: section([
    det('email', 'Email', { t: 'text', v: 'tom@harg.studio' }),
    det('mobile', 'Mobile', { t: 'text', v: '07533 905 220' }),
  ]),
  address: section([
    det('line1', 'Address', {
      t: 'text',
      v: '22 Royal York Crescent',
    }),
    det('city', 'City', { t: 'text', v: 'Bristol' }),
    det('postcode', 'Postcode', { t: 'text', v: 'BS8 4JX' }, undefined, {
      mono: true,
    }),
    det('timeAtAddress', 'Time at address', { t: 'text', v: '4 yr 8 mo' }),
    det('residentialStatus', 'Residential status', {
      t: 'select',
      v: 'Owner-occupier',
    }),
  ]),
  employment: section([
    det('type', 'Type', {
      t: 'select',
      v: 'Self-employed (Ltd director)',
    }),
    det('business', 'Business', {
      t: 'text',
      v: 'Hargreaves Studio Ltd',
    }),
    det('yearsTrading', 'Years trading', { t: 'number', v: 7 }),
    det('shareholding', 'Shareholding', {
      t: 'text',
      v: '100%',
    }),
  ]),
  income: section([
    det('directorSalary', 'Director salary', {
      t: 'money',
      v: 1_257_000 as Pence,
    }),
    syn(
      'dividendsAvg',
      'Dividends (2yr avg)',
      {
        t: 'money',
        v: 5_840_000 as Pence,
      },
      undefined,
      { flag: true }
    ),
    det('netProfitY1', 'Net profit Y1', {
      t: 'money',
      v: 7_120_000 as Pence,
    }),
    syn(
      'netProfitY2',
      'Net profit Y2',
      {
        t: 'number',
        v: NaN,
      },
      undefined,
      { flag: true }
    ),
  ]),
  expenditure: section([
    syn('councilTax', 'Council tax', { t: 'money', v: 12_500 as Pence }),
    syn('utilities', 'Utilities', { t: 'money', v: 14_000 as Pence }),
    syn('travel', 'Travel', { t: 'money', v: 22_000 as Pence }),
    syn('livingCosts', 'Living costs', { t: 'money', v: 65_000 as Pence }),
  ]),
  credit: section([
    det(
      'adverseCredit',
      'Adverse credit',
      {
        t: 'toggle',
        v: true,
      },
      undefined,
      { flag: true }
    ),
    det('adverseCreditDetail', 'Detail', {
      t: 'text',
      v: '1 missed payment · Nov 2024',
    }),
  ]),
};

const applicants: Applicant[] = [
  {
    clientId: 'tom',
    role: 'sole',
    profile: tomProfile,
    completeness: 0,
  },
];

export const case392: Case = {
  id: 'c392',
  ref: 'LM-2026-0392',
  type: 'Remortgage',
  kind: 'Self-employed · Ltd director',
  label: 'Remortgage · Clifton',
  stage: 'FACT_FIND',
  completeness: 0.64,
  updated: Date.UTC(2026, 5, 11, 15, 0),
  applicants,
  property: {
    address: '22 Royal York Crescent',
    city: 'Bristol',
    postcode: 'BS8 4JX',
    price: 52_000_000 as Pence,
    propertyType: '3-bed maisonette',
    tenure: 'leasehold',
  },
  deposit: {
    amount: 20_800_000 as Pence,
    percent: 0.4,
    sources: [{ label: 'Equity in property', amount: 20_800_000 as Pence }],
  },
  requirement: {
    loan: 33_500_000 as Pence,
    ltv: 0.64,
    ltvPercent: 64,
    lti: 4.72,
    termYears: 18,
    repaymentType: 'C&I',
    productType: '5yr',
  },
  affordability: {
    combinedIncome: 7_097_000 as Pence,
    monthlyCommitments: 0 as Pence,
  },
  retention: {
    reason: 'Fixed rate ends 31 Aug 2026',
    daysLeft: 79,
    endsAt: Date.UTC(2026, 7, 31),
  },
  ownership: {
    adviserId: 'adviser_eleanor_vance',
    firmId: 'firm_meridian_mortgages',
    networkId: 'network_stonebridge',
  },
  schemaVersion: CRM_SCHEMA_VERSION,
};
