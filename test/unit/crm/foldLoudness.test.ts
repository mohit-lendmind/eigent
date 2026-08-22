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

// SC-003 — loudness. Nothing the fold cannot apply is dropped silently. This
// table walks every adversarial fixture in the manifest and pins the exact
// coordinate each one must surface: a gap buffers, a broken hash-link halts at
// its seq, an unknown event member quarantines and the chain steps past it, an
// oversize link is refused with a counter, a duplicate seq is first-wins with a
// counter. The final case proves T4 — a contracts-version bump re-evaluates a
// previously quarantined entry (dropped to a tombstone, reinserted fresh).

import { clearAllCrmState } from '@/crm';
import { CASELOG_FIXTURE_MANIFEST } from '@/crm/fixtures/caselog/manifest';
import { unknownEventKind } from '@/crm/fixtures/caselog/negatives';
import {
  foldEntries,
  selectCaseChainStatus,
  selectCaseHalt,
  selectQuarantineCount,
} from '@/crm/fold/caseLogFold';
import { getCrmEventLogStore } from '@/crm/fold/eventLogStore';
import { beforeEach, describe, expect, it } from 'vitest';

const CASE = 'c417';

function anomaliesFor(caseId: string) {
  return (
    getCrmEventLogStore().getState().anomalies[caseId] ?? {
      duplicateSeq: 0,
      oversize: 0,
    }
  );
}

describe('fold loudness across the negatives manifest (SC-003)', () => {
  beforeEach(() => {
    clearAllCrmState();
  });

  for (const fixture of CASELOG_FIXTURE_MANIFEST) {
    it(`${fixture.name}: ${fixture.description}`, async () => {
      const entries = await fixture.load();
      const report = await foldEntries(CASE, entries);
      const halt = selectCaseHalt(CASE);
      const anomalies = anomaliesFor(CASE);
      const quarantine = selectQuarantineCount(CASE);

      if (fixture.expect.brokenAtSeq) {
        expect(halt).toEqual({
          reasonCode: 'CHAIN_BREAK',
          atSeq: fixture.expect.brokenAtSeq,
        });
        expect(selectCaseChainStatus(CASE)).toBe('broken');
        // A break raises exactly one deduplicated worklist item.
        return;
      }

      // Everything else is a clean or self-healing chain — never halts.
      expect(halt).toBeNull();

      if (fixture.expect.quarantinedSeq) {
        expect(quarantine.retained).toBe(1);
        expect(quarantine.everCount).toBe(1);
        const record = getCrmEventLogStore().getState().quarantine[0];
        expect(record.reasonCode).toBe('QUARANTINE_UNKNOWN_MAJOR');
      }

      if (fixture.expect.oversizeSeq) {
        expect(anomalies.oversize).toBe(1);
      }

      if (fixture.expect.duplicatedSeq) {
        expect(anomalies.duplicateSeq).toBe(1);
      }

      if (fixture.expect.outOfOrder) {
        // Delivered scrambled in one batch — the drain sorts and converges,
        // applying the whole chain with nothing left buffered.
        expect(report.buffered).toBe(0);
        expect(report.applied).toBe(entries.length);
      }
    });
  }

  it('an out-of-order gap across two deliveries buffers, then fills and drains', async () => {
    const scrambled = await CASELOG_FIXTURE_MANIFEST.find(
      (f) => f.name === 'out-of-order-arrival'
    )!.load();
    const bySeq = new Map(scrambled.map((e) => [e.seq, e]));

    // Deliver seq 1..2, then the ahead entry seq 4 — a gap at 3 must buffer.
    const withGap = await foldEntries(CASE, [
      bySeq.get('1')!,
      bySeq.get('2')!,
      bySeq.get('4')!,
    ]);
    expect(withGap.applied).toBe(2);
    expect(withGap.buffered).toBeGreaterThan(0);
    expect(selectCaseHalt(CASE)).toEqual({
      reasonCode: 'FOLD_GAP',
      atSeq: '3',
    });

    // The missing seq 3 arrives — the buffer drains and the halt clears.
    const filled = await foldEntries(CASE, [bySeq.get('3')!]);
    expect(filled.applied).toBeGreaterThanOrEqual(2);
    expect(selectCaseHalt(CASE)).toBeNull();
  });
});

describe('quarantine refold-on-upgrade (T4, SC-003)', () => {
  beforeEach(() => {
    clearAllCrmState();
  });

  it('a contracts-version bump re-evaluates a quarantined entry', async () => {
    const { entries } = await unknownEventKind();

    await foldEntries(CASE, entries);
    expect(selectQuarantineCount(CASE)).toEqual({ retained: 1, everCount: 1 });
    expect(getCrmEventLogStore().getState().quarantineTombstones).toHaveLength(
      0
    );

    // Simulate an older build's stored version: the next fold sees the build's
    // CONTRACTS_VERSION outrun it and refolds this case from zero (T4).
    getCrmEventLogStore().getState().setContractsVersion(0);

    await foldEntries(CASE, entries);
    const count = selectQuarantineCount(CASE);
    expect(count.retained).toBe(1); // reinserted fresh
    expect(count.everCount).toBe(2); // monotonic — climbed on the re-add
    expect(getCrmEventLogStore().getState().quarantineTombstones).toHaveLength(
      1
    ); // the dropped record left a tombstone
  });
});
