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

// Journey 1 (SC-001) end to end on the desktop path: an onboarding pass builds a
// per-type checklist, drafts a message carrying the firm's disclosures, raises
// G1 (never sends), and — on approval — logs the manual send. The whole thing is
// tamper-evident: every write lands on the case chain and verifyChain agrees.

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
  buildOnboardingChecklist,
} from '@/crm/agents/onboarding';
import { useCrmCasesStore } from '@/crm/casesStore';
import { foldEntries } from '@/crm/fold/caseLogFold';
import { useCrmEventLogStore } from '@/crm/fold/eventLogStore';
import { useCrmWorkstreamStore } from '@/crm/workstreamStore';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeEdge } from './fakeEdge';

function firmConfig(): FirmConfig {
  return decodeFirmConfig({
    firmId: 'firm-alpha',
    disclosureTextRefs: ['IDD-2026', 'ESIS-terms', 'fee-agreement-v3'],
  });
}

// Read the whole case chain back out of the fake edge, ascending by seq.
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

describe('onboarding — Journey 1: draft, G1, approve, chain (SC-001)', () => {
  beforeEach(() => {
    resetCaseProjectCaches();
    useCrmCasesStore.getState().resetForTests();
    useCrmWorkstreamStore.getState().resetForTests();
    useCrmEventLogStore.getState().resetForTests();
    localStorage.clear();
  });
  afterEach(() => {
    configureAgentEdge(null);
  });

  it('builds a checklist that extends the common set for the case type', () => {
    const common = buildOnboardingChecklist('unknown-type');
    const purchase = buildOnboardingChecklist('purchase');
    expect(purchase.length).toBeGreaterThan(common.length);
    const keys = purchase.map((i) => i.itemKey);
    expect(keys).toContain('photo-id');
    expect(keys).toContain('memorandum-of-sale');
  });

  it('drafts with every firm disclosure and raises G1 without sending', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);

    const result = await beginOnboarding({
      caseId: 'c1',
      firmId: 'firm-alpha',
      caseType: 'purchase',
      clientNames: ['Ada Lovelace'],
      firmConfig: firmConfig(),
      issuedBy: { kind: 'adviser', id: 'adviser-1' },
      now: 1_000,
    });

    // The draft cites every required disclosure, verbatim.
    for (const ref of firmConfig().disclosureTextRefs) {
      expect(result.draft.full).toContain(ref);
    }
    // No product/rate/affordability claim leaks into a welcome message.
    expect(result.draft.full.toLowerCase()).not.toContain('interest rate');
    expect(result.draft.full.toLowerCase()).not.toContain('you can afford');

    // G1 is mirrored and OPEN — nothing was sent.
    const gate = useCrmEventLogStore.getState().openGates[result.gate.id];
    expect(gate).toBeDefined();
    expect(gate.gateId).toBe('G1');
    expect(gate.status).toBe('open');
    expect(gate.draftFull).toBe(result.draft.full);

    // Nothing left the building: the fake edge saw no submitted command.
    expect(edge.commands).toHaveLength(0);

    // The chain of what the agent wrote verifies.
    const chain = await readChain(edge, result.gate.projectId, 'c1');
    expect(chain).toHaveLength(2);
    expect((await verifyChain(chain)).ok).toBe(true);
  });

  it('approval logs the manual send, resolves the item, and closes G1', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);

    const started = await beginOnboarding({
      caseId: 'c1',
      firmId: 'firm-alpha',
      caseType: 'remortgage',
      firmConfig: firmConfig(),
      issuedBy: { kind: 'adviser', id: 'adviser-1' },
      now: 1_000,
    });

    await approveOnboardingSend({
      caseId: 'c1',
      firmId: 'firm-alpha',
      projectId: started.gate.projectId,
      worklistItemId: started.worklistItemId,
      gateInstanceId: started.gate.id,
      adviserId: 'adviser-1',
      now: 2_000,
    });

    // The gate is closed with an allow decision.
    const gate = useCrmEventLogStore.getState().openGates[started.gate.id];
    expect(gate.status).toBe('resolved');
    expect(gate.decision).toBe('allow');

    // The full chain (drafted + worklist + sent + resolve) still verifies.
    const chain = await readChain(edge, started.gate.projectId, 'c1');
    expect(chain).toHaveLength(4);
    expect((await verifyChain(chain)).ok).toBe(true);

    // The fold ingests the chain with no quarantine, and the approval worklist
    // item lands resolved.
    const report = await foldEntries('c1', chain);
    expect(report.quarantined).toBe(0);
    const item =
      useCrmWorkstreamStore.getState().worklistItems[started.worklistItemId];
    expect(item).toBeDefined();
    expect(item.status).toBe('resolved');
  });
});
