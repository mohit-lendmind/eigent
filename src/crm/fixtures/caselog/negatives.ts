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

// The adversarial fixtures — one per way a real case-log can arrive wrong. Each
// builder yields a delivery sequence plus the exact fact a test/fold should
// observe (the seq that breaks, quarantines, duplicates, or is oversize), so
// assertions pin behaviour to a coordinate rather than a vibe. The base is the
// first slice of the genuine golden drafts so the negatives ride real content.

import type {
  CaseLogActorKind,
  CaseLogEntry,
  CaseLogEventKind,
} from '../../agentContracts/caseLog';
import { encodeCaseLogEntry } from '../../agentContracts/caseLog';
import type { ActivityEvent, StreamEntry } from '../../domain/types';
import { CRM_SCHEMA_VERSION } from '../../domain/types';
import { buildChain, type CaseLogEntryDraft } from './buildChain';
import { c417Drafts } from './c417Log';

const FIRM = 'firm-lm';
const CASE = 'c417';
const RUN = 'run-neg';
const VERSIONS = {
  model: 'claude-neg',
  promptSha: 'prompt-neg',
  skillSemver: '1.0.0',
  skillSha: 'skill-neg',
} as const;
const NEG_T0 = Date.UTC(2026, 3, 1, 0, 0, 0);

function mkDraft(
  step: number,
  type: CaseLogEventKind,
  payload: Record<string, unknown>,
  actor: { kind: CaseLogActorKind; id: string } = { kind: 'agent', id: 'f07' }
): CaseLogEntryDraft {
  return {
    kind: 'lm.caselog/1',
    caseId: CASE,
    firmId: FIRM,
    at: NEG_T0 + step * 60_000,
    actor,
    event: { type, payload },
    origin: { artifactId: `neg-${type}-${step}`, runId: RUN },
    versions: { ...VERSIONS },
  };
}

function negActivity(id: string, when: number): ActivityEvent {
  return {
    id,
    caseId: CASE,
    kind: 'note',
    title: id,
    when,
    schemaVersion: CRM_SCHEMA_VERSION,
  };
}

function negStream(id: string, when: number, body?: string): StreamEntry {
  return {
    id,
    caseId: CASE,
    kind: 'activity',
    iconTone: 'muted',
    when,
    title: id,
    ...(body !== undefined ? { body } : {}),
    schemaVersion: CRM_SCHEMA_VERSION,
  };
}

/** A short, genuinely valid base chain reused across the negatives. */
function baseChain(): Promise<CaseLogEntry[]> {
  return buildChain(c417Drafts.slice(0, 8));
}

// ---- Out-of-order arrival --------------------------------------------------
// A valid chain delivered scrambled: seq 3–5 land after 1–2 but before each
// other in the wrong sequence. The fold must buffer-ahead and still converge.
export async function outOfOrderArrival(): Promise<CaseLogEntry[]> {
  const chain = await baseChain();
  const order = [0, 1, 3, 5, 2, 4, 6, 7];
  return order.map((i) => chain[i]).filter(Boolean);
}

// ---- Unknown event member (quarantine, never throw) ------------------------
// A well-formed, correctly-chained entry whose event.type is a member no build
// of this app knows. It decodes fine (open set) and the fold quarantines it.
export interface UnknownKindFixture {
  entries: CaseLogEntry[];
  quarantinedSeq: string;
  kindSeen: string;
}
export async function unknownEventKind(): Promise<UnknownKindFixture> {
  const base = await baseChain();
  const last = base[base.length - 1];
  const kindSeen = 'speculative-projection/9';
  const extra = await buildChain(
    [mkDraft(1, kindSeen, { note: 'future agent' })],
    {
      startSeq: base.length + 1,
      startPrevHash: last.hash,
    }
  );
  return {
    entries: [...base, ...extra],
    quarantinedSeq: extra[0].seq,
    kindSeen,
  };
}

// ---- Tampered hash ---------------------------------------------------------
// One entry's payload is altered but its stored hash is left stale, so the
// content-hash recompute fails exactly at that seq (prevHash linkage is intact,
// isolating the failure to the content check).
export interface TamperedFixture {
  entries: CaseLogEntry[];
  brokenAtSeq: string;
}
export async function tamperedHash(): Promise<TamperedFixture> {
  const chain = await baseChain();
  const idx = 3;
  const target = chain[idx];
  const tampered = {
    ...target,
    event: {
      ...target.event,
      payload: { ...target.event.payload, injected: 'tamper' },
    },
  } as CaseLogEntry;
  const out = [...chain];
  out[idx] = tampered;
  return { entries: out, brokenAtSeq: target.seq };
}

// ---- Oversize entry --------------------------------------------------------
// A valid, correctly-chained entry whose encoded size is deliberately huge. The
// fold refuses it as ENTRY_TOO_LARGE; verifyChain still passes (it is a real
// link). `bytes` is measured the way the fold measures — encoded length.
export const OVERSIZE_BODY_CHARS = 200_000;
export interface OversizeFixture {
  entries: CaseLogEntry[];
  oversizeSeq: string;
  bytes: number;
}
export async function oversizeEntry(): Promise<OversizeFixture> {
  const base = await baseChain();
  const last = base[base.length - 1];
  const body = 'x'.repeat(OVERSIZE_BODY_CHARS);
  const extra = await buildChain(
    [mkDraft(1, 'stream-entry', { entry: negStream('st-huge', NEG_T0, body) })],
    { startSeq: base.length + 1, startPrevHash: last.hash }
  );
  return {
    entries: [...base, ...extra],
    oversizeSeq: extra[0].seq,
    bytes: encodeCaseLogEntry(extra[0]).length,
  };
}

// ---- Duplicate seq ---------------------------------------------------------
// The same seq arrives twice with different content. First-wins: the fold keeps
// the entry it already applied and records the second as a DUPLICATE_SEQ
// anomaly rather than re-applying or breaking.
export interface DuplicateSeqFixture {
  entries: CaseLogEntry[];
  duplicatedSeq: string;
}
export async function duplicateSeq(): Promise<DuplicateSeqFixture> {
  const chain = await baseChain();
  const dupOf = chain[2];
  const conflicting = await buildChain(
    [mkDraft(1, 'activity', { activity: negActivity('ac-dup', NEG_T0) })],
    { startSeq: Number(dupOf.seq), startPrevHash: dupOf.prevHash }
  );
  return {
    entries: [...chain, conflicting[0]],
    duplicatedSeq: dupOf.seq,
  };
}
