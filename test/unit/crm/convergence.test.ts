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

// SC-001 — the fold's convergence contract. A batch fold, the same log folded
// one entry at a time, and a re-delivery of an already-applied log must all
// land the four domain stores in the same place: batch and incremental produce
// byte-identical projections, and a replay is a true no-op (same object
// reference, no wasted setState). The race guard proves the per-case queue
// serialises two concurrent drains so a live notification firing mid-refresh
// cannot double-apply.

import { clearAllCrmState } from '@/crm';
import type { CaseLogEntry } from '@/crm/agentContracts/caseLog';
import { canonicalise } from '@/crm/caseFile';
import { getCrmCasesStore } from '@/crm/casesStore';
import { getCrmClientsStore } from '@/crm/clientsStore';
import { getCrmDocumentsStore } from '@/crm/documentsStore';
import { c417Log } from '@/crm/fixtures/caselog/c417Log';
import { foldEntries } from '@/crm/fold/caseLogFold';
import { getCrmEventLogStore } from '@/crm/fold/eventLogStore';
import { getCrmWorkstreamStore } from '@/crm/workstreamStore';
import { beforeEach, describe, expect, it } from 'vitest';

// A canonical byte-string of everything the fold writes across all five stores.
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
      fieldChangeEvents: ws.fieldChangeEvents,
      retentionEntries: ws.retentionEntries,
      watermarks: log.watermarks,
      chainHeads: log.chainHeads,
      quarantine: log.quarantine,
      anomalies: log.anomalies,
      haltedCases: log.haltedCases,
    })
  );
}

describe('fold convergence (SC-001)', () => {
  let log: CaseLogEntry[];

  beforeEach(async () => {
    clearAllCrmState();
    log = await c417Log();
  });

  it('batch fold and incremental fold land byte-identical projections', async () => {
    clearAllCrmState();
    const batch = await foldEntries('c417', log);
    const batchSnapshot = foldSnapshot();
    expect(batch.applied).toBe(log.length);

    clearAllCrmState();
    for (const entry of log) {
      await foldEntries('c417', [entry]);
    }
    const incrementalSnapshot = foldSnapshot();

    expect(incrementalSnapshot).toBe(batchSnapshot);
  });

  it('re-delivering an applied log is a same-reference no-op', async () => {
    clearAllCrmState();
    await foldEntries('c417', log);

    const casesRef = getCrmCasesStore().getState().casesById;
    const worklistRef = getCrmWorkstreamStore().getState().worklistItems;
    const watermarkRef = getCrmEventLogStore().getState().watermarks;

    const replay = await foldEntries('c417', log);

    expect(replay.applied).toBe(0);
    expect(getCrmCasesStore().getState().casesById).toBe(casesRef);
    expect(getCrmWorkstreamStore().getState().worklistItems).toBe(worklistRef);
    expect(getCrmEventLogStore().getState().watermarks).toBe(watermarkRef);
  });

  it('two concurrent drains serialise — the second is a replay, never double-applies', async () => {
    clearAllCrmState();

    const [first, second] = await Promise.all([
      foldEntries('c417', log),
      foldEntries('c417', log),
    ]);
    const concurrentSnapshot = foldSnapshot();

    expect(first.applied).toBe(log.length);
    expect(second.applied).toBe(0);

    clearAllCrmState();
    await foldEntries('c417', log);
    expect(concurrentSnapshot).toBe(foldSnapshot());
  });
});
