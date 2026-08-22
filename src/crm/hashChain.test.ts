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

import { describe, expect, it } from 'vitest';
import { buildChain } from './fixtures/caselog/buildChain';
import { c417Drafts, c417Log } from './fixtures/caselog/c417Log';
import { tamperedHash } from './fixtures/caselog/negatives';
import {
  computeEntryHash,
  settleHashOf,
  sha256HexCanonical,
  verifyChain,
} from './hashChain';

describe('sha256HexCanonical', () => {
  it('is a 64-hex-char digest independent of key order', async () => {
    const a = await sha256HexCanonical({ x: 1, y: { b: 2, a: 3 } });
    const b = await sha256HexCanonical({ y: { a: 3, b: 2 }, x: 1 });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when any value changes', async () => {
    const a = await sha256HexCanonical({ x: 1 });
    const b = await sha256HexCanonical({ x: 2 });
    expect(a).not.toBe(b);
  });
});

describe('verifyChain', () => {
  it('accepts the golden chain', async () => {
    const log = await c417Log();
    expect(await verifyChain(log)).toEqual({ ok: true });
  });

  it('is order-independent — a shuffled delivery still verifies', async () => {
    const log = await c417Log();
    const shuffled = [...log].reverse();
    expect(await verifyChain(shuffled)).toEqual({ ok: true });
  });

  it('reports the exact broken seq when a byte is tampered', async () => {
    const { entries, brokenAtSeq } = await tamperedHash();
    expect(await verifyChain(entries)).toEqual({ ok: false, brokenAtSeq });
  });

  it('reports a break when prevHash linkage is severed', async () => {
    const log = await c417Log();
    const broken = log.map((entry, index) =>
      index === 5 ? { ...entry, prevHash: 'wrong' } : entry
    );
    expect(await verifyChain(broken)).toEqual({
      ok: false,
      brokenAtSeq: log[5].seq,
    });
  });
});

describe('settleHashOf', () => {
  it('matches between a pre-chain candidate and the writer-stamped echo', async () => {
    // The candidate is a draft (no seq/prevHash/hash); the echo is the same
    // draft after the writer stamped chain position. Their settle hashes agree.
    const [echo] = await buildChain([c417Drafts[0]]);
    const candidateSettle = await settleHashOf(c417Drafts[0]);
    const echoSettle = await settleHashOf(echo);
    expect(candidateSettle).toBe(echoSettle);
  });

  it('is stable regardless of the chain position later assigned', async () => {
    const here = await buildChain([c417Drafts[0]], { startSeq: 1 });
    const there = await buildChain([c417Drafts[0]], {
      startSeq: 99,
      startPrevHash: 'somewhere',
    });
    expect(await settleHashOf(here[0])).toBe(await settleHashOf(there[0]));
  });
});

describe('computeEntryHash', () => {
  it('equals the stored hash for a well-formed entry', async () => {
    const log = await c417Log();
    for (const entry of log) {
      expect(await computeEntryHash(entry)).toBe(entry.hash);
    }
  });
});
