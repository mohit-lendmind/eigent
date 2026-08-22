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

// FR-001/002, D1/D2 — the lendmind command seam. A DirectiveEnvelope is not a
// wire field: the aion command plane is generic, so the envelope is PUBLISHED
// as an application/json artifact (a non-`aion-` name the backend will accept)
// and the submitted command REFERENCES it by attachment id. The command's
// idempotency key is the directive's own identity, so a retried dispatch of the
// same envelope is admitted exactly once.
//
// Fire-and-forget (D2): this resolves the moment the command is ADMITTED, with
// the ids a caller needs to observe it. It never awaits the run — completion is
// read from the fold and the approval state, never blocked on here.

import {
  directiveIdentity,
  encodeDirectiveEnvelope,
  type DirectiveEnvelope,
} from '../agentContracts';
import { ensureCaseProject } from './caseProject';
import { encodeJsonAttachment } from './codec';
import { getAgentEdge } from './edge';
import type { DispatchResult } from './types';

export type { DispatchResult } from './types';

// The directive artifact's name. A per-case, identity-addressed path keeps it
// out of the `lm/case/` log namespace the fold reads, and re-publishing the
// same envelope lands the same bytes (CAS dedupe) under the same name.
function directiveArtifactName(caseId: string, identity: string): string {
  return `lm/directive/${caseId}/${identity}.json`;
}

/**
 * Publish `envelope` as an lm.directive/1 artifact and submit a command that
 * references it. Resolves on admission with the command/run ids and the
 * artifact id; the run itself is observed elsewhere.
 */
export async function dispatchDirective(
  envelope: DirectiveEnvelope
): Promise<DispatchResult> {
  const edge = await getAgentEdge();
  const projectId = await ensureCaseProject(envelope.caseId);
  const identity = await directiveIdentity(envelope);

  const artifact = await edge.uploadAttachment(projectId, {
    name: directiveArtifactName(envelope.caseId, identity),
    media_type: 'application/json',
    data_base64: encodeJsonAttachment(
      JSON.parse(encodeDirectiveEnvelope(envelope))
    ),
  });

  // command_id doubles as the edge's Idempotency-Key. Deriving it from the
  // directive identity (the nonce is inside) makes a retried dispatch of the
  // exact same envelope a single admitted command.
  const commandId = `cmd_${identity}`;
  const receipt = await edge.submitCommand(projectId, {
    command_id: commandId,
    text: envelope.directive,
    attachment_ids: [artifact.artifact_id],
  });

  return {
    commandId: receipt.command_id,
    runId: receipt.run_id,
    directiveArtifactId: artifact.artifact_id,
  };
}
