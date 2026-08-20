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
import { CRM_SCHEMA_VERSION, type Case } from '../domain/types';

// 6 pipeline-only stubs — c417 and c392 live in their own fixture files and
// bring their own applicant profiles. Together they yield the SC-001
// stage distribution: 1 LEAD, 2 FACT_FIND, 0 SOURCING, 1 DIP, 1 APPLICATION,
// 1 VALUATION, 1 OFFER, 1 COMPLETION.
export const pipelineStubs: Case[] = [
  {
    id: 'p461',
    ref: 'LM-2026-0461',
    type: 'Buy-to-let',
    kind: 'BTL enquiry',
    label: 'BTL enquiry',
    stage: 'LEAD',
    completeness: 0.05,
    updated: Date.UTC(2026, 5, 12),
    applicants: [
      {
        clientId: 'deborah_quinn',
        role: 'sole',
        profile: {},
        completeness: 0,
      },
    ],
    property: {
      address: 'TBC',
      price: 0 as Pence,
    },
    deposit: { amount: 0 as Pence, percent: 0, sources: [] },
    requirement: {
      loan: 0 as Pence,
      ltv: 0,
      ltvPercent: 0,
      lti: 0,
      termYears: 25,
      repaymentType: 'C&I',
      productType: '2yr',
    },
    affordability: {
      combinedIncome: 0 as Pence,
      monthlyCommitments: 0 as Pence,
    },
    schemaVersion: CRM_SCHEMA_VERSION,
  },
  {
    id: 'p455',
    ref: 'LM-2026-0455',
    type: 'Purchase',
    kind: 'Home mover',
    label: 'Home mover · Sale',
    stage: 'FACT_FIND',
    completeness: 0.38,
    updated: Date.UTC(2026, 5, 9),
    applicants: [
      {
        clientId: 'naomi_clarke',
        role: 'sole',
        profile: {},
        completeness: 0,
      },
    ],
    property: { address: 'TBC · Sale', price: 32_000_000 as Pence },
    deposit: { amount: 0 as Pence, percent: 0, sources: [] },
    requirement: {
      loan: 0 as Pence,
      ltv: 0,
      ltvPercent: 0,
      lti: 0,
      termYears: 30,
      repaymentType: 'C&I',
      productType: '2yr',
    },
    affordability: {
      combinedIncome: 0 as Pence,
      monthlyCommitments: 0 as Pence,
    },
    schemaVersion: CRM_SCHEMA_VERSION,
  },
  {
    id: 'p388',
    ref: 'LM-2026-0388',
    type: 'Remortgage',
    kind: 'BTL Ltd co',
    label: 'Portfolio remo',
    stage: 'APPLICATION',
    completeness: 0.95,
    updated: Date.UTC(2026, 5, 4),
    applicants: [
      {
        clientId: 'jordan_mensah',
        role: 'sole',
        profile: {},
        completeness: 0,
      },
    ],
    property: { address: 'Portfolio', price: 0 as Pence },
    deposit: { amount: 0 as Pence, percent: 0, sources: [] },
    requirement: {
      loan: 0 as Pence,
      ltv: 0,
      ltvPercent: 0,
      lti: 0,
      termYears: 25,
      repaymentType: 'C&I',
      productType: '5yr',
    },
    affordability: {
      combinedIncome: 0 as Pence,
      monthlyCommitments: 0 as Pence,
    },
    schemaVersion: CRM_SCHEMA_VERSION,
  },
  {
    id: 'p355',
    ref: 'LM-2026-0355',
    type: 'Purchase',
    kind: 'Home mover',
    label: 'Home mover · Chorlton',
    stage: 'VALUATION',
    completeness: 0.97,
    updated: Date.UTC(2026, 5, 1),
    applicants: [
      {
        clientId: 'priya_shah',
        role: 'primary',
        profile: {},
        completeness: 0,
      },
      { clientId: 'raj_shah', role: 'secondary', profile: {}, completeness: 0 },
    ],
    property: { address: 'Chorlton', price: 0 as Pence },
    deposit: { amount: 0 as Pence, percent: 0, sources: [] },
    requirement: {
      loan: 0 as Pence,
      ltv: 0,
      ltvPercent: 0,
      lti: 0,
      termYears: 25,
      repaymentType: 'C&I',
      productType: '2yr',
    },
    affordability: {
      combinedIncome: 0 as Pence,
      monthlyCommitments: 0 as Pence,
    },
    schemaVersion: CRM_SCHEMA_VERSION,
  },
  {
    id: 'p301',
    ref: 'LM-2026-0301',
    type: 'Remortgage',
    kind: 'Remortgage',
    label: 'Remortgage',
    stage: 'OFFER',
    completeness: 0.98,
    updated: Date.UTC(2026, 4, 30),
    applicants: [
      {
        clientId: 'marcus_bell',
        role: 'sole',
        profile: {},
        completeness: 0,
      },
    ],
    property: { address: 'Chorlton', price: 0 as Pence },
    deposit: { amount: 0 as Pence, percent: 0, sources: [] },
    requirement: {
      loan: 0 as Pence,
      ltv: 0,
      ltvPercent: 0,
      lti: 0,
      termYears: 20,
      repaymentType: 'C&I',
      productType: '5yr',
    },
    affordability: {
      combinedIncome: 0 as Pence,
      monthlyCommitments: 0 as Pence,
    },
    schemaVersion: CRM_SCHEMA_VERSION,
  },
  {
    id: 'p240',
    ref: 'LM-2026-0240',
    type: 'Purchase',
    kind: 'FTB · shared own.',
    label: 'Shared ownership',
    stage: 'COMPLETION',
    completeness: 1,
    updated: Date.UTC(2026, 4, 18),
    applicants: [
      {
        clientId: 'grace_adeyemi',
        role: 'sole',
        profile: {},
        completeness: 0,
      },
    ],
    property: { address: 'TBC', price: 0 as Pence },
    deposit: { amount: 0 as Pence, percent: 0, sources: [] },
    requirement: {
      loan: 0 as Pence,
      ltv: 0,
      ltvPercent: 0,
      lti: 0,
      termYears: 30,
      repaymentType: 'C&I',
      productType: '2yr',
    },
    affordability: {
      combinedIncome: 0 as Pence,
      monthlyCommitments: 0 as Pence,
    },
    schemaVersion: CRM_SCHEMA_VERSION,
  },
];

// Client stubs referenced by the pipeline-only cases (so casesStore's back-ref
// bookkeeping doesn't dangle).
export const pipelineClientStubs = [
  {
    id: 'deborah_quinn',
    firstName: 'Deborah',
    lastName: 'Quinn',
    initials: 'DQ',
  },
  {
    id: 'naomi_clarke',
    firstName: 'Naomi',
    lastName: 'Clarke',
    initials: 'NC',
  },
  {
    id: 'jordan_mensah',
    firstName: 'Jordan',
    lastName: 'Mensah',
    initials: 'JM',
  },
  { id: 'priya_shah', firstName: 'Priya', lastName: 'Shah', initials: 'PS' },
  { id: 'raj_shah', firstName: 'Raj', lastName: 'Shah', initials: 'RS' },
  { id: 'marcus_bell', firstName: 'Marcus', lastName: 'Bell', initials: 'MB' },
  {
    id: 'grace_adeyemi',
    firstName: 'Grace',
    lastName: 'Adeyemi',
    initials: 'GA',
  },
] as const;
