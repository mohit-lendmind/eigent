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

// Frozen M2 — the lendmind command seam. Directive rides as an application/json artifact.
import type { DirectiveEnvelope } from '../../002-mesh-m1-contracts-audit-spine/contracts/envelope';
export interface DispatchResult {
  commandId: string;
  runId: string;
  directiveArtifactId: string;
}
/** Publish envelope as an lm.directive/1 artifact (non-`aion-` name), submit referencing it. Fire-and-forget:
 *  resolves on admission; completion is observed via the fold + approval state, never awaited here. */
export declare function dispatchDirective(
  envelope: DirectiveEnvelope
): Promise<DispatchResult>;
export declare function ensureCaseProject(
  caseId: string
): Promise<string /* projectId */>;
export declare function firmCoordinatorProject(firmId: string): Promise<string>;
