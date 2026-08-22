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

import { resetCaseProjectCaches } from '@/crm/agents/caseProject';
import { configureAgentEdge } from '@/crm/agents/edge';
import { readFirmIndex } from '@/crm/agents/firmIndex';
import { useCrmCasesStore } from '@/crm/casesStore';
import { useCrmFirmStore } from '@/crm/firmStore';
import {
  useCrmEventLogStore,
  type MirroredGate,
} from '@/crm/fold/eventLogStore';
import {
  approveGate,
  bootstrapCrmSurface,
  CRM_PREVIEW_FIRM_ID,
  descriptorForMirror,
  rejectGate,
  startOnboardingCase,
} from '@/crm/ui/crmSurface';
import { useCrmWorkstreamStore } from '@/crm/workstreamStore';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeEdge } from './fakeEdge';

function onlyOpenGate(): MirroredGate {
  const gates = Object.values(useCrmEventLogStore.getState().openGates);
  expect(gates).toHaveLength(1);
  return gates[0];
}

describe('crmSurface — the wired M2 controller (finding 3)', () => {
  beforeEach(() => {
    resetCaseProjectCaches();
    useCrmCasesStore.getState().resetForTests();
    useCrmWorkstreamStore.getState().resetForTests();
    useCrmEventLogStore.getState().resetForTests();
    useCrmFirmStore.getState().resetForTests();
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
