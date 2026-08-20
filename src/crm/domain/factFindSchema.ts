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

export type FactFindSectionKey =
  | 'personal'
  | 'contact'
  | 'address'
  | 'employment'
  | 'income'
  | 'expenditure'
  | 'credit';

export const EMPLOYED_FIELD_KEYS = {
  personal: [
    'title',
    'firstName',
    'lastName',
    'dob',
    'maritalStatus',
    'ni',
    'citizenship',
    'permanentUkResidency',
    'dependants',
  ],
  contact: ['email', 'mobile'],
  address: ['line1', 'city', 'postcode', 'timeAtAddress', 'residentialStatus'],
  employment: [
    'type',
    'employer',
    'jobTitle',
    'startDate',
    'yearsInRole',
    'inProbation',
  ],
  income: ['basic', 'overtimeAvg', 'bonus', 'incomeConsidered'],
  expenditure: ['councilTax', 'utilities', 'travel', 'livingCosts'],
  credit: ['adverseCredit', 'monthlyCommitments', 'creditScore'],
} as const;

export const SELF_EMPLOYED_FIELD_KEYS = {
  personal: [
    'title',
    'firstName',
    'lastName',
    'dob',
    'maritalStatus',
    'ni',
    'citizenship',
    'permanentUkResidency',
    'dependants',
  ],
  contact: ['email', 'mobile'],
  address: ['line1', 'city', 'postcode', 'timeAtAddress', 'residentialStatus'],
  employment: ['type', 'business', 'yearsTrading', 'shareholding'],
  income: ['directorSalary', 'dividendsAvg', 'netProfitY1', 'netProfitY2'],
  expenditure: ['councilTax', 'utilities', 'travel', 'livingCosts'],
  credit: ['adverseCredit', 'adverseCreditDetail'],
} as const;

export type EmployedFieldKeys = typeof EMPLOYED_FIELD_KEYS;
export type SelfEmployedFieldKeys = typeof SELF_EMPLOYED_FIELD_KEYS;

export type EmployedFieldKey<S extends FactFindSectionKey> =
  S extends keyof EmployedFieldKeys ? EmployedFieldKeys[S][number] : never;

export type SelfEmployedFieldKey<S extends FactFindSectionKey> =
  S extends keyof SelfEmployedFieldKeys
    ? SelfEmployedFieldKeys[S][number]
    : never;

export type AnyFactFindFieldKey =
  | EmployedFieldKey<FactFindSectionKey>
  | SelfEmployedFieldKey<FactFindSectionKey>;

export function requiredKeysForSection(
  category: 'employed' | 'self-employed',
  section: FactFindSectionKey
): readonly string[] {
  const src =
    category === 'employed' ? EMPLOYED_FIELD_KEYS : SELF_EMPLOYED_FIELD_KEYS;
  return (src as Record<string, readonly string[]>)[section] ?? [];
}
