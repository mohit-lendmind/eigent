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
 * Contract: pure cross-store selector signatures. FR-042, FR-043.
 * Path in implementation: src/crm/selectors.ts
 *
 * All selectors are pure functions. They return the shared EMPTY_ARRAY / EMPTY_MAP
 * constants (not fresh instances) so React consumers in F02+ do not re-render on
 * empty-to-empty transitions.
 */

import type {
  Applicant,
  CaseId,
  ClientId,
  ConflictRecord,
  StreamEntry,
  WorklistId,
} from './stores';

/** Shared empty singletons. FR-043 */
export declare const EMPTY_ARRAY: readonly [];
export declare const EMPTY_MAP: ReadonlyMap<unknown, unknown>;

// ─────────────────────────────────────────────────────────────────────────────
// Worklist
// ─────────────────────────────────────────────────────────────────────────────

export interface NeedsYouItem {
  id: WorklistId;
  caseId: CaseId;
  kind:
    'conflict' | 'criteria' | 'doc' | 'approval' | 'retention' | 'signature';
  title: string;
  detail?: string;
  linkedConflictId?: string;
  linkedDocId?: string;
  createdAt: number;
}

export declare function selectNeedsYou(
  worklist: readonly unknown[]
): readonly NeedsYouItem[];
export declare function selectNeedsYouCount(
  worklist: readonly unknown[]
): number;

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline
// ─────────────────────────────────────────────────────────────────────────────

export interface PipelineCounts {
  LEAD: number;
  FACT_FIND: number;
  SOURCING: number;
  DIP: number;
  APPLICATION: number;
  VALUATION: number;
  OFFER: number;
  COMPLETION: number;
  /** Sum of stage buckets. Included so consumers don't recompute. */
  total: number;
}

export declare function selectPipelineCounts(
  cases: Record<CaseId, unknown>
): PipelineCounts;

// ─────────────────────────────────────────────────────────────────────────────
// Conflicts
// ─────────────────────────────────────────────────────────────────────────────

export declare function selectOpenConflicts(
  casesState: unknown /* CrmCasesState */
): readonly ConflictRecord[];

// ─────────────────────────────────────────────────────────────────────────────
// Retention urgency (<90 days = urgent). FR-042
// ─────────────────────────────────────────────────────────────────────────────

export interface RetentionUrgency {
  entryClientId: ClientId;
  ref: string;
  endsAt: number;
  daysLeft: number;
  lender: string;
  rate: string;
  status: 'case-open' | 'due' | 'horizon';
  urgent: boolean; // daysLeft < 90
}

export declare function selectRetentionUrgency(
  entries: readonly unknown[],
  now: number
): readonly RetentionUrgency[];

// ─────────────────────────────────────────────────────────────────────────────
// Case stream — ordered 4-section grouping for the case view. FR-042
// ─────────────────────────────────────────────────────────────────────────────

export interface CaseStreamSections {
  live: readonly StreamEntry[];
  needsYou: readonly StreamEntry[];
  directives: readonly StreamEntry[];
  activity: readonly StreamEntry[];
}

export declare function selectCaseStreamSections(
  entries: readonly StreamEntry[]
): CaseStreamSections;

// ─────────────────────────────────────────────────────────────────────────────
// det/syn/awaiting counts per applicant. FR-042
// ─────────────────────────────────────────────────────────────────────────────

export interface DetSynCounts {
  det: number; // fields with src:'det'
  syn: number; // fields with src:'syn'
  awaiting: number; // fields present but with empty/placeholder value
}

export declare function selectDetSynCounts(applicant: Applicant): DetSynCounts;

// ─────────────────────────────────────────────────────────────────────────────
// Case completeness — reads across cases + applicants
// ─────────────────────────────────────────────────────────────────────────────

export declare function selectCaseCompleteness(
  caseId: CaseId,
  state?: unknown
): number;
