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

// Frozen M2 — desktop-published per-case pointer index (no single mutable file).
export interface CaseIndexPointer {
  caseId: string;
  firmId: string;
  aionProjectId: string;
  stage: string;
  logHeadSeq: string /* decimal */;
  updatedAt: number;
}
/** Publish/refresh this case's pointer (append-only; latest-per-caseId derived at read). */
export declare function publishCasePointer(p: CaseIndexPointer): Promise<void>;
/** Read the firm's active case pointers (latest per caseId). Must be fetchable by an edge run too. */
export declare function readFirmIndex(
  firmId: string
): Promise<CaseIndexPointer[]>;
