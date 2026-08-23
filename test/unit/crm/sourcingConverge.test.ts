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

// M4 (FR-014) — the kill-the-laptop invariant holds for a chain that carries a
// SOURCING run. The A4 agent writes a folded-summary activity entry (the full set
// rides as an attachment, not inline); we read the chain back off the edge, fold
// it, WIPE every store to the floor, refold, and assert the projection is
// byte-identical — the folded sourcing activity is reconstructed from the chain,
// never a lost side-write. The chain also verifies (tamper-evident) end to end.

import { clearAllCrmState } from '@/crm';
import {
  decodeCaseLogEntry,
  verifyChain,
  type CaseLogEntry,
} from '@/crm/agentContracts';
import { resetCaseProjectCaches } from '@/crm/agents/caseProject';
import { configureAgentEdge } from '@/crm/agents/edge';
import { recordSourcingRun } from '@/crm/agents/sourcing';
import { canonicalise } from '@/crm/caseFile';
import { getCrmCasesStore } from '@/crm/casesStore';
import { getCrmClientsStore } from '@/crm/clientsStore';
import {
  MSE_ADAPTER,
  MSE_REPLAY_VERIFICATION,
} from '@/crm/connectors/adapters/mse';
import {
  getSourcingAdapter,
  registerSourcingAdapter,
  resetSourcingRegistry,
} from '@/crm/connectors/registry';
import { getCrmDocumentsStore } from '@/crm/documentsStore';
import { foldEntries, selectCaseWatermark } from '@/crm/fold/caseLogFold';
import { getCrmEventLogStore } from '@/crm/fold/eventLogStore';
import { getCrmWorkstreamStore } from '@/crm/workstreamStore';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeEdge } from './fakeEdge';

const CASE = 'c-sourcing-1';
const FIRM = 'firm-alpha';

const MSE_DEALS = {
  deals: [
    {
      lenderId: 'lender-002',
      productName: '5 Year Fixed',
      initialRatePct: 4.04,
      aprcPct: 5.9,
      productFeePence: 149900,
      monthlyPaymentPence: 106200,
      trueCostPence: 6521900,
      revertRatePct: 7.74,
      ercPence: 400000,
    },
    {
      lenderId: 'lender-004',
      productName: '95% LTV',
      initialRatePct: 5.29,
      aprcPct: 7.1,
      productFeePence: 49900,
      monthlyPaymentPence: 120400,
      trueCostPence: 0,
      eligible: false,
      declineReason: 'LTV above product maximum',
    },
  ],
};

async function readChain(
  edge: FakeEdge,
  projectId: string,
  caseId: string
): Promise<CaseLogEntry[]> {
  const prefix = `lm/case/${caseId}/`;
  const list = await edge.listArtifacts(projectId, {});
  const entries: CaseLogEntry[] = [];
  for (const artifact of list.artifacts) {
    if (!artifact.name.startsWith(prefix)) continue;
    if (artifact.name.endsWith('/facts.json')) continue;
    const access = await edge.getArtifact(projectId, artifact.artifact_id, {
      inline: true,
    });
    entries.push(decodeCaseLogEntry(JSON.parse(access.content!)));
  }
  return entries.sort((a, b) =>
    BigInt(a.seq) < BigInt(b.seq) ? -1 : BigInt(a.seq) > BigInt(b.seq) ? 1 : 0
  );
}

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
      openGates: log.openGates,
    })
  );
}

async function authorSourcingChain(
  edge: FakeEdge,
  caseId: string
): Promise<{ chain: CaseLogEntry[]; projectId: string }> {
  const adapter = getSourcingAdapter('mse')!;
  const out = await recordSourcingRun({
    caseId,
    firmId: FIRM,
    adviserId: 'adviser-jo',
    adapter,
    ratesAsAt: '2026-08-23T00:00:00.000Z',
    recordedResult: MSE_DEALS,
    verification: {
      ...MSE_REPLAY_VERIFICATION,
      canaryPassedAt: '2026-08-23T01:00:00.000Z',
    },
    now: 1_724_400_000_000,
  });
  const projectId = out.snapshotArtifactId.startsWith('art')
    ? // the project is where the chain lives; find it via the edge's projects
      (edge.projects.keys().next().value as string)
    : '';
  const chain = await readChain(edge, projectId, caseId);
  return { chain, projectId };
}

describe('sourcing convergence — kill-the-laptop with a sourcing entry (FR-014)', () => {
  beforeEach(() => {
    resetSourcingRegistry();
    resetCaseProjectCaches();
    clearAllCrmState();
    localStorage.clear();
    registerSourcingAdapter(MSE_ADAPTER);
  });
  afterEach(() => {
    configureAgentEdge(null);
    resetSourcingRegistry();
  });

  it('fold → wipe → refold reproduces the projection byte-for-byte', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);
    const { chain } = await authorSourcingChain(edge, CASE);
    // A single sourcing activity entry (folded summary; full set is an attachment).
    expect(chain).toHaveLength(1);

    await foldEntries(CASE, chain);
    const s1 = foldSnapshot();
    // The folded sourcing activity landed in the projection.
    const activity =
      getCrmWorkstreamStore().getState().activityByCase[CASE] ?? [];
    expect(activity.some((a) => a.id === `act_sourcing_${CASE}`)).toBe(true);

    clearAllCrmState();
    expect(getCrmWorkstreamStore().getState().activityByCase).toEqual({});

    await foldEntries(CASE, chain);
    const s2 = foldSnapshot();

    expect(s2).toBe(s1);
    expect(selectCaseWatermark(CASE)).toBe(chain[chain.length - 1].seq);
  });

  it('the sourcing-written chain verifies (tamper-evident)', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);
    const { chain } = await authorSourcingChain(edge, CASE);
    expect((await verifyChain(chain)).ok).toBe(true);
  });

  it('re-delivering the sourcing chain is a same-reference no-op', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);
    const { chain } = await authorSourcingChain(edge, CASE);
    await foldEntries(CASE, chain);
    const activityRef = getCrmWorkstreamStore().getState().activityByCase;
    const replay = await foldEntries(CASE, chain);
    expect(replay.applied).toBe(0);
    expect(getCrmWorkstreamStore().getState().activityByCase).toBe(activityRef);
  });
});
