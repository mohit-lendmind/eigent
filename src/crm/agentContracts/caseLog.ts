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

// CaseLogEntry (lm.caselog/1): the unit of audit. The event `type` is an OPEN
// set — an unknown member decodes fine (it is retained verbatim) so the fold
// can quarantine it rather than throw or drop (FR-003). The chain fields
// (seq/prevHash/hash) are writer-assigned; decode validates their presence,
// hashChain.ts owns their computation and verification.

import {
  asRecord,
  ContractDecodeError,
  requireNumber,
  requireString,
} from './errors';

export type CaseId = string;
export type DecimalSeq = string; // 64-bit-safe decimal string; compare via BigInt

export type CaseLogActorKind =
  'adviser' | 'agent' | 'watcher' | 'schedule' | 'system' | (string & {});

export type CaseLogEventKind =
  | 'field-change'
  | 'activity'
  | 'stream-entry'
  | 'worklist-upsert'
  | 'worklist-resolve'
  | 'conflict-upsert'
  | 'conflict-resolve'
  | 'checklist-status'
  | 'stage-transition'
  | 'case-upsert'
  | 'client-upsert'
  | 'document-upsert'
  | 'chain-anchor' // reserved (T3): writer-side chain re-base; fold applies as no-op re-base
  | (string & {}); // unknown members quarantine, never throw

export interface CaseLogEvent extends Record<string, unknown> {
  type: CaseLogEventKind;
  payload: Record<string, unknown>;
}

export interface CaseLogEntry extends Record<string, unknown> {
  kind: 'lm.caselog/1';
  caseId: CaseId;
  firmId: string;
  seq: DecimalSeq;
  at: number;
  actor: { kind: CaseLogActorKind; id: string };
  event: CaseLogEvent;
  origin: { artifactId: string; runId: string };
  versions: {
    model: string;
    promptSha: string;
    skillSemver: string;
    skillSha: string;
  };
  prevHash: string;
  hash: string;
}

// The 12 F01-write-path members plus the reserved chain-anchor. NOT a decode
// gate (the union is open) — used by the fold to decide apply-vs-quarantine.
export const KNOWN_CASELOG_EVENT_KINDS: readonly CaseLogEventKind[] = [
  'field-change',
  'activity',
  'stream-entry',
  'worklist-upsert',
  'worklist-resolve',
  'conflict-upsert',
  'conflict-resolve',
  'checklist-status',
  'stage-transition',
  'case-upsert',
  'client-upsert',
  'document-upsert',
  'chain-anchor',
];

const knownEventKinds = new Set<string>(
  KNOWN_CASELOG_EVENT_KINDS as readonly string[]
);

export function isKnownCaseLogEventKind(
  type: string
): type is Exclude<CaseLogEventKind, string & {}> {
  return knownEventKinds.has(type);
}

function decodeSeq(value: unknown, label: string): DecimalSeq {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ContractDecodeError(label, 'must be a decimal-string seq', value);
  }
  try {
    BigInt(value);
  } catch {
    throw new ContractDecodeError(
      label,
      'must be parseable as a decimal integer',
      value
    );
  }
  return value;
}

export function decodeCaseLogEntry(value: unknown): CaseLogEntry {
  const object = asRecord(value, 'CaseLogEntry');
  if (object.kind !== 'lm.caselog/1') {
    throw new ContractDecodeError(
      'CaseLogEntry.kind',
      "must be 'lm.caselog/1'",
      object.kind
    );
  }
  requireString(object, 'CaseLogEntry', 'caseId');
  requireString(object, 'CaseLogEntry', 'firmId');
  decodeSeq(object.seq, 'CaseLogEntry.seq');
  requireNumber(object, 'CaseLogEntry', 'at');
  requireString(object, 'CaseLogEntry', 'prevHash');
  requireString(object, 'CaseLogEntry', 'hash');

  const actor = asRecord(object.actor, 'CaseLogEntry.actor');
  requireString(actor, 'CaseLogEntry.actor', 'kind');
  requireString(actor, 'CaseLogEntry.actor', 'id');

  const event = asRecord(object.event, 'CaseLogEntry.event');
  requireString(event, 'CaseLogEntry.event', 'type');
  asRecord(event.payload, 'CaseLogEntry.event.payload');

  const origin = asRecord(object.origin, 'CaseLogEntry.origin');
  requireString(origin, 'CaseLogEntry.origin', 'artifactId');
  if (typeof origin.runId !== 'string') {
    throw new ContractDecodeError(
      'CaseLogEntry.origin.runId',
      'must be a string',
      origin.runId
    );
  }

  const versions = asRecord(object.versions, 'CaseLogEntry.versions');
  requireString(versions, 'CaseLogEntry.versions', 'model');
  requireString(versions, 'CaseLogEntry.versions', 'promptSha');
  requireString(versions, 'CaseLogEntry.versions', 'skillSemver');
  requireString(versions, 'CaseLogEntry.versions', 'skillSha');

  return { ...object } as CaseLogEntry;
}

export function encodeCaseLogEntry(entry: CaseLogEntry): string {
  return JSON.stringify(entry);
}

// The chain primitives live in hashChain.ts (WebCrypto over canonicalise); the
// frozen contract groups them under caseLog, so re-export to match the surface.
export { settleHashOf, verifyChain } from '../hashChain';
