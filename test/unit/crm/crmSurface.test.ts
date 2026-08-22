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

// Finding 3 — the M2 surface was UNWIRED: beginOnboarding / approveOnboardingSend
// / denyOnboardingSend / ensureWatcherSchedule / deployLmSkills had zero runtime
// callers, so Journeys 1 & 2 could not be driven in the running app. crmSurface is
// the controller TodayQueue mounts behind its buttons; this test drives it exactly
// as the screen does (bootstrap on mount, start a case, resolve its G1) and proves
// each entry point reaches the real agent path against a FakeEdge. If the wiring is
// deleted again, these behavioural assertions fail — not just a grep.

import { decodeCaseLogEntry, type CaseLogEntry } from '@/crm/agentContracts';
import { resetCaseProjectCaches } from '@/crm/agents/caseProject';
import { encodeJsonAttachment } from '@/crm/agents/codec';
import { configureAgentEdge } from '@/crm/agents/edge';
import { publishCasePointer, readFirmIndex } from '@/crm/agents/firmIndex';
import { resetWatcherState, runWatcherPass } from '@/crm/agents/watcher';
import { useCrmCasesStore } from '@/crm/casesStore';
import { useCrmFirmStore } from '@/crm/firmStore';
import { foldEntries } from '@/crm/fold/caseLogFold';
import {
  useCrmEventLogStore,
  type MirroredGate,
} from '@/crm/fold/eventLogStore';
import {
  acknowledgeGate,
  approveGate,
  bootstrapCrmSurface,
  CRM_PREVIEW_FIRM_ID,
  descriptorForMirror,
  previewFirmConfig,
  rejectGate,
  startOnboardingCase,
} from '@/crm/ui/crmSurface';
import { useCrmWorkstreamStore } from '@/crm/workstreamStore';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeEdge } from './fakeEdge';

const DAY = 24 * 60 * 60 * 1000;
const WATCHER_NOW = Date.UTC(2026, 5, 1, 9, 0, 0);

function onlyOpenGate(): MirroredGate {
  const gates = Object.values(useCrmEventLogStore.getState().openGates);
  expect(gates).toHaveLength(1);
  return gates[0];
}

// Author a genuine open G7 watcher proposal for a case under the preview firm,
// exactly as a real pass would: seed the case, run one pass, return the mirror.
async function raiseWatcherG7(
  edge: FakeEdge,
  caseId: string
): Promise<MirroredGate> {
  const projectId = `proj_case_${caseId}`;
  edge.seedProject(projectId);
  await edge.uploadAttachment(projectId, {
    name: `lm/case/${caseId}/facts.json`,
    media_type: 'application/json',
    data_base64: encodeJsonAttachment({
      fixedRateEndAt: WATCHER_NOW + 30 * DAY,
    }),
  });
  await publishCasePointer({
    caseId,
    firmId: CRM_PREVIEW_FIRM_ID,
    aionProjectId: projectId,
    stage: 'application',
    logHeadSeq: '5',
    updatedAt: 1,
  });
  const report = await runWatcherPass(CRM_PREVIEW_FIRM_ID, {
    now: WATCHER_NOW,
    firmConfig: previewFirmConfig(),
  });
  expect(report.decided).toBe(1);
  const g7 = Object.values(useCrmEventLogStore.getState().openGates).find(
    (g) => g.gateId === 'G7' && g.caseId === caseId
  );
  expect(g7).toBeDefined();
  return g7!;
}

async function readCaseChain(
  edge: FakeEdge,
  caseId: string
): Promise<CaseLogEntry[]> {
  const projectId = `proj_case_${caseId}`;
  const list = await edge.listArtifacts(projectId, {});
  const entries: CaseLogEntry[] = [];
  for (const artifact of list.artifacts) {
    if (!artifact.name.startsWith(`lm/case/${caseId}/`)) continue;
    if (artifact.name.endsWith('/facts.json')) continue;
    const access = await edge.getArtifact(projectId, artifact.artifact_id, {
      inline: true,
    });
    entries.push(decodeCaseLogEntry(JSON.parse(access.content!)));
  }
  return entries;
}

function activityTitles(chain: CaseLogEntry[]): string[] {
  const titles: string[] = [];
  for (const entry of chain) {
    if (entry.event.type === 'activity') {
      titles.push(entry.event.payload.activity.title);
    }
  }
  return titles;
}

describe('crmSurface — the wired M2 controller (finding 3)', () => {
  beforeEach(() => {
    resetCaseProjectCaches();
    useCrmCasesStore.getState().resetForTests();
    useCrmWorkstreamStore.getState().resetForTests();
    useCrmEventLogStore.getState().resetForTests();
    useCrmFirmStore.getState().resetForTests();
    resetWatcherState();
    localStorage.clear();
  });
  afterEach(() => {
    configureAgentEdge(null);
  });

  it('bootstrap deploys the skills and installs the watcher schedule', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);

    const r = await bootstrapCrmSurface();
    expect(r.ok).toBe(true);
    // FR-005: both bundled skills reached the edge.
    expect(edge.skills.length).toBeGreaterThanOrEqual(2);
    // FR-010: exactly one watcher schedule exists for the firm.
    expect(edge.schedules).toHaveLength(1);
    if (r.ok) expect(edge.schedules[0].schedule_id).toBe(r.value.scheduleId);

    // Idempotent: a second mount adds no duplicate schedule.
    await bootstrapCrmSurface();
    expect(edge.schedules).toHaveLength(1);
  });

  it('starting a case raises an open G1 and publishes the pointer to the firm index', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);

    const r = await startOnboardingCase('purchase');
    expect(r.ok).toBe(true);

    const gate = onlyOpenGate();
    expect(gate.gateId).toBe('G1');
    expect(gate.status).toBe('open');
    expect(descriptorForMirror(gate).id).toBe('G1');

    // The case is immediately discoverable by the watcher pass / queue.
    const index = await readFirmIndex(CRM_PREVIEW_FIRM_ID);
    expect(index.map((p) => p.caseId)).toContain(gate.caseId);

    // Nothing was sent — G1 only proposes.
    expect(edge.commands).toHaveLength(0);
  });

  it('approving through the controller resolves the gate with the edited draft', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);

    await startOnboardingCase('purchase');
    const gate = onlyOpenGate();

    const edited =
      'Welcome — hand-edited by the adviser. IDD-2026 ESIS-terms fee-agreement-v3';
    const r = await approveGate(gate, 'adviser:me', edited);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.decision).toBe('allow');

    const resolved = useCrmEventLogStore.getState().openGates[gate.id];
    expect(resolved.status).toBe('resolved');
    expect(resolved.decision).toBe('allow');
    expect(resolved.edited).toBe(true);
  });

  it('rejecting through the controller denies the gate and sends nothing', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);

    await startOnboardingCase('remortgage');
    const gate = onlyOpenGate();

    const r = await rejectGate(gate, 'adviser:me', 'not this client');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.decision).toBe('deny');

    const resolved = useCrmEventLogStore.getState().openGates[gate.id];
    expect(resolved.status).toBe('resolved');
    expect(resolved.decision).toBe('deny');
    expect(edge.commands).toHaveLength(0);
  });

  it('reports a typed failure instead of throwing when the edge is absent', async () => {
    configureAgentEdge(null);
    const r = await startOnboardingCase('purchase');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
  });
});

// The BLOCKER regression (finding 1): a G7 watcher proposal selected in the queue
// must never be resolved through the G1 send path. approveGate/rejectGate were
// wired to approveOnboardingSend/denyOnboardingSend with hardcoded G1 ids
// regardless of the mirror's gateId, so approving a G7 card wrote a false
// "Onboarding pack sent" G1 activity + a G1-keyed gate-resolve onto the
// tamper-evident chain. These prove the send path now REFUSES a G7 mirror and
// that the only G7 resolution — acknowledge — keys off the gate's OWN id and
// writes no G1 activity.
describe('crmSurface — a G7 watcher card never takes the G1 send path (finding 1)', () => {
  beforeEach(() => {
    resetCaseProjectCaches();
    useCrmCasesStore.getState().resetForTests();
    useCrmWorkstreamStore.getState().resetForTests();
    useCrmEventLogStore.getState().resetForTests();
    useCrmFirmStore.getState().resetForTests();
    resetWatcherState();
    localStorage.clear();
  });
  afterEach(() => {
    configureAgentEdge(null);
  });

  it('approveGate refuses a G7 mirror and fabricates no G1 send', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);
    const g7 = await raiseWatcherG7(edge, 'c417');

    const r = await approveGate(g7, 'adviser:me');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('G7');

    // The G7 mirror is untouched — NOT resolved as an allowed G1 send.
    const after = useCrmEventLogStore.getState().openGates[g7.id];
    expect(after.status).toBe('open');
    expect(after.decision).toBeUndefined();
    // No G1 gate was ever fabricated under the hardcoded onboarding instance id.
    expect(
      useCrmEventLogStore.getState().openGates[`G1_${g7.caseId}`]
    ).toBeUndefined();
    // No "Onboarding pack sent" activity reached the chain, and nothing was sent.
    expect(activityTitles(await readCaseChain(edge, 'c417'))).not.toContain(
      'Onboarding pack sent'
    );
    expect(edge.commands).toHaveLength(0);
  });

  it('rejectGate refuses a G7 mirror', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);
    const g7 = await raiseWatcherG7(edge, 'c417');

    const r = await rejectGate(g7, 'adviser:me', 'not now');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('G7');

    expect(useCrmEventLogStore.getState().openGates[g7.id].status).toBe('open');
    expect(activityTitles(await readCaseChain(edge, 'c417'))).not.toContain(
      'Onboarding pack rejected'
    );
  });

  it('acknowledgeGate resolves the G7 by its OWN id — propose-only, no G1 activity', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);
    const g7 = await raiseWatcherG7(edge, 'c417');

    const r = await acknowledgeGate(g7, 'adviser:me');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.decision).toBe('acknowledged');

    // Resolved by its own instance id, with an acknowledge decision — never the
    // G1 allow/deny verdicts.
    const resolved = useCrmEventLogStore.getState().openGates[g7.id];
    expect(resolved.status).toBe('resolved');
    expect(resolved.decision).toBe('acknowledged');

    // The chain records the acknowledgement, NOT a G1 onboarding send. Nothing
    // was dispatched — M2 is propose-only.
    const titles = activityTitles(await readCaseChain(edge, 'c417'));
    expect(titles).toContain('Watcher proposal acknowledged');
    expect(titles).not.toContain('Onboarding pack sent');
    expect(edge.commands).toHaveLength(0);
  });

  it('a fresh-device pass after an ack does NOT re-raise the acknowledged G7 (finding 2)', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);
    const g7 = await raiseWatcherG7(edge, 'c417');

    // The adviser acknowledges the proposal: this writes the gate-resolve to the
    // durable chain AND republishes the case pointer at the new head.
    const ack = await acknowledgeGate(g7, 'adviser:me');
    expect(ack.ok).toBe(true);

    // The firm index pointer now reflects the ack's chain head, not the stale
    // pre-ack head '5' — the index-freshness half of finding 2.
    const pointers = await readFirmIndex(CRM_PREVIEW_FIRM_ID);
    const pointer = pointers.find((p) => p.caseId === 'c417');
    expect(pointer).toBeDefined();
    expect(pointer!.logHeadSeq).not.toBe('5');

    // Simulate a FRESH device: the per-device last-seen (firm store) is empty, and
    // the fold is rebuilt from the durable chain on boot — so the acknowledged G7
    // is reconstructed as RESOLVED, exactly as a real cold start would.
    resetWatcherState();
    resetCaseProjectCaches();
    useCrmEventLogStore.getState().resetForTests();
    const chain = (await readCaseChain(edge, 'c417')).sort((a, b) =>
      BigInt(a.seq) < BigInt(b.seq) ? -1 : BigInt(a.seq) > BigInt(b.seq) ? 1 : 0
    );
    await foldEntries('c417', chain);
    expect(useCrmEventLogStore.getState().openGates['G7_c417'].status).toBe(
      'resolved'
    );

    // A watcher pass over the same, unchanged case must NOT re-raise the handled
    // nudge: nothing is decided and the card stays resolved rather than re-opening.
    const report = await runWatcherPass(CRM_PREVIEW_FIRM_ID, {
      now: WATCHER_NOW + 60_000,
      firmConfig: previewFirmConfig(),
    });
    expect(report.decided).toBe(0);
    expect(useCrmEventLogStore.getState().openGates['G7_c417'].status).toBe(
      'resolved'
    );
  });

  it('a non-G7 mirror is refused by acknowledgeGate', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);
    await startOnboardingCase('purchase');
    const g1 = onlyOpenGate();

    const r = await acknowledgeGate(g1, 'adviser:me');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('G7');
    // The G1 gate is left open for its proper approve/deny path.
    expect(useCrmEventLogStore.getState().openGates[g1.id].status).toBe('open');
  });
});
