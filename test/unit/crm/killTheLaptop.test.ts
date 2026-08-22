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

// Journey 1 (SC-001, FR-013) — "kill the laptop". The fold's durable state is
// DERIVED: wipe every store to the floor (a lost device, a cleared cache, a
// changed API environment) and a refold of the same artifact log must
// reconstruct the projection byte-for-byte, with the watermark landing back on
// the chain head. The perf leg pins the refold of a 1,000-entry log under the
// 500 ms budget so recovery is instant, not a spinner.

import { clearAllCrmState } from '@/crm';
import type { CaseLogEntry } from '@/crm/agentContracts/caseLog';
import { canonicalise } from '@/crm/caseFile';
import { getCrmCasesStore } from '@/crm/casesStore';
import { getCrmClientsStore } from '@/crm/clientsStore';
import { getCrmDocumentsStore } from '@/crm/documentsStore';
import { CRM_SCHEMA_VERSION } from '@/crm/domain/types';
import {
  buildChain,
  type CaseLogEntryDraft,
} from '@/crm/fixtures/caselog/buildChain';
import { c417Log } from '@/crm/fixtures/caselog/c417Log';
import { foldEntries, selectCaseWatermark } from '@/crm/fold/caseLogFold';
import { getCrmEventLogStore } from '@/crm/fold/eventLogStore';
import { getCrmWorkstreamStore } from '@/crm/workstreamStore';
import { beforeEach, describe, expect, it } from 'vitest';

const CASE = 'c417';

function foldSnapshot(): string {
  const cases = getCrmCasesStore().getState();
  const clients = getCrmClientsStore().getState();
  const docs = getCrmDocumentsStore().getState();
  const ws = getCrmWorkstreamStore().getState();
  const log = getCrmEventLogStore().getState();
  return JSON.stringify(
    canonicalise({
      casesById: cases.casesById,
      conflictsById: cases.conflictsById,
      criteriaByCase: cases.criteriaByCase,
      productsByCase: cases.productsByCase,
      complianceByCase: cases.complianceByCase,
      clientsById: clients.clientsById,
      documentsById: docs.documentsById,
      checklistByOwner: docs.checklistByOwner,
      worklistItems: ws.worklistItems,
      streamByCase: ws.streamByCase,
      activityByCase: ws.activityByCase,
      watermarks: log.watermarks,
      chainHeads: log.chainHeads,
      quarantine: log.quarantine,
      anomalies: log.anomalies,
      haltedCases: log.haltedCases,
    })
  );
}

// A long, genuine chain of activity entries — cheap to author, exercises the
// full drain (hash recompute, apply, watermark advance) at scale.
function syntheticActivityLog(count: number): Promise<CaseLogEntry[]> {
  const t0 = Date.UTC(2026, 0, 1, 0, 0, 0);
  const drafts: CaseLogEntryDraft[] = Array.from({ length: count }, (_, i) => ({
    kind: 'lm.caselog/1',
    caseId: CASE,
    firmId: 'firm-lm',
    at: t0 + i * 60_000,
    actor: { kind: 'agent', id: 'f07' },
    event: {
      type: 'activity',
      payload: {
        activity: {
          id: `syn-${i}`,
          caseId: CASE,
          kind: 'note',
          title: `synthetic ${i}`,
          when: t0 + i * 60_000,
          schemaVersion: CRM_SCHEMA_VERSION,
        },
      },
    },
    origin: { artifactId: `syn-${i}`, runId: 'run-perf' },
    versions: {
      model: 'claude-perf',
      promptSha: 'prompt-perf',
      skillSemver: '1.0.0',
      skillSha: 'skill-perf',
    },
  }));
  return buildChain(drafts);
}

describe('Journey 1 — kill the laptop, refold from zero (SC-001, FR-013)', () => {
  beforeEach(() => {
    clearAllCrmState();
  });

  it('fold → wipe → refold reproduces the projection byte-for-byte', async () => {
    const log = await c417Log();

    await foldEntries(CASE, log);
    const s1 = foldSnapshot();

    clearAllCrmState();
    expect(Object.keys(getCrmCasesStore().getState().casesById)).toHaveLength(
      0
    );
    expect(getCrmEventLogStore().getState().watermarks).toEqual({});

    await foldEntries(CASE, log);
    const s2 = foldSnapshot();

    expect(s2).toBe(s1);
  });

  it('the watermark lands back on the chain head after a refold', async () => {
    const log = await c417Log();
    const headSeq = log[log.length - 1].seq;

    await foldEntries(CASE, log);
    expect(selectCaseWatermark(CASE)).toBe(headSeq);
    expect(getCrmEventLogStore().getState().chainHeads[CASE].seq).toBe(headSeq);

    clearAllCrmState();
    await foldEntries(CASE, log);
    expect(selectCaseWatermark(CASE)).toBe(headSeq);
  });

  it('refolds a 1,000-entry log in under 500 ms', async () => {
    const log = await syntheticActivityLog(1000);

    const started = performance.now();
    const report = await foldEntries(CASE, log);
    const elapsed = performance.now() - started;

    expect(report.applied).toBe(1000);
    expect(selectCaseWatermark(CASE)).toBe(log[log.length - 1].seq);
    expect(elapsed).toBeLessThan(500);
  });

  it('a fresh environment (new device) reconstructs identical state on refold', async () => {
    const log = await c417Log();
    await foldEntries(CASE, log);
    const s1 = foldSnapshot();

    // A new device starts with empty derived fold state — the same floor an
    // environment-key change leaves behind (FR-013), minus any unflushed outbox.
    getCrmEventLogStore().getState().resetForTests();
    getCrmCasesStore().getState().resetForTests();
    getCrmClientsStore().getState().resetForTests();
    getCrmDocumentsStore().getState().resetForTests();
    getCrmWorkstreamStore().getState().resetForTests();
    expect(getCrmEventLogStore().getState().watermarks).toEqual({});

    await foldEntries(CASE, log);
    expect(foldSnapshot()).toBe(s1);
    expect(selectCaseWatermark(CASE)).toBe(log[log.length - 1].seq);
  });
});
