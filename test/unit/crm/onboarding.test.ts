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
import { readFirmIndex } from '@/crm/agents/firmIndex';
import {
  approveOnboardingSend,
  beginOnboarding,
  buildOnboardingChecklist,
  denyOnboardingSend,
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

    // The chain of what the agent wrote verifies. Every requested document is a
    // checklist-status entry and the timeline beat a stream-entry, so the fold
    // rebuilds them from the chain rather than a lost side-write (finding 6); the
    // gate is a gate-raise entry so a refold reconstructs it (finding 10):
    //   1 activity + 5 checklist-status (3 common + 2 purchase) + 1 stream-entry
    //   + 1 worklist-upsert + 1 gate-raise = 9.
    const chain = await readChain(edge, result.gate.projectId, 'c1');
    expect(chain).toHaveLength(9);
    const kinds = chain.map((e) => e.event.type);
    expect(kinds.filter((k) => k === 'checklist-status')).toHaveLength(5);
    expect(kinds).toContain('stream-entry');
    expect(kinds).toContain('gate-raise');
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

    // The full chain still verifies. beginOnboarding('remortgage') wrote 8
    // entries (1 activity + 4 checklist-status [3 common + 1 remortgage] +
    // 1 stream-entry + 1 worklist-upsert + 1 gate-raise); approval adds 3
    // (1 activity + 1 worklist-resolve + 1 gate-resolve) = 11.
    const chain = await readChain(edge, started.gate.projectId, 'c1');
    expect(chain).toHaveLength(11);
    const kinds = chain.map((e) => e.event.type);
    expect(kinds).toContain('gate-raise');
    expect(kinds).toContain('gate-resolve');
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

  it('logs the edited body on approval and marks the gate edited (SC-001)', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);

    const started = await beginOnboarding({
      caseId: 'c1',
      firmId: 'firm-alpha',
      caseType: 'purchase',
      firmConfig: firmConfig(),
      issuedBy: { kind: 'adviser', id: 'adviser-1' },
      now: 1_000,
    });

    const editedBody = 'Dear Ada, here is my hand-edited welcome. IDD-2026.';
    await approveOnboardingSend({
      caseId: 'c1',
      firmId: 'firm-alpha',
      projectId: started.gate.projectId,
      worklistItemId: started.worklistItemId,
      gateInstanceId: started.gate.id,
      adviserId: 'adviser-1',
      editedDraft: editedBody,
      now: 2_000,
    });

    // The audit chain must show WHAT was sent — the edited body, not a generic
    // note — and the gate mirror records the edit so the unedited-% metric can
    // ever fall below 100 (findings 5/21).
    const gate = useCrmEventLogStore.getState().openGates[started.gate.id];
    expect(gate.decision).toBe('allow');
    expect(gate.edited).toBe(true);

    const chain = await readChain(edge, started.gate.projectId, 'c1');
    const sent = chain
      .map((e) => e.event)
      .find(
        (ev) => ev.type === 'activity' && ev.payload.activity.kind === 'note'
      );
    expect(sent).toBeDefined();
    if (sent?.type !== 'activity') throw new Error('expected activity');
    expect(sent.payload.activity.detail).toContain(editedBody);
  });

  it('republishes the case pointer on draft and on approval (finding 11)', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);

    const started = await beginOnboarding({
      caseId: 'c1',
      firmId: 'firm-alpha',
      caseType: 'purchase',
      firmConfig: firmConfig(),
      issuedBy: { kind: 'adviser', id: 'adviser-1' },
      now: 1_000,
    });

    // A stale pointer would hide the case from every watcher pass until an
    // unrelated write; beginOnboarding must publish the fresh log head.
    const afterDraft = await readFirmIndex('firm-alpha');
    const drafted = afterDraft.find((p) => p.caseId === 'c1');
    expect(drafted).toBeDefined();
    expect(drafted!.logHeadSeq).toBe(started.headSeq);

    const approved = await approveOnboardingSend({
      caseId: 'c1',
      firmId: 'firm-alpha',
      projectId: started.gate.projectId,
      worklistItemId: started.worklistItemId,
      gateInstanceId: started.gate.id,
      adviserId: 'adviser-1',
      now: 2_000,
    });

    // Approval advanced the head; the pointer must move with it.
    const afterApprove = await readFirmIndex('firm-alpha');
    const resolved = afterApprove.find((p) => p.caseId === 'c1');
    expect(resolved!.logHeadSeq).toBe(approved.headSeq);
    expect(resolved!.logHeadSeq).not.toBe(started.headSeq);
  });

  it('rejection sends nothing, resolves the item, and denies the gate (finding 18)', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);

    const started = await beginOnboarding({
      caseId: 'c1',
      firmId: 'firm-alpha',
      caseType: 'purchase',
      firmConfig: firmConfig(),
      issuedBy: { kind: 'adviser', id: 'adviser-1' },
      now: 1_000,
    });

    const result = await denyOnboardingSend({
      caseId: 'c1',
      firmId: 'firm-alpha',
      projectId: started.gate.projectId,
      worklistItemId: started.worklistItemId,
      gateInstanceId: started.gate.id,
      adviserId: 'adviser-1',
      reason: 'Client asked us to hold.',
      now: 2_000,
    });
    expect(result.decision).toBe('deny');

    // The gate closes as denied and the approval task resolves — the adviser can
    // refuse a regulated send, not only approve it.
    const gate = useCrmEventLogStore.getState().openGates[started.gate.id];
    expect(gate.status).toBe('resolved');
    expect(gate.decision).toBe('deny');

    // Nothing was sent; the deny travels the chain as a gate-resolve so a refold
    // reconstructs the closed gate (findings 10/18).
    expect(edge.commands).toHaveLength(0);
    const chain = await readChain(edge, started.gate.projectId, 'c1');
    const resolve = chain
      .map((e) => e.event)
      .find((ev) => ev.type === 'gate-resolve');
    expect(resolve).toBeDefined();
    if (resolve?.type !== 'gate-resolve')
      throw new Error('expected gate-resolve');
    expect(resolve.payload.decision).toBe('deny');

    const report = await foldEntries('c1', chain);
    expect(report.quarantined).toBe(0);
    const item =
      useCrmWorkstreamStore.getState().worklistItems[started.worklistItemId];
    expect(item.status).toBe('resolved');
  });
});
