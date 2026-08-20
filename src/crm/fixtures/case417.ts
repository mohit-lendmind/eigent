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
import { CONFLICT_C417_DANIEL_INCOME_BASIC } from './conflicts';

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

const aishaProfile: ApplicantProfile = {
  personal: section([
    det('title', 'Title', { t: 'select', v: 'Ms' }),
    det('firstName', 'First name', { t: 'text', v: 'Aisha' }),
    det('lastName', 'Last name', { t: 'text', v: 'Okafor' }),
    det('dob', 'Date of birth', { t: 'date', v: '1994-02-11' }, 'Passport'),
    syn('maritalStatus', 'Marital status', {
      t: 'select',
      v: 'Cohabiting',
    }),
    det('ni', 'National insurance', { t: 'text', v: 'NX••••••C' }, 'P60', {
      mono: true,
    }),
    det('citizenship', 'Citizenship', { t: 'text', v: 'British' }, 'Passport'),
    det('permanentUkResidency', 'Permanent UK residency', {
      t: 'toggle',
      v: true,
    }),
    syn('dependants', 'Dependants', { t: 'number', v: 0 }),
  ]),
  contact: section([
    det('email', 'Email', { t: 'text', v: 'aisha.okafor@gmail.com' }),
    det('mobile', 'Mobile', { t: 'text', v: '07712 660 145' }),
  ]),
  address: section([
    det(
      'line1',
      'Address',
      { t: 'text', v: '14 Ladybarn Road' },
      'Bank statement'
    ),
    det('city', 'City', { t: 'text', v: 'Manchester' }),
    det('postcode', 'Postcode', { t: 'text', v: 'M14 6NR' }, undefined, {
      mono: true,
    }),
    syn('timeAtAddress', 'Time at address', { t: 'text', v: '2 yr 4 mo' }),
    syn('residentialStatus', 'Residential status', {
      t: 'select',
      v: 'Private tenant',
    }),
  ]),
  employment: section([
    det('type', 'Type', { t: 'select', v: 'Employed' }),
    det(
      'employer',
      'Employer',
      { t: 'text', v: 'Manchester Univ. NHS Trust' },
      'Payslip · Contract'
    ),
    det('jobTitle', 'Job title', {
      t: 'text',
      v: 'Registered Nurse (Band 6)',
    }),
    det('startDate', 'Start date', { t: 'date', v: '2019-09-02' }),
    syn('yearsInRole', 'Years in role', { t: 'number', v: 5.7 }),
    det('inProbation', 'In probation', { t: 'toggle', v: false }),
  ]),
  income: section([
    det(
      'basic',
      'Basic',
      { t: 'money', v: 4_200_000 as Pence },
      'P60 · 3× payslips'
    ),
    syn('overtimeAvg', 'Overtime avg', { t: 'money', v: 320_000 as Pence }),
    det('bonus', 'Bonus', { t: 'money', v: 0 as Pence }),
    syn(
      'incomeConsidered',
      'Income considered',
      { t: 'money', v: 4_360_000 as Pence },
      'Basic + 50% OT'
    ),
  ]),
  expenditure: section([
    syn('councilTax', 'Council tax', { t: 'money', v: 6_600 as Pence }),
    syn('utilities', 'Utilities', { t: 'money', v: 9_000 as Pence }),
    syn('travel', 'Travel', { t: 'money', v: 11_000 as Pence }),
    syn('livingCosts', 'Living costs', { t: 'money', v: 36_000 as Pence }),
  ]),
  credit: section([
    det(
      'adverseCredit',
      'Adverse credit',
      { t: 'toggle', v: false },
      'Credit report'
    ),
    det(
      'monthlyCommitments',
      'Monthly commitments',
      { t: 'money', v: 18_900 as Pence },
      'Car finance'
    ),
    det('creditScore', 'Credit score', {
      t: 'text',
      v: '481 / Excellent',
    }),
  ]),
};

const danielProfile: ApplicantProfile = {
  personal: section([
    det('title', 'Title', { t: 'select', v: 'Mr' }),
    det('firstName', 'First name', { t: 'text', v: 'Daniel' }),
    det('lastName', 'Last name', { t: 'text', v: 'Reyes' }),
    det(
      'dob',
      'Date of birth',
      { t: 'date', v: '1992-07-23' },
      'Driving licence'
    ),
    syn('maritalStatus', 'Marital status', {
      t: 'select',
      v: 'Cohabiting',
    }),
    det('ni', 'National insurance', { t: 'text', v: 'JT••••••B' }, 'Payslip', {
      mono: true,
    }),
    det('citizenship', 'Citizenship', { t: 'text', v: 'British' }),
    det('permanentUkResidency', 'Permanent UK residency', {
      t: 'toggle',
      v: true,
    }),
    syn('dependants', 'Dependants', { t: 'number', v: 0 }),
  ]),
  contact: section([
    det('email', 'Email', { t: 'text', v: 'd.reyes@outlook.com' }),
    det('mobile', 'Mobile', { t: 'text', v: '07820 114 663' }),
  ]),
  address: section([
    syn(
      'line1',
      'Address',
      { t: 'text', v: '14 Ladybarn Road' },
      'Same as applicant 1'
    ),
    syn('city', 'City', { t: 'text', v: 'Manchester' }),
    syn('postcode', 'Postcode', { t: 'text', v: 'M14 6NR' }, undefined, {
      mono: true,
    }),
    syn('timeAtAddress', 'Time at address', { t: 'text', v: '1 yr 8 mo' }),
    syn('residentialStatus', 'Residential status', {
      t: 'select',
      v: 'Private tenant',
    }),
  ]),
  employment: section([
    det('type', 'Type', { t: 'select', v: 'Employed' }),
    det(
      'employer',
      'Employer',
      { t: 'text', v: 'Trafford High School' },
      'Contract'
    ),
    det('jobTitle', 'Job title', {
      t: 'text',
      v: 'Teacher of Science',
    }),
    det('startDate', 'Start date', { t: 'date', v: '2026-01-06' }, 'Contract', {
      flag: true,
    }),
    syn('yearsInRole', 'Years in role', { t: 'number', v: 0.4 }, undefined, {
      flag: true,
    }),
    det('inProbation', 'In probation', { t: 'toggle', v: true }, undefined, {
      flag: true,
    }),
  ]),
  income: section([
    det(
      'basic',
      'Basic',
      { t: 'money', v: 3_850_000 as Pence },
      'Contract · payslip',
      { conflictId: CONFLICT_C417_DANIEL_INCOME_BASIC }
    ),
    syn('overtimeAvg', 'Overtime avg', { t: 'money', v: 0 as Pence }),
    det('bonus', 'Bonus', { t: 'money', v: 0 as Pence }),
    syn('incomeConsidered', 'Income considered', {
      t: 'money',
      v: 3_850_000 as Pence,
    }),
  ]),
  expenditure: section([
    syn('councilTax', 'Council tax', { t: 'money', v: 6_600 as Pence }),
    syn('utilities', 'Utilities', { t: 'money', v: 9_000 as Pence }),
    syn('travel', 'Travel', { t: 'money', v: 11_000 as Pence }),
    syn('livingCosts', 'Living costs', { t: 'money', v: 36_000 as Pence }),
  ]),
  credit: section([
    det(
      'adverseCredit',
      'Adverse credit',
      { t: 'toggle', v: false },
      'Credit report'
    ),
    det('monthlyCommitments', 'Monthly commitments', {
      t: 'money',
      v: 0 as Pence,
    }),
    det('creditScore', 'Credit score', {
      t: 'text',
      v: '468 / Excellent',
    }),
  ]),
};

const applicants: Applicant[] = [
  {
    clientId: 'aisha',
    role: 'primary',
    profile: aishaProfile,
    completeness: 0,
  },
  {
    clientId: 'daniel',
    role: 'secondary',
    profile: danielProfile,
    completeness: 0,
  },
];

export const case417: Case = {
  id: 'c417',
  ref: 'LM-2026-0417',
  type: 'Purchase',
  kind: 'First-time buyer',
  label: 'First home · Didsbury',
  stage: 'DIP',
  completeness: 0.9,
  updated: Date.UTC(2026, 5, 3, 10, 12),
  applicants,
  property: {
    address: '8 Brookfield Avenue',
    city: 'Manchester',
    postcode: 'M20 3PL',
    price: 28_500_000 as Pence,
    propertyType: '2-bed terraced house',
    tenure: 'freehold',
  },
  deposit: {
    amount: 4_275_000 as Pence,
    percent: 0.15,
    sources: [
      {
        label: 'Own savings (joint)',
        amount: 4_075_000 as Pence,
      },
      {
        label: "Gift — Aisha's mother",
        amount: 200_000 as Pence,
        flag: true,
      },
    ],
  },
  requirement: {
    loan: 24_225_000 as Pence,
    ltv: 0.85,
    ltvPercent: 85,
    lti: 2.95,
    termYears: 32,
    repaymentType: 'C&I',
    productType: '2yr',
  },
  affordability: {
    combinedIncome: 8_210_000 as Pence,
    monthlyCommitments: 18_900 as Pence,
    disposableIncome: 118_000 as Pence,
    stressRate: 8.49,
  },
  ownership: {
    adviserId: 'adviser_eleanor_vance',
    firmId: 'firm_meridian_mortgages',
    networkId: 'network_stonebridge',
  },
  schemaVersion: CRM_SCHEMA_VERSION,
};
