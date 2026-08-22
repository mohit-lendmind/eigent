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

// The golden case-log: the c417 (Okafor/Reyes) purchase reconstructed as a
// content-hash chain, one entry per F01 write. It exercises every event-kind
// union member so the fold's apply/quarantine/halt paths all have real input,
// and every payload is a FULLY-FORMED deterministic domain object (no minted
// ids, no Date.now) — that is what lets a batch fold and an incremental fold
// converge byte-for-byte, and a wipe-then-refold reproduce the same snapshot.
//
// Colour references are semantic tone keys (design-token gate scans fixtures).

import type {
  CaseLogActorKind,
  CaseLogEntry,
  CaseLogEventKind,
} from '../../agentContracts/caseLog';
import { toPence } from '../../domain/money';
import type {
  ActivityEvent,
  Case,
  Client,
  ConflictRecord,
  CrmDocument,
  DocChecklistItem,
  FieldValue,
  Stage,
  StreamEntry,
  WorklistItem,
} from '../../domain/types';
import { CRM_SCHEMA_VERSION } from '../../domain/types';
import { buildChain, type CaseLogEntryDraft } from './buildChain';

const FIRM = 'firm-lm';
const CASE = 'c417';
const RUN = 'run-c417';
const VERSIONS = {
  model: 'claude-golden',
  promptSha: 'prompt-0001',
  skillSemver: '1.0.0',
  skillSha: 'skill-0001',
} as const;

// Deterministic monotone clock: one minute between writes, seeded at a fixed
// UTC instant so re-authoring produces identical `at` values every run.
const T0 = Date.UTC(2026, 2, 2, 9, 0, 0);
const at = (step: number): number => T0 + step * 60_000;

const agent = (id: string): { kind: CaseLogActorKind; id: string } => ({
  kind: 'agent',
  id,
});
const adviser = { kind: 'adviser' as CaseLogActorKind, id: 'adv-imran' };

// Sequential draft factory — `step` doubles as the monotone-clock tick and the
// per-kind artifact discriminator, keeping origin ids deterministic.
function draft(
  step: number,
  type: CaseLogEventKind,
  payload: Record<string, unknown>,
  actor: { kind: CaseLogActorKind; id: string } = agent('f07')
): CaseLogEntryDraft {
  return {
    kind: 'lm.caselog/1',
    caseId: CASE,
    firmId: FIRM,
    at: at(step),
    actor,
    event: { type, payload },
    origin: { artifactId: `art-${type}-${step}`, runId: RUN },
    versions: { ...VERSIONS },
  };
}

// ---- Fully-formed domain payloads -----------------------------------------

function aishaClient(): Client {
  return {
    id: 'aisha',
    ref: 'LM-C-2041',
    firstName: 'Aisha',
    lastName: 'Okafor',
    initials: 'AO',
    tint: 'brand',
    textCls: 'brand',
    role: 'Registered Nurse',
    cases: [CASE],
    since: T0,
    schemaVersion: CRM_SCHEMA_VERSION,
  };
}

function danielClient(): Client {
  return {
    id: 'daniel',
    ref: 'LM-C-2042',
    firstName: 'Daniel',
    lastName: 'Reyes',
    initials: 'DR',
    tint: 'status-success',
    textCls: 'status-success',
    role: 'Secondary School Teacher',
    cases: [CASE],
    since: T0,
    schemaVersion: CRM_SCHEMA_VERSION,
  };
}

function caseAt(stage: Stage, completeness: number, updated: number): Case {
  return {
    id: CASE,
    ref: 'LM-2041',
    type: 'residential',
    kind: 'purchase',
    label: 'Okafor / Reyes',
    stage,
    completeness,
    updated,
    applicants: [
      { clientId: 'aisha', role: 'primary', profile: {}, completeness: 0 },
      { clientId: 'daniel', role: 'secondary', profile: {}, completeness: 0 },
    ],
    property: {
      address: '12 Elm Row',
      city: 'Bristol',
      price: toPence(42_500_000),
    },
    deposit: { amount: toPence(8_500_000), percent: 20, sources: [] },
    requirement: {
      loan: toPence(34_000_000),
      ltv: 0.8,
      ltvPercent: 80,
      lti: 4.2,
      termYears: 30,
      repaymentType: 'C&I',
      productType: '2yr',
    },
    affordability: {
      combinedIncome: toPence(8_200_000),
      monthlyCommitments: toPence(40_000),
    },
    schemaVersion: CRM_SCHEMA_VERSION,
  };
}

function doc(
  id: string,
  owner: string,
  name: string,
  type: string,
  when: number
): CrmDocument {
  return {
    id,
    owner,
    name,
    type,
    status: 'COMPLETED',
    size: 128_000,
    when,
    iconTone: 'muted',
    attribution: null,
    insights: [],
    schemaVersion: CRM_SCHEMA_VERSION,
  };
}

function checklist(
  owner: string,
  itemKey: string,
  label: string,
  status: DocChecklistItem['status'],
  updatedAt: number
): DocChecklistItem {
  return { owner, itemKey, label, status, updatedAt };
}

function activity(
  id: string,
  kind: ActivityEvent['kind'],
  title: string,
  when: number
): ActivityEvent {
  return {
    id,
    caseId: CASE,
    kind,
    title,
    when,
    schemaVersion: CRM_SCHEMA_VERSION,
  };
}

function stream(
  id: string,
  kind: StreamEntry['kind'],
  title: string,
  when: number
): StreamEntry {
  return {
    id,
    caseId: CASE,
    kind,
    iconTone: 'muted',
    when,
    title,
    schemaVersion: CRM_SCHEMA_VERSION,
  };
}

function worklist(
  id: string,
  kind: WorklistItem['kind'],
  title: string,
  createdAt: number
): WorklistItem {
  return {
    id,
    caseId: CASE,
    kind,
    title,
    detail: title,
    status: 'open',
    createdAt,
    schemaVersion: CRM_SCHEMA_VERSION,
  };
}

const incomeConflict = (resolvedAt?: number): ConflictRecord => ({
  id: 'cf-daniel-income',
  caseId: CASE,
  clientId: 'daniel',
  section: 'income',
  fieldKey: 'basicSalary',
  values: [
    {
      value: { t: 'money', v: toPence(3_800_000) },
      source: { kind: 'document', docId: 'doc-payslip', quote: 'Basic 38,000' },
    },
    {
      value: { t: 'money', v: toPence(4_100_000) },
      source: { kind: 'manual' },
    },
  ],
  detectedAt: at(19),
  ...(resolvedAt !== undefined
    ? {
        resolvedAt,
        resolvedBy: adviser.id,
        resolution: {
          chosenValue: { t: 'money', v: toPence(3_800_000) } as FieldValue,
          method: 'confirm-value' as const,
          reasoning: 'Payslip is the primary source.',
        },
      }
    : {}),
  schemaVersion: CRM_SCHEMA_VERSION,
});

const fieldChange = (
  clientId: string,
  section: string,
  fieldKey: string,
  label: string,
  value: FieldValue,
  src: 'det' | 'syn'
): Record<string, unknown> => ({
  clientId,
  section,
  fieldKey,
  label,
  value,
  src,
});

// ---- The chain (ordered; every union member appears at least once) --------

const drafts: CaseLogEntryDraft[] = [
  draft(1, 'case-upsert', { case: caseAt('LEAD', 5, at(1)) }),
  draft(2, 'client-upsert', { client: aishaClient() }),
  draft(3, 'client-upsert', { client: danielClient() }),
  draft(4, 'activity', {
    activity: activity('ac-seed', 'seed', 'Case opened from lead', at(4)),
  }),
  draft(5, 'stage-transition', { stage: 'FACT_FIND' as Stage }, adviser),
  draft(
    6,
    'field-change',
    fieldChange(
      'aisha',
      'personal',
      'firstName',
      'First name',
      { t: 'text', v: 'Aisha' },
      'det'
    )
  ),
  draft(
    7,
    'field-change',
    fieldChange(
      'aisha',
      'personal',
      'dob',
      'Date of birth',
      { t: 'date', v: '1994-02-11' },
      'det'
    )
  ),
  draft(
    8,
    'field-change',
    fieldChange(
      'daniel',
      'personal',
      'firstName',
      'First name',
      { t: 'text', v: 'Daniel' },
      'det'
    )
  ),
  draft(
    9,
    'field-change',
    fieldChange(
      'aisha',
      'income',
      'basicSalary',
      'Basic salary',
      { t: 'money', v: toPence(4_400_000) },
      'det'
    )
  ),
  draft(
    10,
    'field-change',
    fieldChange(
      'daniel',
      'income',
      'basicSalary',
      'Basic salary',
      { t: 'money', v: toPence(4_100_000) },
      'syn'
    )
  ),
  draft(
    11,
    'field-change',
    fieldChange(
      'aisha',
      'employment',
      'employer',
      'Employer',
      { t: 'text', v: 'NHS Trust' },
      'det'
    )
  ),
  draft(
    12,
    'field-change',
    fieldChange(
      'daniel',
      'employment',
      'employer',
      'Employer',
      { t: 'text', v: 'Bristol Academy' },
      'det'
    )
  ),
  draft(13, 'document-upsert', {
    document: doc('doc-payslip', 'daniel', 'Payslip March', 'payslip', at(13)),
  }),
  draft(14, 'document-upsert', {
    document: doc(
      'doc-bank',
      'aisha',
      'Bank statement',
      'bank-statement',
      at(14)
    ),
  }),
  draft(15, 'document-upsert', {
    document: doc('doc-id', 'aisha', 'Passport', 'identity', at(15)),
  }),
  draft(16, 'checklist-status', {
    item: checklist('daniel', 'payslip', 'Latest payslip', 'received', at(16)),
  }),
  draft(17, 'checklist-status', {
    item: checklist(
      'aisha',
      'bank-statement',
      'Bank statements',
      'received',
      at(17)
    ),
  }),
  draft(18, 'checklist-status', {
    item: checklist('aisha', 'identity', 'Photo ID', 'received', at(18)),
  }),
  draft(19, 'conflict-upsert', { record: incomeConflict() }),
  draft(20, 'worklist-upsert', {
    item: {
      ...worklist(
        'wl-cf-income',
        'conflict',
        'Resolve income conflict',
        at(20)
      ),
      linkedConflictId: 'cf-daniel-income',
    },
  }),
  draft(21, 'stream-entry', {
    entry: stream('st-conflict', 'conflict', 'Income figures disagree', at(21)),
  }),
  draft(22, 'activity', {
    activity: activity(
      'ac-conflict',
      'ai-did',
      'Flagged income conflict',
      at(22)
    ),
  }),
  draft(23, 'conflict-resolve', { record: incomeConflict(at(23)) }, adviser),
  draft(
    24,
    'field-change',
    fieldChange(
      'daniel',
      'income',
      'basicSalary',
      'Basic salary',
      { t: 'money', v: toPence(3_800_000) },
      'det'
    ),
    adviser
  ),
  draft(
    25,
    'worklist-resolve',
    {
      id: 'wl-cf-income',
      resolution: { method: 'confirm-value', reasoning: 'Payslip primary.' },
      resolvedBy: adviser.id,
    },
    adviser
  ),
  draft(26, 'activity', {
    activity: activity(
      'ac-resolved',
      'note',
      'Income conflict resolved',
      at(26)
    ),
  }),
  draft(27, 'checklist-status', {
    item: checklist(
      'daniel',
      'proof-of-address',
      'Proof of address',
      'pending',
      at(27)
    ),
  }),
  draft(28, 'stream-entry', {
    entry: stream('st-factfind', 'activity', 'Fact-find progressing', at(28)),
  }),
  draft(29, 'case-upsert', { case: caseAt('FACT_FIND', 55, at(29)) }),
  draft(30, 'stage-transition', { stage: 'SOURCING' as Stage }, adviser),
  draft(31, 'stream-entry', {
    entry: stream('st-sourcing', 'intent', 'Sourcing products', at(31)),
  }),
  draft(32, 'worklist-upsert', {
    item: worklist('wl-criteria-ltv', 'criteria', 'LTV within panel', at(32)),
  }),
  draft(33, 'activity', {
    activity: activity('ac-source', 'ai-did', 'Ran sourcing pass', at(33)),
  }),
  draft(34, 'stream-entry', {
    entry: stream('st-approval', 'approval', 'Awaiting DIP approval', at(34)),
  }),
  draft(35, 'stage-transition', { stage: 'DIP' as Stage }, adviser),
  draft(36, 'activity', {
    activity: activity('ac-dip', 'stage-change', 'Moved to DIP', at(36)),
  }),
  draft(37, 'stream-entry', {
    entry: stream('st-dip', 'done', 'DIP submitted', at(37)),
  }),
  draft(38, 'checklist-status', {
    item: checklist(
      'daniel',
      'proof-of-address',
      'Proof of address',
      'received',
      at(38)
    ),
  }),
  // Reserved chain-anchor: a writer-side re-base the fold applies as a no-op.
  draft(39, 'chain-anchor', {}, { kind: 'system', id: 'writer' }),
  draft(40, 'case-upsert', { case: caseAt('DIP', 78, at(40)) }),
  draft(41, 'activity', {
    activity: activity('ac-final', 'system', 'Chain anchored at DIP', at(41)),
  }),
  // A G1 onboarding gate raised by the agent and then resolved by the adviser —
  // the two gate-mirror event kinds (findings 5/10) the fold reconstructs into
  // openGates, so the golden log covers every known member including these.
  draft(42, 'gate-raise', {
    gate: {
      id: 'G1_c417',
      gateId: 'G1',
      caseId: CASE,
      projectId: 'proj-c417',
      approvalId: 'appr-G1-c417',
      title: 'Approve the onboarding send',
      reasons: ['Onboarding pack drafted; awaiting adviser approval to send.'],
      raisedAt: at(42),
      status: 'open',
    },
  }),
  draft(
    43,
    'gate-resolve',
    { id: 'G1_c417', decision: 'allow', edited: false },
    adviser
  ),
];

let cached: Promise<CaseLogEntry[]> | null = null;

/** The golden c417 chain (≥40 entries), stamped once and memoised. */
export function c417Log(): Promise<CaseLogEntry[]> {
  cached ??= buildChain(drafts);
  return cached;
}

/** The ordered drafts, for tests that want to re-stamp under other options. */
export const c417Drafts: readonly CaseLogEntryDraft[] = drafts;
