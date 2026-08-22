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

// FR-010, D3/T3 — the firm's case index. NOT one mutable cases.json: the
// attachments plane has no If-Match or Idempotency-Key, so two desktops
// publishing at once would lose a write. Instead each case owns a pointer
// artifact `lm/firm/<firmId>/case/<caseId>.json`, published append-only into the
// firm coordinator Project. A re-publish mints the next VERSION of that name; a
// read takes the highest version per case, so concurrent publishes of DIFFERENT
// cases can never drop one and a republished case simply supersedes itself.
//
// The read is deliberately buildable by an edge run too (the watcher reads the
// index server-side): it is nothing but listArtifacts + an inline getArtifact,
// both of which a skill's own tool can call — no desktop-only accessor.

import { firmCoordinatorProject } from './caseProject';
import { encodeJsonAttachment } from './codec';
import { getAgentEdge } from './edge';
import type { CaseIndexPointer } from './types';

export type { CaseIndexPointer } from './types';

function firmIndexPrefix(firmId: string): string {
  return `lm/firm/${firmId}/case/`;
}

function casePointerName(firmId: string, caseId: string): string {
  return `${firmIndexPrefix(firmId)}${caseId}.json`;
}

function decodeCaseIndexPointer(value: unknown): CaseIndexPointer | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.caseId !== 'string' ||
    typeof row.firmId !== 'string' ||
    typeof row.aionProjectId !== 'string' ||
    typeof row.stage !== 'string' ||
    typeof row.logHeadSeq !== 'string' ||
    typeof row.updatedAt !== 'number'
  ) {
    return null;
  }
  return {
    caseId: row.caseId,
    firmId: row.firmId,
    aionProjectId: row.aionProjectId,
    stage: row.stage,
    logHeadSeq: row.logHeadSeq,
    updatedAt: row.updatedAt,
  };
}

/** Publish (or refresh) one case's pointer. Append-only — mints a new version. */
export async function publishCasePointer(p: CaseIndexPointer): Promise<void> {
  const edge = await getAgentEdge();
  const projectId = await firmCoordinatorProject(p.firmId);
  await edge.uploadAttachment(projectId, {
    name: casePointerName(p.firmId, p.caseId),
    media_type: 'application/json',
    data_base64: encodeJsonAttachment(p),
  });
}

/** The firm's active case pointers, latest version per case. */
export async function readFirmIndex(
  firmId: string
): Promise<CaseIndexPointer[]> {
  const edge = await getAgentEdge();
  const projectId = await firmCoordinatorProject(firmId);
  const prefix = firmIndexPrefix(firmId);

  // Highest published version wins per name — the append-only supersede rule.
  const latestByName = new Map<
    string,
    { version: number; artifactId: string }
  >();
  let pageToken: string | undefined;
  do {
    const page = await edge.listArtifacts(projectId, { pageToken });
    for (const artifact of page.artifacts ?? []) {
      if (!artifact.name.startsWith(prefix)) continue;
      const prior = latestByName.get(artifact.name);
      if (!prior || artifact.version > prior.version) {
        latestByName.set(artifact.name, {
          version: artifact.version,
          artifactId: artifact.artifact_id,
        });
      }
    }
    pageToken = page.next_page_token;
  } while (pageToken);

  const pointers: CaseIndexPointer[] = [];
  for (const { artifactId } of latestByName.values()) {
    const access = await edge.getArtifact(projectId, artifactId, {
      inline: true,
    });
    if (access.content_truncated === true || access.content === undefined) {
      continue;
    }
    const pointer = decodeCaseIndexPointer(JSON.parse(access.content));
    if (pointer) pointers.push(pointer);
  }
  return pointers;
}
