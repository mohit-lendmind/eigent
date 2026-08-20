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

import { CRM_SCHEMA_VERSION, type Client } from '../domain/types';

// All colour references are semantic tone keys — the design-token gate scans
// fixtures too. UI mapping lives in F02.
export const aishaOkafor: Client = {
  id: 'aisha',
  ref: 'LM-C-2041',
  firstName: 'Aisha',
  lastName: 'Okafor',
  initials: 'AO',
  tint: 'brand',
  textCls: 'brand',
  role: 'Registered Nurse',
  email: 'aisha.okafor@gmail.com',
  phone: '07712 660 145',
  cases: ['c417'],
  since: Date.UTC(2026, 2, 1),
  schemaVersion: CRM_SCHEMA_VERSION,
};

export const danielReyes: Client = {
  id: 'daniel',
  ref: 'LM-C-2042',
  firstName: 'Daniel',
  lastName: 'Reyes',
  initials: 'DR',
  tint: 'status-success',
  textCls: 'status-success',
  role: 'Secondary School Teacher',
  email: 'd.reyes@outlook.com',
  phone: '07820 114 663',
  cases: ['c417'],
  since: Date.UTC(2026, 2, 1),
  schemaVersion: CRM_SCHEMA_VERSION,
};

export const tomHargreaves: Client = {
  id: 'tom',
  ref: 'LM-C-1187',
  firstName: 'Tom',
  lastName: 'Hargreaves',
  initials: 'TH',
  tint: 'status-warning',
  textCls: 'status-warning',
  role: 'Company Director (Design Studio)',
  email: 'tom@harg.studio',
  phone: '07533 905 220',
  cases: ['c392'],
  since: Date.UTC(2021, 8, 1),
  schemaVersion: CRM_SCHEMA_VERSION,
};

export const adviserEleanorVance = {
  id: 'adviser_eleanor_vance',
  name: 'Eleanor Vance',
  initials: 'EV',
  role: 'Mortgage & Protection Adviser',
  firmId: 'firm_meridian_mortgages',
  firmName: 'Meridian Mortgages',
  networkId: 'network_stonebridge',
  networkName: 'Stonebridge · Appointed Representative',
  fcaRef: 'FRN 924817',
  email: 'eleanor.vance@meridianmortgages.co.uk',
} as const;

export const goldenPathClients: Client[] = [
  aishaOkafor,
  danielReyes,
  tomHargreaves,
];
