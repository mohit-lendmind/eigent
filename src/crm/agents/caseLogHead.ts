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

// FR-006 — reading a case log's head with ONLY the edge primitives a run also
// has. The desktop reads its case log through the aionArtifactsStore wrappers,
// but those are renderer-only; the watcher runs server-side, where the only
// tools are the same listArtifacts + inline getArtifact a skill can call. This
// module reads the head (highest seq) through exactly those two calls and
// nothing else — which is what makes the watcher's reads provably run-portable
// (see edgeReadsIndex.test.ts).

import { decodeCaseLogEntry, type CaseLogEntry } from '../agentContracts';
import type { AgentEdge } from './edge';

// Case-log entries are published one artifact per entry, named
// `lm/case/<caseId>/<seq>` (see caseFile export). The head is the largest seq.
function caseLogPrefix(caseId: string): string {
  return `lm/case/${caseId}/`;
}

function seqFromName(name: string, prefix: string): string | null {
  if (!name.startsWith(prefix)) return null;
  const suffix = name.slice(prefix.length);
  // A seq is a non-negative decimal string; anything else is not a log entry.
  return /^\d+$/.test(suffix) ? suffix : null;
}

// Decimal-string compare without floating a 64-bit seq: longer wins, else lex.
function seqGreater(a: string, b: string): boolean {
  if (a.length !== b.length) return a.length > b.length;
  return a > b;
}

export interface CaseLogHead {
  seq: string;
  entry: CaseLogEntry;
}

/**
 * The head sequence of a case's log, or null when the case has none published.
 * Uses only listArtifacts + inline getArtifact, so a server-side run computes
 * the same answer the desktop would.
 */
export async function readCaseLogHead(
  edge: AgentEdge,
  projectId: string,
  caseId: string
): Promise<CaseLogHead | null> {
  const prefix = caseLogPrefix(caseId);
  let headSeq: string | null = null;
  let headArtifactId: string | null = null;
  let headVersion = -1;

  let pageToken: string | undefined;
  do {
    const page = await edge.listArtifacts(projectId, { pageToken });
    for (const artifact of page.artifacts ?? []) {
      const seq = seqFromName(artifact.name, prefix);
      if (seq === null) continue;
      // A seq can be republished (a new version of the same name); take the
      // highest seq, and within a seq the highest version.
      const isHead =
        headSeq === null ||
        seqGreater(seq, headSeq) ||
        (seq === headSeq && artifact.version > headVersion);
      if (isHead) {
        headSeq = seq;
        headArtifactId = artifact.artifact_id;
        headVersion = artifact.version;
      }
    }
    pageToken = page.next_page_token;
  } while (pageToken);

  if (headSeq === null || headArtifactId === null) return null;

  const access = await edge.getArtifact(projectId, headArtifactId, {
    inline: true,
  });
  if (access.content_truncated === true || access.content === undefined) {
    return null;
  }
  return {
    seq: headSeq,
    entry: decodeCaseLogEntry(JSON.parse(access.content)),
  };
}
