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

// M5 (SC-004/005) — the four additive M5 entry kinds (criteria-assessment,
// affordability-assessment, scenario-run, criteria-override) fold like any other
// known member: they are APPLIED (never quarantined), each projects a
// deterministic activity pointer carrying its origin.artifactId, and a
// kill-the-laptop refold reproduces the projection byte-for-byte with the
// hash-chain intact. The perf leg keeps the refold of a long mixed log inside the
// 2500 ms kill-the-laptop budget.

import { clearAllCrmState } from '@/crm';
import type { CaseLogEntry } from '@/crm/agentContracts/caseLog';
import { canonicalise } from '@/crm/caseFile';
import {
  buildChain,
  type CaseLogEntryDraft,
} from '@/crm/fixtures/caselog/buildChain';
import { foldEntries, selectCaseWatermark } from '@/crm/fold/caseLogFold';
import { getCrmEventLogStore } from '@/crm/fold/eventLogStore';
import { getCrmWorkstreamStore } from '@/crm/workstreamStore';
import { beforeEach, describe, expect, it } from 'vitest';

const CASE = 'c417';
const M5_KINDS = [
  'criteria-assessment',
  'affordability-assessment',
  'scenario-run',
  'criteria-override',
] as const;

function foldSnapshot(): string {
  const ws = getCrmWorkstreamStore().getState();
  const log = getCrmEventLogStore().getState();
  return JSON.stringify(
    canonicalise({
      activityByCase: ws.activityByCase,
      watermarks: log.watermarks,
      chainHeads: log.chainHeads,
      quarantine: log.quarantine,
      anomalies: log.anomalies,
      haltedCases: log.haltedCases,
    })
  );
}

// A chain that cycles the four M5 kinds. Each entry carries a folded summary
// under a namespaced key and points at its artifact via origin.artifactId.
function m5Log(count: number): Promise<CaseLogEntry[]> {
  const t0 = Date.UTC(2026, 0, 1, 0, 0, 0);
  const drafts: CaseLogEntryDraft[] = Array.from({ length: count }, (_, i) => {
    const type = M5_KINDS[i % M5_KINDS.length];
    return {
      kind: 'lm.caselog/1',
      caseId: CASE,
      firmId: 'firm-lm',
      at: t0 + i * 60_000,
      actor: {
        kind: type === 'criteria-override' ? 'adviser' : 'agent',
        id: type === 'criteria-override' ? 'adv-1' : 'lm-scenario',
      },
      event: {
        type,
        payload: { m5Summary: { type, i } },
      },
      origin: { artifactId: `m5-${type}-${i}`, runId: 'run-m5' },
      versions: {
        model: 'lm-m5',
        promptSha: 'lm-m5',
        skillSemver: '1.0.0',
        skillSha: 'lm-m5',
      },
    };
  });
  return buildChain(drafts);
}

describe('M5 fold — four additive entry kinds converge (FR-012, SC-004)', () => {
  beforeEach(() => {
    clearAllCrmState();
  });

  it('applies all four M5 kinds — none quarantined', async () => {
    const log = await m5Log(M5_KINDS.length);
    const report = await foldEntries(CASE, log);
    expect(report.applied).toBe(M5_KINDS.length);
    expect(report.quarantined).toBe(0);
    expect(getCrmEventLogStore().getState().quarantine).toHaveLength(0);
  });

  it('projects a deterministic activity pointer carrying origin.artifactId', async () => {
    const log = await m5Log(M5_KINDS.length);
    await foldEntries(CASE, log);
    const activities = getCrmWorkstreamStore().getState().activityByCase[CASE];
    expect(activities?.length).toBe(M5_KINDS.length);
    for (const a of activities ?? []) {
      expect(a.origin?.artifactId).toMatch(/^m5-/);
      expect(a.id).toMatch(new RegExp(`^activity_${CASE}_`));
    }
    // The override is stamped adviser-authored; the rest are agent runs.
    const override = activities?.find((a) => a.title.includes('override'));
    expect(override?.kind).toBe('note');
  });

  it('fold → wipe → refold reproduces the projection byte-for-byte', async () => {
    const log = await m5Log(40);
    await foldEntries(CASE, log);
    const s1 = foldSnapshot();

    clearAllCrmState();
    expect(getCrmEventLogStore().getState().watermarks).toEqual({});

    await foldEntries(CASE, log);
    expect(foldSnapshot()).toBe(s1);
    expect(selectCaseWatermark(CASE)).toBe(log[log.length - 1].seq);
  });

  it('the watermark lands on the chain head — hash-chain intact', async () => {
    const log = await m5Log(40);
    const headSeq = log[log.length - 1].seq;
    const report = await foldEntries(CASE, log);
    expect(report.halted).toBeNull();
    expect(selectCaseWatermark(CASE)).toBe(headSeq);
    expect(getCrmEventLogStore().getState().chainHeads[CASE].seq).toBe(headSeq);
  });

  it('a tampered M5 entry halts the case at the tampered seq (tamper-evidence)', async () => {
    const log = await m5Log(6);
    const tampered = log.map((e, i) =>
      i === 3
        ? {
            ...e,
            event: {
              ...e.event,
              payload: { m5Summary: { type: 'tampered', i } },
            },
          }
        : e
    );
    const report = await foldEntries(CASE, tampered);
    expect(report.halted?.reasonCode).toBe('CHAIN_BREAK');
    expect(report.halted?.atSeq).toBe('4');
  });

  it('refolds a long mixed M5 log inside the kill-the-laptop budget', async () => {
    const log = await m5Log(800);
    const started = performance.now();
    const report = await foldEntries(CASE, log);
    const elapsed = performance.now() - started;
    expect(report.applied).toBe(800);
    expect(selectCaseWatermark(CASE)).toBe(log[log.length - 1].seq);
    expect(elapsed).toBeLessThan(2500);
  });
});
