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

import { CRM_SCHEMA_VERSION, type StreamEntry } from '../domain/types';

const t = (year: number, month: number, day: number, hour: number, min = 0) =>
  Date.UTC(year, month, day, hour, min);

export const stream417: StreamEntry[] = [
  {
    id: 's-live',
    caseId: 'c417',
    kind: 'live',
    iconTone: 'brand',
    when: t(2026, 5, 3, 10, 12),
    timestamp: t(2026, 5, 3, 10, 12),
    title: 'Sourcing solver — 4 of 38 products eligible',
    body: 'Halifax @ 4.22% recommended on true cost. Reflows the moment you change a constraint, the fact find moves, or a lender updates criteria.',
    cta: 'Open solver',
    pulse: true,
    pinned: true,
    trace: {
      claim:
        '4 of 38 lender products pass the joint case at current constraints',
      subject: 'Constraint solver · last recomputed 12s ago',
      working: [
        '1. LTV 85% (£242,250 ÷ £285,000)',
        '2. LTI 2.95× against £82,100 combined income',
        '3. Skipton, Coventry drop out on probation criteria',
      ],
      evidence: [
        {
          kind: 'criteria',
          label: 'Halifax criteria · Section 4.2 v24.6',
          quote: 'From first payslip, no min service',
          source: 'Halifax criteria · v24.6',
        },
        {
          kind: 'criteria',
          label: 'Skipton criteria · § 3.1',
          source: 'Skipton criteria · v24.6',
        },
      ],
      confidence: 0.96,
    },
    schemaVersion: CRM_SCHEMA_VERSION,
  },
  {
    id: 's-conf',
    caseId: 'c417',
    kind: 'conflict',
    iconTone: 'status-warning',
    when: t(2026, 5, 3, 10, 8),
    timestamp: t(2026, 5, 3, 10, 8),
    title: "Conflict: Daniel's salary varies between contract and payslip",
    body: 'Contract £38,500 vs payslip annualised £37,300 (£1,200 variance).',
    linkedWorklistId: 'w1',
    trace: {
      claim: 'Contract salary and payslip annualisation disagree by £1,200',
      subject: 'income.basic',
      working: [
        '1. Contract: annual salary £38,500',
        '2. Payslip: monthly gross £3,108.33 × 12 = £37,300 annualised',
        '3. £1,200 gap exceeds 1% materiality threshold',
      ],
      evidence: [
        {
          kind: 'document',
          label: 'Employment contract',
          source: 'd5',
          quote: 'Annual salary: £38,500 (MPS3, Outer London weighting)',
        },
        {
          kind: 'document',
          label: 'Payslip',
          source: 'd2',
          quote: 'Gross this period: £3,108.33 · Period: 1',
        },
      ],
      alternatives: [
        {
          option: 'Use contract £38,500',
          reason: 'Authoritative source',
          rejected: false,
        },
        {
          option: 'Use payslip £37,300',
          reason: 'First-payslip actuals',
          rejected: false,
        },
      ],
      confidence: 0.78,
      calibration:
        'Detected with high confidence; resolution requires adviser judgement.',
    },
    schemaVersion: CRM_SCHEMA_VERSION,
  },
  {
    id: 's-app',
    caseId: 'c417',
    kind: 'approval',
    iconTone: 'status-success',
    when: t(2026, 5, 3, 9, 19),
    timestamp: t(2026, 5, 3, 9, 19),
    title: 'Fact find built from documents — 31 fields ready to approve',
    body: '25 deterministic from documents · 6 synthesized · 2 await your confirmation. Joint completeness 38% → 90% in 4 minutes.',
    linkedWorklistId: 'w4',
    trace: {
      claim: '31 fact-find fields populated from 5 documents',
      working: [
        '1. Extracted 25 deterministic fields verbatim from documents',
        '2. Synthesized 6 fields with per-field confidence',
        '3. Held 2 low-confidence fields for adviser review',
      ],
      evidence: [
        { kind: 'document', label: 'Passport', source: 'd1' },
        { kind: 'document', label: 'Payslip', source: 'd2' },
        { kind: 'document', label: 'P60', source: 'd3' },
      ],
      confidence: 0.93,
    },
    schemaVersion: CRM_SCHEMA_VERSION,
  },
  {
    id: 's-gift',
    caseId: 'c417',
    kind: 'external',
    iconTone: 'brand',
    when: t(2026, 5, 3, 10, 5),
    timestamp: t(2026, 5, 3, 10, 5),
    title: "Gift letter requested from Aisha's mum",
    body: "Sent via Aisha's WhatsApp (her preferred channel — 4/4 reply rate). Auto-chase scheduled for tomorrow 10:00 if no reply. Submission blocks until letter is on file.",
    linkedWorklistId: 'w3',
    trace: {
      claim:
        'Requesting the gifted-deposit letter via the highest-reply channel',
      working: [
        '1. Reply rate: WhatsApp 4/4 vs email 0/2',
        '2. Third-party consent recorded on file',
        '3. Auto-chase scheduled at +24 h',
      ],
      evidence: [
        {
          kind: 'policy',
          label: 'Third-party contact rule',
          source: 'Internal · CP-2024',
        },
      ],
      confidence: 0.85,
    },
    schemaVersion: CRM_SCHEMA_VERSION,
  },
  {
    id: 's-aff',
    caseId: 'c417',
    kind: 'done',
    iconTone: 'status-success',
    when: t(2026, 5, 3, 10, 2),
    timestamp: t(2026, 5, 3, 10, 2),
    title: 'Affordability modelled — 2.95× LTI, £1,180 surplus',
    trace: {
      claim: 'Case affordability comfortably within lender limits',
      working: [
        '1. Combined income £82,100 (Aisha £43,600 + Daniel £38,500)',
        '2. Loan £242,250 ÷ £82,100 = 2.95× LTI',
        '3. Halifax 4.22% / 32 yr → £1,198 monthly',
        '4. Stress 8.49% → +£1,028 → surplus £1,180',
      ],
      evidence: [
        {
          kind: 'policy',
          label: 'PRA stress floor +3pp',
          source: 'PRA CP-2024',
        },
      ],
      confidence: 0.96,
    },
    schemaVersion: CRM_SCHEMA_VERSION,
  },
  {
    id: 's-crit',
    caseId: 'c417',
    kind: 'done',
    iconTone: 'brand',
    when: t(2026, 5, 3, 10, 0),
    timestamp: t(2026, 5, 3, 10, 0),
    title: 'Criteria sweep — 10 gates × 38 lenders',
    body: '8 gates pass cleanly; 2 caution. 6 lenders fall out on tenure; 4 on construction; 2 on probation policy. 4 eligible products remain.',
    trace: {
      claim: 'Criteria sweep isolates 4 eligible lender products',
      working: [
        '1. 10 gates evaluated across 38 lenders',
        '2. 6 fall out on tenure; 4 on construction; 2 on probation',
      ],
      evidence: [{ kind: 'criteria', label: 'Sweep engine v24.6' }],
      confidence: 0.95,
    },
    schemaVersion: CRM_SCHEMA_VERSION,
  },
  {
    id: 's-ext',
    caseId: 'c417',
    kind: 'done',
    iconTone: 'brand',
    when: t(2026, 5, 3, 9, 18),
    timestamp: t(2026, 5, 3, 9, 18),
    title: 'Documents classified, extracted, and attributed',
    body: '5 documents · 0.93 mean confidence · 1 still processing.',
    trace: {
      claim:
        'Documents classified, extracted, attributed to the right applicant',
      working: [
        '1. Classified by mime, OCR signature and content',
        '2. Extracted typed fields per document class',
        '3. Attributed to applicant by name/NI match on field cluster',
      ],
      evidence: [
        { kind: 'document', label: 'd1' },
        { kind: 'document', label: 'd2' },
        { kind: 'document', label: 'd3' },
      ],
      confidence: 0.93,
    },
    schemaVersion: CRM_SCHEMA_VERSION,
  },
  {
    id: 's-comp',
    caseId: 'c417',
    kind: 'done',
    iconTone: 'status-success',
    when: t(2026, 5, 3, 8, 30),
    timestamp: t(2026, 5, 3, 8, 30),
    title: 'IDD, ID&V and AML clear · Consumer Duty stance recorded',
    trace: {
      claim: 'Compliance floor cleared',
      working: [
        '1. IDD issued at first contact',
        '2. ID&V passed for both applicants',
        '3. AML SmartSearch clean',
      ],
      evidence: [{ kind: 'policy', label: 'Consumer Duty framework' }],
      confidence: 1,
    },
    schemaVersion: CRM_SCHEMA_VERSION,
  },
];
