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

// Fixture-builder: stamp a run of drafts into a valid per-case chain the way
// the writer would — seq counting from "1" as decimal strings, prevHash linking
// to the predecessor's hash ('genesis' at the head), and hash = the content
// hash of the fully-stamped entry. Async because hashing is WebCrypto, so
// golden fixtures are built once at authoring time and awaited by their tests.

import type { CaseLogEntry } from '../../agentContracts/caseLog';
import { computeEntryHash } from '../../hashChain';

// Everything the writer fills in; seq/prevHash/hash are the chain position it
// assigns, so a draft is an entry minus exactly those three.
export type CaseLogEntryDraft = Omit<CaseLogEntry, 'seq' | 'prevHash' | 'hash'>;

export interface BuildChainOptions {
  /** First seq to assign (default 1 — a genesis-rooted chain). */
  startSeq?: number;
  /** prevHash for the first entry (default 'genesis'). */
  startPrevHash?: string;
}

export async function buildChain(
  drafts: readonly CaseLogEntryDraft[],
  options: BuildChainOptions = {}
): Promise<CaseLogEntry[]> {
  const { startSeq = 1, startPrevHash = 'genesis' } = options;
  const out: CaseLogEntry[] = [];
  let prevHash = startPrevHash;
  let seq = BigInt(startSeq);
  for (const draft of drafts) {
    const stamped = {
      ...draft,
      seq: seq.toString(),
      prevHash,
      hash: '',
    } as CaseLogEntry;
    stamped.hash = await computeEntryHash(stamped);
    out.push(stamped);
    prevHash = stamped.hash;
    seq += 1n;
  }
  return out;
}
