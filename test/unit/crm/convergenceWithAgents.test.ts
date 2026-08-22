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

// SC-004 — the M1 kill-the-laptop invariant still holds when the chain is
// authored by the M2 agents rather than a hand-built fixture. An onboarding pass
// (draft → G1 → approve) writes a genuine 12-entry case chain to the edge
// (checklist-status + stream-entry + gate-raise/gate-resolve entries and all);
// we read it back, fold it, wipe every store to the floor, refold, and assert
// the projection — the mirrored open-gate map INCLUDED — is byte-identical. That
// the openGates map survives a wipe+refold is the finding-10 proof: the gate is
// reconstructed from the chain's gate-raise/gate-resolve entries, not a
// side-write the fold would lose. The v2 compliance export re-verifies the same
// chain from the artifact store, so the exported envelope's chainVerified tip is
// proof the agent-written log is tamper-evident.

import { clearAllCrmState, seedCrmGoldenPath } from '@/crm';
import {
  decodeCaseLogEntry,
  decodeFirmConfig,
  verifyChain,
  type CaseLogEntry,
  type FirmConfig,
} from '@/crm/agentContracts';
import { resetCaseProjectCaches } from '@/crm/agents/caseProject';
import { configureAgentEdge } from '@/crm/agents/edge';
import {
  approveOnboardingSend,
  beginOnboarding,
} from '@/crm/agents/onboarding';
import { canonicalise, exportCaseFileV2 } from '@/crm/caseFile';
import { getCrmCasesStore } from '@/crm/casesStore';
import { getCrmClientsStore } from '@/crm/clientsStore';
import { getCrmDocumentsStore } from '@/crm/documentsStore';
import { foldEntries, selectCaseWatermark } from '@/crm/fold/caseLogFold';
import { getCrmEventLogStore } from '@/crm/fold/eventLogStore';
import { getCrmWorkstreamStore } from '@/crm/workstreamStore';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeEdge } from './fakeEdge';

const CASE = 'c1';
const GOLDEN_CASE = 'c417';
const FIRM = 'firm-alpha';

function firmConfig(): FirmConfig {
  return decodeFirmConfig({
    firmId: FIRM,
    disclosureTextRefs: ['IDD-2026', 'ESIS-terms', 'fee-agreement-v3'],
  });
}

// Read the whole case chain back out of the fake edge, ascending by seq — the
// same artifact log a fresh device would re-read after a wipe.
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
      // openGates is fold-derived from gate-raise/gate-resolve entries, so it
      // MUST reproduce byte-for-byte on refold — the finding-10 invariant.
      openGates: log.openGates,
    })
  );
}

// Author a real agent-written chain: onboarding draft → G1 raised → approval
// logs the manual send and resolves the gate. Returns the chain read back from
// the edge, ordered by seq.
async function authorAgentChain(
  edge: FakeEdge,
  caseId: string
): Promise<CaseLogEntry[]> {
  const started = await beginOnboarding({
    caseId,
    firmId: FIRM,
    caseType: 'purchase',
    clientNames: ['Ada Lovelace'],
    firmConfig: firmConfig(),
    issuedBy: { kind: 'adviser', id: 'adviser-1' },
    now: 1_000,
  });
  await approveOnboardingSend({
    caseId,
    firmId: FIRM,
    projectId: started.gate.projectId,
    worklistItemId: started.worklistItemId,
    gateInstanceId: started.gate.id,
    adviserId: 'adviser-1',
    now: 2_000,
  });
  return readChain(edge, started.gate.projectId, caseId);
}

describe('convergence with agents — kill-the-laptop on agent-written entries (SC-004)', () => {
  beforeEach(() => {
    resetCaseProjectCaches();
    clearAllCrmState();
    localStorage.clear();
  });
  afterEach(() => {
    configureAgentEdge(null);
  });

  it('fold → wipe → refold reproduces the projection byte-for-byte', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);
    const chain = await authorAgentChain(edge, CASE);
    // 9 from beginOnboarding('purchase') + 3 from approveOnboardingSend.
    expect(chain).toHaveLength(12);

    await foldEntries(CASE, chain);
    const s1 = foldSnapshot();
    // The gate is present in the projection and resolved from the chain — if the
    // snapshot silently dropped openGates this proof would be vacuous.
    const g1 = getCrmEventLogStore().getState().openGates[`G1_${CASE}`];
    expect(g1?.status).toBe('resolved');
    expect(g1?.decision).toBe('allow');

    clearAllCrmState();
    expect(getCrmEventLogStore().getState().watermarks).toEqual({});
    expect(getCrmEventLogStore().getState().openGates).toEqual({});

    await foldEntries(CASE, chain);
    const s2 = foldSnapshot();

    expect(s2).toBe(s1);
    expect(selectCaseWatermark(CASE)).toBe(chain[chain.length - 1].seq);
  });

  it('the agent-written chain verifies and the v2 export re-verifies it', async () => {
    // The v2 compliance export needs a folded case record; seed the golden-path
    // case, then let the agents author a real onboarding chain onto it.
    seedCrmGoldenPath({ ignoreDevGate: true });
    const edge = new FakeEdge();
    configureAgentEdge(edge);
    const chain = await authorAgentChain(edge, GOLDEN_CASE);

    expect((await verifyChain(chain)).ok).toBe(true);

    await foldEntries(GOLDEN_CASE, chain);
    const bundle = await exportCaseFileV2(GOLDEN_CASE, chain, {
      firmConfig: firmConfig(),
    });

    expect('envelope' in bundle).toBe(true);
    if (!('envelope' in bundle)) return;
    expect(bundle.envelope.exportVersion).toBe(2);
    expect(bundle.envelope.chainVerified).toBe(true);
    expect(bundle.envelope.artifactManifest).toHaveLength(chain.length);
    expect(bundle.envelope.chainHead?.seq).toBe(chain[chain.length - 1].seq);
  });
});
