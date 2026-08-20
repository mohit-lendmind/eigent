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
 * Contract: export / import / wipe. FR-039, FR-040, FR-041.
 * Path in implementation: src/crm/caseFile.ts
 */

import type {
  Applicant,
  Case,
  CaseId,
  Client,
  ConflictRecord,
  FieldChangeEvent,
  StreamEntry,
} from './stores';

/** Bump only when the serialized shape changes incompatibly. Current: 1. FR-040 */
export type CaseFileExportVersion = 1;

export interface CaseFileExport {
  envelope: {
    exportVersion: CaseFileExportVersion;
    exportedAt: number;
    crmSchemaVersion: number;
    caseId: CaseId;
  };
  records: {
    case: Case;
    clients: Client[]; // includes every ClientId referenced by any record below (deep)
    applicants: Applicant[]; // == case.applicants — inlined for convenience of downstream tooling
    documents: unknown[] /* CrmDocument[] */; // documents attributed to either applicant
    checklist: unknown /* DocChecklistItem[] indexed by owner */;
    worklist: unknown[] /* WorklistItem[] scoped to the case */;
    stream: StreamEntry[]; // full traces preserved verbatim
    activity: unknown[] /* ActivityEvent[] */;
    criteria: unknown[] /* CriterionCheck[] */;
    products: unknown[] /* Product[] — both universes as they were considered */;
    retention: unknown[] /* RetentionEntry[] for referenced clients */;
    compliance: unknown /* ComplianceRecord | undefined */;
    conflicts: ConflictRecord[]; // both open and resolved; both values retained
    fieldChangeEvents: FieldChangeEvent[]; // EVERY event for this case, no exceptions
  };
}

/** Returns a `CaseFileExport` for a known case, or a typed refusal. FR-040 */
export declare function exportCaseFile(
  caseId: CaseId
): CaseFileExport | { ok: false; reason: 'unknown_case' };

/**
 * Rehydrates records into the current stores.
 *
 * exportVersion 1 REFUSES to overwrite existing records — collision returns a typed refusal
 * with the colliding ids. Callers wipe first (`clearAllCrmState()`) then import. FR-041.
 */
export declare function importCaseFile(
  fileExport: CaseFileExport
):
  | {
      ok: true;
      imported: {
        cases: number;
        clients: number;
        documents: number;
        workstream: number;
      };
    }
  | { ok: false; reason: 'id_collision'; ids: string[] }
  | { ok: false; reason: 'envelope_version_unsupported'; version: number }
  | {
      ok: false;
      reason: 'schema_version_incompatible';
      got: number;
      expected: number;
    };

/**
 * Empties all four in-memory stores AND removes their four `crm-*-store` localStorage keys.
 * MUST NOT touch any non-CRM key. FR-039.
 */
export declare function clearAllCrmState(): void;
