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

/**
 * Contract: the four zustand stores' state shapes and action signatures.
 * Path in implementation: src/crm/clientsStore.ts, casesStore.ts, documentsStore.ts, workstreamStore.ts
 *
 * This file is a specification, not an implementation. See specs/001-crm-domain-core/data-model.md
 * for the narrative model and spec.md for the FR mapping.
 */

import type { StoreApi, UseBoundStore } from 'zustand';

// ─────────────────────────────────────────────────────────────────────────────
// Branded scalars & shared discriminators
// ─────────────────────────────────────────────────────────────────────────────

export type Pence = number & { readonly __pence: unique symbol };
export type ClientId = string; // /^client_/
export type CaseId = string; // /^case_/
export type DocumentId = string; // /^doc_/
export type InsightId = string; // /^insight_/
export type WorklistId = string; // /^wl_/
export type StreamId = string; // /^stream_/
export type ConflictId = string; // /^conflict_/
export type EventId = string; // /^event_/

export type EpochMs = number;

export type Stage =
  | 'LEAD'
  | 'FACT_FIND'
  | 'SOURCING'
  | 'DIP'
  | 'APPLICATION'
  | 'VALUATION'
  | 'OFFER'
  | 'COMPLETION';

export type Src = 'det' | 'syn';

export type FieldValue =
  | { t: 'text'; v: string }
  | { t: 'select'; v: string; options?: string[] }
  | { t: 'date'; v: string /* ISO YYYY-MM-DD */ }
  | { t: 'number'; v: number }
  | { t: 'money'; v: Pence }
  | { t: 'toggle'; v: boolean };

export type FactFindSectionKey =
  | 'personal'
  | 'contact'
  | 'address'
  | 'employment'
  | 'income'
  | 'expenditure'
  | 'credit';

export interface Origin {
  artifactId: string;
  runId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Entities (subset — full shapes in data-model.md / implementation types.ts)
// ─────────────────────────────────────────────────────────────────────────────

export interface Client {
  id: ClientId;
  ref: string;
  firstName: string;
  lastName: string;
  initials: string;
  tint: string; // semantic tone key — never hex/rgb/tailwind color
  textCls: string; // semantic tone key
  role?: string;
  email?: string;
  phone?: string;
  cases: CaseId[];
  since: EpochMs;
  schemaVersion: number;
  repaired?: true;
  ownershipHint?: unknown;
  origin?: Origin;
}

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
  completeness: number; // [0, 1]
  fields: FactFindField[];
}

export interface Applicant {
  clientId: ClientId;
  role: 'primary' | 'secondary' | 'sole';
  profile: Partial<Record<FactFindSectionKey, FactFindSection>>;
  completeness: number; // [0, 1]
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
  property: unknown; // CaseProperty — see data-model.md
  deposit: unknown; // Deposit
  requirement: unknown; // Requirement
  affordability: unknown; // Affordability
  retention?: { reason: string; daysLeft: number };
  ownership?: { adviserId: string; firmId: string; networkId: string };
  schemaVersion: number;
  origin?: Origin;
}

export interface ConflictValue {
  value: FieldValue;
  source: {
    kind: 'document' | 'manual' | 'insight';
    docId?: DocumentId;
    insightLabel?: string;
    quote?: string;
  };
  confidence?: number;
}

export interface ConflictRecord {
  id: ConflictId;
  caseId: CaseId;
  clientId: ClientId;
  section: FactFindSectionKey;
  fieldKey: string;
  values: ConflictValue[]; // never truncated; both originals preserved for the life of the case
  detectedAt: EpochMs;
  detectedBy?: string;
  resolvedAt?: EpochMs;
  resolvedBy?: string;
  resolution?: {
    chosenValue: FieldValue;
    method: 'confirm-value' | 'ask-client';
    reasoning?: string;
  };
  origin?: Origin;
  schemaVersion: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// clientsStore
// ─────────────────────────────────────────────────────────────────────────────

export interface CrmClientsState {
  clientsById: Record<ClientId, Client>;

  upsertClients(clients: Client[]): void; // FR-015

  removeClient(
    id: ClientId
  ):
    | { ok: true }
    | { ok: false; reason: 'referenced_by_case'; caseIds: CaseId[] }; // FR-016 — refuse, never throw

  noteClientCase(clientId: ClientId, caseId: CaseId): void; // FR-017 — idempotent append

  /** Returns the client if known, else a placeholder Client so pure selectors never throw. FR-038 */
  ensureClient(id: ClientId): Client;
}

export declare const useCrmClientsStore: UseBoundStore<
  StoreApi<CrmClientsState>
>;
export declare function getCrmClientsStore(): StoreApi<CrmClientsState>;

// ─────────────────────────────────────────────────────────────────────────────
// casesStore
// ─────────────────────────────────────────────────────────────────────────────

export interface CrmCasesState {
  casesById: Record<CaseId, Case>;
  conflictsById: Record<ConflictId, ConflictRecord>;
  criteriaByCase: Record<CaseId, unknown[]>;
  productsByCase: Record<CaseId, unknown[]>;
  complianceByCase: Record<CaseId, unknown | undefined>;

  upsertCases(cases: Case[]): void;
  moveStage(caseId: CaseId, nextStageKey: Stage): void; // FR-021 — appends ActivityEvent; validated via stage-map lookup

  setFactFindField(
    caseId: CaseId,
    clientId: ClientId,
    section: FactFindSectionKey,
    fieldKey: string,
    newValue: FieldValue,
    opts: { reason?: 'edit' | 'seed' | 'import'; changedBy: string; src?: Src }
  ): void; // FR-018 — atomic write + FieldChangeEvent + recompute completeness

  confirmSynthesizedField(
    caseId: CaseId,
    clientId: ClientId,
    section: FactFindSectionKey,
    fieldKey: string,
    opts: { confirmedBy: string }
  ): void; // FR-019 — flip src syn→det; emit FieldChangeEvent reason:'confirm-synthesized'
}

export declare const useCrmCasesStore: UseBoundStore<StoreApi<CrmCasesState>>;
export declare function getCrmCasesStore(): StoreApi<CrmCasesState>;

/** Pure module-level helpers (importable without instantiating the store). FR-007 */
export declare function computeSectionCompleteness(
  section: FactFindSection,
  requiredKeys: readonly string[]
): number;
export declare function computeCaseCompleteness(
  applicants: Applicant[]
): number;

// ─────────────────────────────────────────────────────────────────────────────
// documentsStore
// ─────────────────────────────────────────────────────────────────────────────

export interface CrmDocumentsState {
  documentsById: Record<DocumentId, unknown /* CrmDocument */>;
  checklistByOwner: Record<
    ClientId | 'joint',
    unknown[] /* DocChecklistItem[] */
  >;

  addDocument(doc: unknown /* CrmDocument */): void; // FR-023 — inserts PROCESSING when attribution null
  completeDocument(
    id: DocumentId,
    payload: { type: string; attribution: number; insights: unknown[] }
  ): void; // FR-023 — flip to COMPLETED
  confirmAttribution(id: DocumentId, opts: { confirmedBy: string }): void; // FR-024
  setChecklistStatus(
    owner: ClientId | 'joint',
    itemKey: string,
    status: 'received' | 'pending' | 'partial' | 'requested',
    opts?: { note?: string }
  ): void; // FR-025

  /**
   * FR-026: setting an insight's `conflict:true` DOES NOT auto-mutate any fact-find field here.
   * Cross-entity propagation is a selector concern in F01; real ingest is F07.
   */
}

export declare const useCrmDocumentsStore: UseBoundStore<
  StoreApi<CrmDocumentsState>
>;
export declare function getCrmDocumentsStore(): StoreApi<CrmDocumentsState>;

// ─────────────────────────────────────────────────────────────────────────────
// workstreamStore
// ─────────────────────────────────────────────────────────────────────────────

export interface StreamEntry {
  id: StreamId;
  caseId: CaseId;
  kind:
    | 'live'
    | 'intent'
    | 'approval'
    | 'conflict'
    | 'external'
    | 'done'
    | 'blocked'
    | 'activity'
    | 'directive';
  iconTone: string;
  when: EpochMs | string; // display; canonical timestamp on 'timestamp'
  title: string;
  body?: string;
  cta?: unknown;
  actions?: unknown[];
  pulse?: boolean;
  pinned?: boolean;
  trace?: unknown /* ReasoningTrace */;
  schemaVersion: number;
  origin?: Origin;
  /** Optional back-ref to a worklist item; if present, that item's status governs eviction eligibility. */
  linkedWorklistId?: WorklistId;
}

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
  reason:
    'edit' | 'confirm-synthesized' | 'conflict-resolution' | 'seed' | 'import';
  conflictId?: ConflictId;
  origin?: Origin;
  schemaVersion: number;
}

export interface CrmWorkstreamState {
  worklistItems: unknown[] /* WorklistItem[] */;
  streamByCase: Record<CaseId, StreamEntry[]>;
  activityByCase: Record<CaseId, unknown[] /* ActivityEvent[] */>;
  retentionEntries: unknown[] /* RetentionEntry[] */;
  fieldChangeEvents: FieldChangeEvent[];
  lastRepairReport: unknown | null /* RepairReport | null */;

  pushStreamEntry(
    caseId: CaseId,
    entry: Omit<StreamEntry, 'id' | 'schemaVersion'> & { id?: StreamId }
  ): void; // FR-028, FR-030 (cap + eviction rules)
  resolveWorklistItem(
    id: WorklistId,
    opts: { resolution: unknown; resolvedBy: string }
  ): void; // FR-027 — retained, never deleted; idempotent on already-resolved

  noteActivity(caseId: CaseId, activity: unknown /* ActivityEvent */): void; // FR-029
  upsertRetention(entry: unknown /* RetentionEntry */): void; // FR-031 — key: (clientId, endsAt)

  /** Append-only audit log. FR-034, FR-035 */
  appendFieldChangeEvent(
    event: Omit<FieldChangeEvent, 'id' | 'schemaVersion'>
  ): void;
  getFieldChangeEventsForField(
    caseId: CaseId,
    clientId: ClientId,
    section: FactFindSectionKey,
    fieldKey: string
  ): FieldChangeEvent[]; // asc changedAt
  getFieldChangeEventsForCase(caseId: CaseId): FieldChangeEvent[]; // asc changedAt

  getLastRepairReport(): unknown | null; // FR-037
}

export declare const useCrmWorkstreamStore: UseBoundStore<
  StoreApi<CrmWorkstreamState>
>;
export declare function getCrmWorkstreamStore(): StoreApi<CrmWorkstreamState>;

/** Named constant so tests + implementation share the ceiling. FR-030 */
export declare const STREAM_ENTRIES_PER_CASE_CAP: 200;

// ─────────────────────────────────────────────────────────────────────────────
// Cross-store orchestration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Atomic resolution across cases + documents + workstream stores. FR-020, User Story 2.
 *
 * Effects, all committed in a single setState per store (no partial-state observability):
 *   (a) field mutation via setFactFindField semantics with reason:'conflict-resolution'
 *   (b) ConflictRecord: resolvedAt / resolvedBy / resolution set; values[] preserved
 *   (c) linked document insight: conflict:true → conflict:false
 *   (d) linked worklist item: resolveWorklistItem (retained, not deleted)
 *   (e) StreamEntry kind:'done' with complete ReasoningTrace appended
 *   (f) FieldChangeEvent appended
 *   (g) affected FactFindSection.completeness recomputed
 *
 * Idempotent: a second call on the same conflict id is a no-op.
 */
export declare function resolveConflict(
  conflictId: ConflictId,
  opts: {
    chosenValue: FieldValue;
    method: 'confirm-value' | 'ask-client';
    resolvedBy: string;
    reasoning?: string;
  }
): void;

// ─────────────────────────────────────────────────────────────────────────────
// Money & ids (from src/crm/domain/money.ts + ids.ts)
// ─────────────────────────────────────────────────────────────────────────────

export declare function formatGbp(
  pence: Pence,
  opts?: { compact?: boolean }
): string;
export declare function parseGbp(input: string): Pence | null;
export declare function newCrmId(
  prefix:
    | 'client'
    | 'case'
    | 'doc'
    | 'insight'
    | 'wl'
    | 'stream'
    | 'event'
    | 'conflict'
): string;

// ─────────────────────────────────────────────────────────────────────────────
// Seed
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dev-gated. Idempotent — no-op if any of the four stores is non-empty. FR-046, User Story 1 acceptance #1, #2.
 * Writes all fixture records such that a subscriber sees only the fully-seeded state or the empty state.
 */
export declare function seedCrmGoldenPath(): void;
