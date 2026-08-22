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

// Tamper-evident content-hash chain over case-log entries — the audit
// primitive. Hashing is hex sha256 over the canonicalised (recursive
// key-sorted) JSON, matching the edge's own content_hash convention. WebCrypto
// (crypto.subtle) is the platform primitive in renderer, web build, and
// vitest's Node global; a canary in test/setup.ts guards the last of these.

import type { CaseLogEntry, DecimalSeq } from './agentContracts/caseLog';
import { canonicalise } from './caseFile';

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/** Hex sha256 of the canonicalised value — the dedup/tamper key. */
export async function sha256HexCanonical(value: unknown): Promise<string> {
  const canonical = JSON.stringify(canonicalise(value));
  const digest = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(canonical)
  );
  return toHex(digest);
}

function withoutKeys<T extends Record<string, unknown>>(
  entry: T,
  keys: readonly string[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const drop = new Set(keys);
  for (const key of Object.keys(entry)) {
    if (!drop.has(key)) out[key] = entry[key];
  }
  return out;
}

/** Full-entry hash: sha256HexCanonical(entry − {hash}) (FR-016). */
export function computeEntryHash(entry: CaseLogEntry): Promise<string> {
  return sha256HexCanonical(withoutKeys(entry, ['hash']));
}

/**
 * Settle hash: sha256HexCanonical(entry − {seq, prevHash, hash}). Reproducible
 * before the writer assigns chain position, so the desktop candidate and the
 * canonical echo hash to the same value (FR-017).
 */
export function settleHashOf(
  entry: Omit<CaseLogEntry, 'seq' | 'prevHash' | 'hash'>
): Promise<string> {
  return sha256HexCanonical(
    withoutKeys(entry as Record<string, unknown>, ['seq', 'prevHash', 'hash'])
  );
}

/**
 * Verifies both linkages of a per-case chain, entries taken in ascending seq:
 * (1) each entry's stored `hash` equals its recomputed content hash, and
 * (2) each `prevHash` equals the predecessor's `hash` ('genesis' at the head).
 * Returns the exact seq where the chain first breaks.
 */
export async function verifyChain(
  entries: readonly CaseLogEntry[]
): Promise<{ ok: true } | { ok: false; brokenAtSeq: DecimalSeq }> {
  const ordered = [...entries].sort((a, b) =>
    BigInt(a.seq) < BigInt(b.seq) ? -1 : BigInt(a.seq) > BigInt(b.seq) ? 1 : 0
  );
  let expectedPrev = 'genesis';
  for (const entry of ordered) {
    if (entry.prevHash !== expectedPrev) {
      return { ok: false, brokenAtSeq: entry.seq };
    }
    const recomputed = await computeEntryHash(entry);
    if (recomputed !== entry.hash) {
      return { ok: false, brokenAtSeq: entry.seq };
    }
    expectedPrev = entry.hash;
  }
  return { ok: true };
}
