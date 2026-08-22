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

// Frozen M1 contract — CaseFileExport v2 (FR-021). v1 shape unchanged, see src/crm/domain/types.ts.
import type { CaseId, CaseLogEntry, DecimalSeq } from './caseLog';
import type { GateDescriptor } from './gates';

export interface CaseFileExportEnvelopeV2 {
  exportVersion: 2;
  exportedAt: number;
  crmSchemaVersion: number;
  contractsVersion: number;
  caseId: CaseId;
  firmId: string;
  chainHead: { seq: DecimalSeq; hash: string } | null;
  chainVerified: boolean;
  artifactManifest: readonly {
    name: string;
    artifactId: string;
    version: number;
    sha256: string;
  }[];
  gatePolicySnapshot: {
    registry: readonly GateDescriptor[];
    delegationRoster: readonly unknown[];
  };
  versionsStamp: Record<string, string>;
}

export interface CaseFileExportV2 {
  envelope: CaseFileExportEnvelopeV2;
  records: Record<string, unknown> & {
    caseLogEntries: readonly CaseLogEntry[];
    outboxUnflushed: readonly unknown[];
    quarantine: readonly unknown[];
    quarantineTombstones: readonly { hash: string; kind: string; at: number }[];
  };
}

/** Import accepts v1 (integrity null — "not verifiable") and v2 (chain verified before trusting the flag). */
export declare function importCaseFile(
  bundle: unknown
):
  | {
      ok: true;
      imported: Record<string, number>;
      chainVerified: boolean | null;
    }
  | { ok: false; reason: string };
