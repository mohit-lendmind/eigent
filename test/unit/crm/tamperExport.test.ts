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

// Journey 2 (SC-002) — tamper-evident export. A clean folded case exports with
// chainVerified true and its chain head stamped. Alter one entry and the export
// says so: chainVerified false, the fold names the exact broken seq with a
// CHAIN_BREAK item (distinct from a FOLD_GAP), and only the tampered case halts
// — a sibling case folds on untouched. The property sweep is the strong claim:
// flipping ANY single entry's content flips verification at exactly that seq.

import { clearAllCrmState, exportCaseFileV2 } from '@/crm';
import type { CaseLogEntry } from '@/crm/agentContracts/caseLog';
import { foldWorklistItemId } from '@/crm/agentContracts/reasonCodes';
import { c417Log } from '@/crm/fixtures/caselog/c417Log';
import { tamperedHash } from '@/crm/fixtures/caselog/negatives';
import { foldEntries, selectCaseHalt } from '@/crm/fold/caseLogFold';
import { verifyChain } from '@/crm/hashChain';
import { getCrmWorkstreamStore } from '@/crm/workstreamStore';
import { beforeEach, describe, expect, it } from 'vitest';

const CASE = 'c417';

function assertExported(
  result: Awaited<ReturnType<typeof exportCaseFileV2>>
): asserts result is Extract<typeof result, { envelope: unknown }> {
  if (!('envelope' in result)) throw new Error('export failed');
}

describe('Journey 2 — tamper-evident export v2 (SC-002)', () => {
  beforeEach(() => {
    clearAllCrmState();
  });

  it('a clean folded case exports verified with its chain head stamped', async () => {
    const log = await c417Log();
    await foldEntries(CASE, log);

    const result = await exportCaseFileV2(CASE, log);
    assertExported(result);

    expect(result.envelope.chainVerified).toBe(true);
    expect(result.envelope.chainHead?.seq).toBe(log[log.length - 1].seq);
    expect(result.envelope.artifactManifest).toHaveLength(log.length);
    expect(result.records.caseLogEntries).toHaveLength(log.length);
    // The gate-policy snapshot rides along for the reviewer (G1..G10).
    expect(result.envelope.gatePolicySnapshot.registry.length).toBeGreaterThan(
      0
    );
  });

  it('a tampered entry: chainVerified false, brokenAtSeq named, CHAIN_BREAK item, only that case halts', async () => {
    const { entries, brokenAtSeq } = await tamperedHash();

    // A sibling case folds a clean chain and must stay untouched.
    const clean = await c417Log();
    await foldEntries('csibling', clean);

    await foldEntries(CASE, entries);
    const result = await exportCaseFileV2(CASE, entries);
    assertExported(result);

    expect(result.envelope.chainVerified).toBe(false);

    const halt = selectCaseHalt(CASE);
    expect(halt).toEqual({ reasonCode: 'CHAIN_BREAK', atSeq: brokenAtSeq });
    expect(selectCaseHalt('csibling')).toBeNull();

    // The break raises exactly one deduplicated CHAIN_BREAK item, keyed
    // distinctly from a FOLD_GAP item at the same seq.
    const worklist = getCrmWorkstreamStore().getState().worklistItems;
    const breakId = foldWorklistItemId(CASE, 'CHAIN_BREAK', brokenAtSeq);
    const gapId = foldWorklistItemId(CASE, 'FOLD_GAP', brokenAtSeq);
    expect(worklist[breakId]).toBeDefined();
    expect(worklist[breakId].reasonCode).toBe('CHAIN_BREAK');
    expect(worklist[gapId]).toBeUndefined();
    expect(breakId).not.toBe(gapId);
  });

  it('property sweep — flipping any single entry breaks verification at that seq', async () => {
    const log = await c417Log();
    // A byte flipped in any entry's content leaves its stored hash stale, so the
    // recompute fails exactly there.
    for (let i = 0; i < log.length; i++) {
      const mutated: CaseLogEntry[] = log.map((e, j) =>
        j === i
          ? {
              ...e,
              event: {
                ...e.event,
                payload: { ...e.event.payload, __tamper: i },
              },
            }
          : e
      );
      const verify = await verifyChain(mutated);
      expect(verify.ok).toBe(false);
      if (!verify.ok) {
        expect(verify.brokenAtSeq).toBe(log[i].seq);
      }
    }
  });
});
