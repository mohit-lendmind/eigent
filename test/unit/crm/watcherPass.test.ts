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

// Journey 2 (SC-002) — a watcher pass over a firm. It reads the firm index,
// fast-path SKIPS the cases whose head has not moved and whose clocks have not
// crossed a threshold, fires the fixed-rate-end and stalled-case triggers on the
// rest, and writes PROPOSE-ONLY decisions (directive UNSET — the M3 seam) bounded
// by the per-case breaker and the per-pass budget. Every figure the pass reports
// is a metric, including a tripped limit; nothing is sent.

import {
  decodeCaseLogEntry,
  decodeFirmConfig,
  type FirmConfig,
} from '@/crm/agentContracts';
import {
  firmCoordinatorProject,
  resetCaseProjectCaches,
} from '@/crm/agents/caseProject';
import { encodeJsonAttachment } from '@/crm/agents/codec';
import { configureAgentEdge } from '@/crm/agents/edge';
import { publishCasePointer } from '@/crm/agents/firmIndex';
import {
  ensureWatcherSchedule,
  resetWatcherState,
  runWatcherPass,
} from '@/crm/agents/watcher';
import { useCrmEventLogStore } from '@/crm/fold/eventLogStore';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeEdge } from './fakeEdge';

const FIRM = 'firm-alpha';
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 5, 1, 9, 0, 0);

function caseProjectId(caseId: string): string {
  return `proj_case_${caseId}`;
}

// Publish a case into the firm index and stash its facts in the case Project.
async function seedCase(
  edge: FakeEdge,
  caseId: string,
  facts: Record<string, unknown>,
  logHeadSeq = '5'
): Promise<void> {
  const projectId = caseProjectId(caseId);
  edge.seedProject(projectId);
  await edge.uploadAttachment(projectId, {
    name: `lm/case/${caseId}/facts.json`,
    media_type: 'application/json',
    data_base64: encodeJsonAttachment(facts),
  });
  await publishCasePointer({
    caseId,
    firmId: FIRM,
    aionProjectId: projectId,
    stage: 'application',
    logHeadSeq,
    updatedAt: 1,
  });
}

async function readJson(
  edge: FakeEdge,
  projectId: string,
  name: string
): Promise<Record<string, unknown> | null> {
  const list = await edge.listArtifacts(projectId, { name });
  const newest = list.artifacts?.[0];
  if (!newest) return null;
  const access = await edge.getArtifact(projectId, newest.artifact_id, {
    inline: true,
  });
  return JSON.parse(access.content!);
}

function firmConfig(overrides: Record<string, unknown> = {}): FirmConfig {
  return decodeFirmConfig({ firmId: FIRM, ...overrides });
}

describe('watcher — Journey 2: scan, skip, propose-only (SC-002)', () => {
  beforeEach(() => {
    resetWatcherState();
    resetCaseProjectCaches();
    useCrmEventLogStore.getState().resetForTests();
    localStorage.clear();
  });
  afterEach(() => {
    configureAgentEdge(null);
  });

  it('fires ≥2 triggers, skips the unchanged, and stamps spend', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);

    // Rate radar (deal ends in 30d), stall chase (idle 30d), and a quiet case.
    await seedCase(edge, 'c417', {
      fixedRateEndAt: NOW + 30 * DAY,
      lastActivityAt: NOW - 1 * DAY,
    });
    await seedCase(edge, 'c392', { lastActivityAt: NOW - 30 * DAY });
    await seedCase(edge, 'c-quiet', { lastActivityAt: NOW - 1 * DAY });

    const report = await runWatcherPass(FIRM, {
      now: NOW,
      firmConfig: firmConfig(),
    });

    // Two triggers fire; the quiet case is skipped; nothing trips.
    expect(report.scanned).toBe(3);
    expect(report.decided).toBe(2);
    expect(report.skipped).toBe(1);
    expect(report.breakerTrips).toBe(0);
    // The pass metrics are internally consistent.
    expect(report.skipped + report.decided + report.breakerTrips).toBe(
      report.scanned
    );

    // Spend is stamped: the pass id, the provider calls, and the firm FX rate
    // with its effective date, GBP derived from USD.
    expect(report.spend.passId).toBe(report.passId);
    expect(report.spend.providerCalls).toBe(2);
    expect(report.spend.costMicroUsd).toBe('4000');
    expect(report.spend.fxEffectiveDate).toBe('2026-01-01');
    expect(BigInt(report.spend.costMicroGbp)).toBeGreaterThan(0n);

    // The rate-radar decision is dispatch-ready but PROPOSE-ONLY.
    const coordId = await firmCoordinatorProject(FIRM);
    const decision = await readJson(
      edge,
      coordId,
      `lm/watcher/${report.passId}/c417.json`
    );
    expect(decision).not.toBeNull();
    const payload = decision!.payload as Record<string, unknown>;
    expect(payload.passId).toBe(report.passId);
    expect(payload.kind).toBe('retention-open');
    expect(payload.worklistItemId).toBe(`wl_${report.passId}_c417`);
    // The M3 dispatch seam is deliberately empty in M2.
    expect(payload.directive).toBeUndefined();

    // Nothing was submitted as a command — propose-only means no live dispatch.
    expect(edge.commands).toHaveLength(0);

    // The rate radar mirrors a G7 transition proposal for the queue.
    const gates = Object.values(useCrmEventLogStore.getState().openGates);
    const g7 = gates.find((g) => g.gateId === 'G7' && g.caseId === 'c417');
    expect(g7).toBeDefined();
    expect(g7!.status).toBe('open');
  });

  it('stamps the decision chain entry with the artifact id and pass run id', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);
    await seedCase(edge, 'c417', { fixedRateEndAt: NOW + 30 * DAY });

    const report = await runWatcherPass(FIRM, {
      now: NOW,
      firmConfig: firmConfig(),
    });
    expect(report.decided).toBe(1);

    // The decision artifact lives in the coordinator project; grab its real id.
    const coordId = await firmCoordinatorProject(FIRM);
    const decisionList = await edge.listArtifacts(coordId, {
      name: `lm/watcher/${report.passId}/c417.json`,
    });
    const decisionId = decisionList.artifacts[0]!.artifact_id;

    // The proposal's chain entry (written to the CASE project) must point back
    // to that artifact by its ID, not its name (finding 16), and carry the real
    // pass run id rather than an empty string (finding 17).
    const caseList = await edge.listArtifacts(caseProjectId('c417'), {});
    const chain = [];
    for (const artifact of caseList.artifacts) {
      if (!artifact.name.startsWith('lm/case/c417/')) continue;
      // The case project also holds the non-chain facts.json seed.
      if (artifact.name.endsWith('/facts.json')) continue;
      const access = await edge.getArtifact(
        caseProjectId('c417'),
        artifact.artifact_id,
        { inline: true }
      );
      chain.push(decodeCaseLogEntry(JSON.parse(access.content!)));
    }
    const proposal = chain.find((e) => e.event.type === 'activity');
    expect(proposal).toBeDefined();
    expect(proposal!.origin.artifactId).toBe(decisionId);
    expect(proposal!.origin.artifactId).not.toBe(
      `lm/watcher/${report.passId}/c417.json`
    );
    expect(proposal!.origin.runId).toBe(report.passId);
  });

  it('surfaces a corrupt firm-index pointer as a pass pointer-skip', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);
    await seedCase(edge, 'c417', { fixedRateEndAt: NOW + 30 * DAY });

    // A pointer that cannot be decoded must not silently drop the case from the
    // pass with no signal — the pass reports it as a pointerSkip (finding 14).
    const coordId = await firmCoordinatorProject(FIRM);
    await edge.uploadAttachment(coordId, {
      name: `lm/firm/${FIRM}/case/c-corrupt.json`,
      media_type: 'application/json',
      data_base64: encodeJsonAttachment({ caseId: 'c-corrupt' }),
    });

    const report = await runWatcherPass(FIRM, {
      now: NOW,
      firmConfig: firmConfig(),
    });
    // Only the good case is scanned; the corrupt pointer is a reported skip.
    expect(report.scanned).toBe(1);
    expect(report.pointerSkips).toBe(1);
  });

  it('skips every unchanged case on the next pass (fast-path)', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);
    await seedCase(edge, 'c417', {
      fixedRateEndAt: NOW + 30 * DAY,
      lastActivityAt: NOW - 1 * DAY,
    });
    await seedCase(edge, 'c392', { lastActivityAt: NOW - 30 * DAY });
    await seedCase(edge, 'c-quiet', { lastActivityAt: NOW - 1 * DAY });

    const cfg = firmConfig();
    const first = await runWatcherPass(FIRM, { now: NOW, firmConfig: cfg });
    expect(first.decided).toBe(2);

    // A minute later, no index pointer moved and no clock crossed: everything
    // is skipped before a single model call.
    const second = await runWatcherPass(FIRM, {
      now: NOW + 60_000,
      firmConfig: cfg,
    });
    expect(second.scanned).toBe(3);
    expect(second.decided).toBe(0);
    expect(second.skipped).toBe(3);
    expect(second.spend.providerCalls).toBe(0);
  });

  it('re-evaluates a case whose log head moved', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);
    await seedCase(edge, 'c417', { fixedRateEndAt: NOW + 30 * DAY }, '5');

    const cfg = firmConfig();
    await runWatcherPass(FIRM, { now: NOW, firmConfig: cfg });

    // The case log head advanced (a new pointer version supersedes) — the
    // watcher must look at it again rather than fast-path skip.
    await publishCasePointer({
      caseId: 'c417',
      firmId: FIRM,
      aionProjectId: caseProjectId('c417'),
      stage: 'application',
      logHeadSeq: '6',
      updatedAt: 2,
    });
    const second = await runWatcherPass(FIRM, {
      now: NOW + 60_000,
      firmConfig: cfg,
    });
    expect(second.decided).toBe(1);
  });

  it('respects the per-case breaker across passes', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);
    await seedCase(edge, 'c417', { fixedRateEndAt: NOW + 30 * DAY }, '5');

    const cfg = firmConfig({ breaker: { maxInvocationsPerCaseHour: 1 } });
    const first = await runWatcherPass(FIRM, { now: NOW, firmConfig: cfg });
    expect(first.decided).toBe(1);
    expect(first.breakerTrips).toBe(0);

    // Head moved so the fast-path lets it through, but the case already used its
    // single hourly invocation — a trip, reported not thrown.
    await publishCasePointer({
      caseId: 'c417',
      firmId: FIRM,
      aionProjectId: caseProjectId('c417'),
      stage: 'application',
      logHeadSeq: '6',
      updatedAt: 2,
    });
    const second = await runWatcherPass(FIRM, {
      now: NOW + 5 * 60_000,
      firmConfig: cfg,
    });
    expect(second.decided).toBe(0);
    expect(second.breakerTrips).toBe(1);
  });

  it('stops proposing once the pass budget is spent', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);
    await seedCase(edge, 'c417', { fixedRateEndAt: NOW + 30 * DAY });

    // A one-microGBP envelope cannot fit even a single provider call.
    const cfg = firmConfig({
      budgets: { watcherPassMicroGbp: 1, caseMicroGbp: 15_000_000 },
    });
    const report = await runWatcherPass(FIRM, { now: NOW, firmConfig: cfg });
    expect(report.decided).toBe(0);
    // A trigger was due but the envelope could not fund the provider call, so
    // the case is a budget refusal — NOT a cheap fast-path skip. The two are
    // counted distinctly so a supervisor can tell a healthy pass from a
    // starved one (finding 15).
    expect(report.skipped).toBe(0);
    expect(report.budgetRefusals).toBe(1);
    expect(report.spend.providerCalls).toBe(0);
  });

  it('creates the every-5-minutes coordinator schedule exactly once', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);

    const a = await ensureWatcherSchedule(FIRM);
    const b = await ensureWatcherSchedule(FIRM);
    expect(a).toBe(b);
    expect(edge.schedules).toHaveLength(1);
    expect(edge.schedules[0].cron).toBe('*/5 * * * *');
  });
});
