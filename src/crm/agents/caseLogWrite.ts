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

// The case-log writer. Each domain event becomes one `lm/case/<caseId>/<seq>`
// artifact, chained: seq climbs from the current head, prevHash links to the
// predecessor's hash ('genesis' at the head of a fresh case), and hash is the
// content hash of the entry minus its own hash field. verifyChain (hashChain.ts)
// reads this exact shape, so an appended run is tamper-evident end to end.

import {
  encodeCaseLogEntry,
  type CaseLogActorKind,
  type CaseLogEntry,
  type CaseLogEvent,
  type VersionStamp,
} from '../agentContracts';
import { computeEntryHash } from '../hashChain';
import { readCaseLogHead } from './caseLogHead';
import { encodeJsonAttachment } from './codec';
import type { AgentEdge } from './edge';

function caseLogEntryName(caseId: string, seq: string): string {
  return `lm/case/${caseId}/${seq}`;
}

export interface CaseLogAppend {
  caseId: string;
  firmId: string;
  actor: { kind: CaseLogActorKind; id: string };
  events: CaseLogEvent[];
  versions: VersionStamp;
  originArtifactId: string;
  runId: string;
  at: number;
}

export interface CaseLogWriteResult {
  entries: CaseLogEntry[];
  headSeq: string;
  headHash: string;
}

/**
 * Append `events` to a case's log as chained entries, one artifact per entry.
 * Resolves with the written entries and the new head. Sequential by design —
 * each entry's prevHash needs the prior entry's hash.
 */
export async function appendCaseLog(
  edge: AgentEdge,
  projectId: string,
  append: CaseLogAppend
): Promise<CaseLogWriteResult> {
  const head = await readCaseLogHead(edge, projectId, append.caseId);
  let prevHash = head ? head.entry.hash : 'genesis';
  let seq = head ? BigInt(head.seq) : 0n;

  const written: CaseLogEntry[] = [];
  for (const event of append.events) {
    seq += 1n;
    // hash is computed over the entry minus its own hash field, so the '' seed
    // never enters the digest (computeEntryHash drops it before hashing).
    const entry: CaseLogEntry = {
      kind: 'lm.caselog/1',
      caseId: append.caseId,
      firmId: append.firmId,
      seq: seq.toString(),
      at: append.at,
      actor: append.actor,
      event,
      origin: { artifactId: append.originArtifactId, runId: append.runId },
      versions: append.versions,
      prevHash,
      hash: '',
    };
    entry.hash = await computeEntryHash(entry);
    await edge.uploadAttachment(projectId, {
      name: caseLogEntryName(append.caseId, entry.seq),
      media_type: 'application/json',
      data_base64: encodeJsonAttachment(JSON.parse(encodeCaseLogEntry(entry))),
    });
    written.push(entry);
    prevHash = entry.hash;
  }

  return {
    entries: written,
    headSeq: seq.toString(),
    headHash: prevHash,
  };
}
