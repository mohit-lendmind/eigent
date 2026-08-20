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

import type { FactFindSectionKey } from './factFindSchema';
import type { Pence } from './money';
import type { Stage } from './stages';

export type { FactFindSectionKey } from './factFindSchema';
export type { Pence } from './money';
export type { Stage } from './stages';

export const CRM_SCHEMA_VERSION = 1;

// Branded id types keep call sites honest without runtime cost.
export type ClientId = string;
export type CaseId = string;
export type DocumentId = string;
export type InsightId = string;
export type WorklistId = string;
export type StreamId = string;
export type ConflictId = string;
export type EventId = string;
export type ActivityId = string;

export type EpochMs = number;

// Every entity a downstream agent (F07) could produce carries this seam
// so the ingest pipeline lands as a data-plumbing change, not a type migration.
export interface Origin {
  artifactId: string;
  runId: string;
}

// FR-004: fact-find field value is a discriminated union keyed by `t`.
// Money is its own variant; display strings never round-trip through storage.
export type FieldValue =
  | { t: 'text'; v: string }
  | { t: 'select'; v: string; options?: readonly string[] }
  | { t: 'date'; v: string }
  | { t: 'number'; v: number }
  | { t: 'money'; v: Pence }
  | { t: 'toggle'; v: boolean };

export type Src = 'det' | 'syn';

export interface FactFindField {
  k: string;
  label: string;
  value: FieldValue;
  src: Src;
  hint?: string;
  flag?: true;
  conflictId?: ConflictId;
  mono?: boolean;
  confirmedAt?: EpochMs;
  confirmedBy?: string;
  origin?: Origin;
}

export interface FactFindSection {
  completeness: number;
  fields: FactFindField[];
}

export type ApplicantProfile = Partial<
  Record<FactFindSectionKey, FactFindSection>
>;

export interface Applicant {
  clientId: ClientId;
  role: 'primary' | 'secondary' | 'sole';
  profile: ApplicantProfile;
  completeness: number;
}

export interface CaseProperty {
  address: string;
  city?: string;
  postcode?: string;
  price: Pence;
  propertyType?: string;
  tenure?: 'freehold' | 'leasehold';
}

export interface DepositSource {
  label: string;
  amount: Pence;
  flag?: true;
  note?: string;
}

export interface Deposit {
  amount: Pence;
  percent: number;
  sources: DepositSource[];
}

export interface Requirement {
  loan: Pence;
  ltv: number;
  ltvPercent: number;
  lti: number;
  termYears: number;
  repaymentType: 'C&I' | 'INTEREST_ONLY';
  productType: '2yr' | '5yr' | 'tracker';
}

export interface Affordability {
  combinedIncome: Pence;
  monthlyCommitments: Pence;
  disposableIncome?: Pence;
  affordabilityScore?: number;
  stressRate?: number;
}

export interface CaseRetention {
  reason: string;
  daysLeft: number;
  endsAt?: EpochMs;
}

export interface CaseOwnership {
  adviserId: string;
  firmId: string;
  networkId: string;
}

export interface Case {
  id: CaseId;
  ref: string;
  type: string;
  kind: string;
  label: string;
  stage: Stage;
  completeness: number;
  updated: EpochMs;
  applicants: Applicant[];
  property: CaseProperty;
  deposit: Deposit;
  requirement: Requirement;
  affordability: Affordability;
  retention?: CaseRetention;
  ownership?: CaseOwnership;
  schemaVersion: number;
  origin?: Origin;
}

export interface Client {
  id: ClientId;
  ref: string;
  firstName: string;
  lastName: string;
  initials: string;
  tint: string;
  textCls: string;
  role?: string;
  email?: string;
  phone?: string;
  cases: CaseId[];
  since: EpochMs;
  schemaVersion: number;
  repaired?: true;
  ownershipHint?: CaseOwnership;
  origin?: Origin;
}

export type DocumentStatus = 'PROCESSING' | 'COMPLETED' | 'REJECTED';

export interface DocInsight {
  id: InsightId;
  label: string;
  value: FieldValue | string | number | boolean | null;
  conf: number;
  good?: true;
  flag?: true;
  conflict?: boolean;
  sourceQuote?: string;
  origin?: Origin;
}

export interface CrmDocument {
  id: DocumentId;
  owner: ClientId | 'joint';
  name: string;
  type: string;
  status: DocumentStatus;
  size: number;
  when: EpochMs;
  iconTone: string;
  attribution: number | null;
  joint?: boolean;
  confirmedAt?: EpochMs;
  confirmedBy?: string;
  insights: DocInsight[];
  schemaVersion: number;
  origin?: Origin;
}

export type ChecklistStatus = 'received' | 'pending' | 'partial' | 'requested';

export interface DocChecklistItem {
  owner: ClientId | 'joint';
  itemKey: string;
  label: string;
  status: ChecklistStatus;
  note?: string;
  updatedAt: EpochMs;
}

export type WorklistKind =
  'conflict' | 'criteria' | 'doc' | 'approval' | 'retention' | 'signature';

export interface WorklistResolution {
  method?: 'confirm-value' | 'ask-client' | 'reviewed' | 'signed' | 'other';
  reasoning?: string;
  chosenValue?: FieldValue;
  detail?: string;
}

export interface WorklistItem {
  id: WorklistId;
  caseId: CaseId;
  kind: WorklistKind;
  title: string;
  detail: string;
  cta?: string;
  tab?: string;
  auto?: boolean;
  status: 'open' | 'resolved';
  createdAt: EpochMs;
  resolvedAt?: EpochMs;
  resolvedBy?: string;
  resolution?: WorklistResolution;
  linkedConflictId?: ConflictId;
  linkedDocId?: DocumentId;
  origin?: Origin;
  schemaVersion: number;
}

export type StreamKind =
  | 'live'
  | 'intent'
  | 'approval'
  | 'conflict'
  | 'external'
  | 'done'
  | 'blocked'
  | 'activity'
  | 'directive';

export interface EvidenceCitation {
  kind: 'criteria' | 'field' | 'document' | 'policy' | 'calc';
  label: string;
  value?: string | number | boolean;
  source?: string;
  quote?: string;
  note?: string;
}

export interface ReasoningAlternative {
  option: string;
  reason: string;
  rejected?: boolean;
}

export interface ReasoningTrace {
  claim: string;
  subject?: string;
  working: string[];
  evidence: EvidenceCitation[];
  alternatives?: ReasoningAlternative[];
  confidence: number;
  calibration?: string;
}

export interface StreamAction {
  key: string;
  label: string;
  intent?: 'primary' | 'secondary' | 'destructive';
}

export interface StreamEntry {
  id: StreamId;
  caseId: CaseId;
  kind: StreamKind;
  iconTone: string;
  when: EpochMs;
  timestamp?: EpochMs;
  title: string;
  body?: string;
  cta?: string;
  actions?: StreamAction[];
  pulse?: boolean;
  pinned?: boolean;
  trace?: ReasoningTrace;
  linkedWorklistId?: WorklistId;
  truncatedBefore?: EpochMs;
  truncatedCount?: number;
  schemaVersion: number;
  origin?: Origin;
}

export interface ActivityEvent {
  id: ActivityId;
  caseId: CaseId;
  kind:
    | 'stage-change'
    | 'repair'
    | 'refusal'
    | 'note'
    | 'seed'
    | 'ai-did'
    | 'system';
  title: string;
  detail?: string;
  when: EpochMs;
  actor?: string;
  schemaVersion: number;
}

export type CriterionStatus = 'pass' | 'warning' | 'info';

export interface CriterionImpact {
  lender: string;
  status: CriterionStatus | 'fail';
  note: string;
}

export interface CriterionCheck {
  id: string;
  caseId: CaseId;
  group: 'lending' | 'affordability';
  cat: string;
  label: string;
  status: CriterionStatus;
  reasoning: string;
  impacts?: CriterionImpact[];
  schemaVersion: number;
  origin?: Origin;
}

export type ProductStatus = 'pass' | 'fail';

export interface Product {
  id: string;
  caseId: CaseId;
  lender: string;
  product: string;
  rate: number;
  type: '2yr' | '5yr' | 'tracker';
  fee: Pence;
  monthly: Pence;
  ltv: number;
  total: Pence;
  status: ProductStatus;
  recommended?: boolean;
  notes?: string;
  apr: number;
  rationale?: string;
  criteriaTrail?: string[];
  rejectReason?: string;
  rejectCriterion?: string;
  failOn?: string;
  universe: '2yr' | '5yr';
  origin?: Origin;
  schemaVersion: number;
}

export interface RetentionEntry {
  clientId: ClientId;
  ref: string;
  endsAt: EpochMs;
  daysLeft: number;
  lender: string;
  rate: number;
  status: 'case-open' | 'due' | 'horizon';
  schemaVersion: number;
}

export interface ConflictValueSource {
  kind: 'document' | 'manual' | 'insight';
  docId?: DocumentId;
  insightLabel?: string;
  quote?: string;
}

export interface ConflictValue {
  value: FieldValue;
  source: ConflictValueSource;
  confidence?: number;
}

export interface ConflictResolution {
  chosenValue: FieldValue;
  method: 'confirm-value' | 'ask-client';
  reasoning?: string;
}

export interface ConflictRecord {
  id: ConflictId;
  caseId: CaseId;
  clientId: ClientId;
  section: FactFindSectionKey;
  fieldKey: string;
  values: ConflictValue[];
  detectedAt: EpochMs;
  detectedBy?: string;
  resolvedAt?: EpochMs;
  resolvedBy?: string;
  resolution?: ConflictResolution;
  origin?: Origin;
  schemaVersion: number;
}

export type FieldChangeReason =
  'edit' | 'confirm-synthesized' | 'conflict-resolution' | 'seed' | 'import';

export interface FieldChangeEvent {
  id: EventId;
  caseId: CaseId;
  clientId: ClientId;
  section: FactFindSectionKey;
  fieldKey: string;
  priorValue: FieldValue | null;
  newValue: FieldValue;
  priorSrc: Src | null;
  newSrc: Src;
  changedAt: EpochMs;
  changedBy: string;
  reason: FieldChangeReason;
  conflictId?: ConflictId;
  origin?: Origin;
  schemaVersion: number;
}

export interface ComplianceItem {
  key: string;
  label: string;
  status: 'pass' | 'pending' | 'na' | 'warning';
  detail?: string;
  updatedAt?: EpochMs;
}

export interface ComplianceRecord {
  caseId: CaseId;
  disclosures: ComplianceItem[];
  idAndV: ComplianceItem[];
  aml: ComplianceItem[];
  vulnerability: ComplianceItem[];
  consumerDuty: ComplianceItem[];
  declaration?: ComplianceItem;
  supervision: ComplianceItem[];
  schemaVersion: number;
}

export interface RepairReport {
  ranAt: EpochMs;
  envMismatch: boolean;
  placeholderClientsCreated: ClientId[];
  prunedWorklist: WorklistId[];
  prunedStream: StreamId[];
  prunedActivity: ActivityId[];
  retargetedDocuments: DocumentId[];
  recomputedCases: CaseId[];
}

export interface CaseFileExportEnvelope {
  exportVersion: 1;
  exportedAt: EpochMs;
  crmSchemaVersion: number;
  caseId: CaseId;
}

export interface CaseFileExportRecords {
  case: Case;
  clients: Client[];
  applicants: Applicant[];
  documents: CrmDocument[];
  checklist: DocChecklistItem[];
  worklist: WorklistItem[];
  stream: StreamEntry[];
  activity: ActivityEvent[];
  criteria: CriterionCheck[];
  products: Product[];
  retention: RetentionEntry[];
  compliance: ComplianceRecord | null;
  conflicts: ConflictRecord[];
  fieldChangeEvents: FieldChangeEvent[];
}

export interface CaseFileExport {
  envelope: CaseFileExportEnvelope;
  records: CaseFileExportRecords;
}

export type Placeholder = Client & { repaired: true };
