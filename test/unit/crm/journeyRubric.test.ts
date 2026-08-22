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

// Finding 13 — the e2e/*.eval.ts "recorded evals" scored HAND-WRITTEN fixtures
// against a rubric the fixtures were written to pass, so they were tautological as
// journey evidence. Those files are now honestly marked rubric-only harnesses for
// live captures. THIS is where the genuine, non-tautological journey rubric lives:
// it runs the SAME rubric against the REAL shipped output — the draft
// buildOnboardingDraft actually produces, and the decisions a real runWatcherPass
// actually writes — inside the vitest suite that CI runs. A regression that drops a
// disclosure from the shipped draft, leaks a product claim, or fires the wrong
// watcher trigger fails HERE, unlike a fixture that can be edited to keep passing.

import { decodeFirmConfig } from '@/crm/agentContracts';
import {
  firmCoordinatorProject,
  resetCaseProjectCaches,
} from '@/crm/agents/caseProject';
import { encodeJsonAttachment } from '@/crm/agents/codec';
import { configureAgentEdge } from '@/crm/agents/edge';
import { publishCasePointer } from '@/crm/agents/firmIndex';
import {
  buildOnboardingChecklist,
  buildOnboardingDraft,
} from '@/crm/agents/onboarding';
import { resetWatcherState, runWatcherPass } from '@/crm/agents/watcher';
import { useCrmEventLogStore } from '@/crm/fold/eventLogStore';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeEdge } from './fakeEdge';

// The onboarding rubric (mirrors e2e/lm-onboarding.eval.ts). A draft missing any
// disclosure is a regulatory defect; any forbidden marker means it strayed into a
// product/rate/affordability claim, which onboarding must never do.
const REQUIRED_DISCLOSURES = ['IDD-2026', 'ESIS-terms', 'fee-agreement-v3'];
const FORBIDDEN_CLAIM_MARKERS = [
  'interest rate',
  'apr',
  'you can afford',
  'we recommend',
  'best deal',
  'lowest rate',
  'fixed rate of',
  'tracker at',
];

const FIRM = 'firm-alpha';
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 5, 1, 9, 0, 0);

function firmConfig() {
  return decodeFirmConfig({
    firmId: FIRM,
    disclosureTextRefs: REQUIRED_DISCLOSURES,
  });
}

describe('journey rubric — scored against REAL shipped output (finding 13)', () => {
  beforeEach(() => {
    resetWatcherState();
    resetCaseProjectCaches();
    useCrmEventLogStore.getState().resetForTests();
    localStorage.clear();
  });
  afterEach(() => {
    configureAgentEdge(null);
  });

  it('the onboarding draft the agent actually builds satisfies the SC-001 rubric', () => {
    const checklist = buildOnboardingChecklist('purchase');
    const draft = buildOnboardingDraft(
      {
        caseId: 'c1',
        firmId: FIRM,
        caseType: 'purchase',
        clientNames: ['Ada Lovelace'],
        firmConfig: firmConfig(),
        issuedBy: { kind: 'adviser', id: 'adviser-1' },
      },
      checklist
    );
    const lowered = draft.full.toLowerCase();

    for (const disclosure of REQUIRED_DISCLOSURES) {
      expect(draft.full, `draft missing disclosure ${disclosure}`).toContain(
        disclosure
      );
    }
    for (const marker of FORBIDDEN_CLAIM_MARKERS) {
      expect(lowered, `draft made a claim: "${marker}"`).not.toContain(marker);
    }
    // Every checklist document the agent decided to request is named in the body.
    for (const item of checklist) {
      expect(lowered).toContain(item.label.toLowerCase());
    }
  });

  it('the decisions a real watcher pass writes satisfy the SC-002 rubric', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);

    // c417: fixed-rate deal ends inside the lead window → retention-open.
    // c392: idle past the chase cadence → chase.
    const seed = async (
      caseId: string,
      facts: Record<string, unknown>
    ): Promise<void> => {
      const projectId = `proj_case_${caseId}`;
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
        logHeadSeq: '5',
        updatedAt: 1,
      });
    };
    await seed('c417', {
      fixedRateEndAt: NOW + 30 * DAY,
      lastActivityAt: NOW - 1 * DAY,
    });
    await seed('c392', { lastActivityAt: NOW - 30 * DAY });

    const report = await runWatcherPass(FIRM, {
      now: NOW,
      firmConfig: firmConfig(),
    });
    expect(report.decided).toBe(2);

    const coordId = await firmCoordinatorProject(FIRM);
    const expectedTrigger: Record<string, string> = {
      c417: 'retention-open',
      c392: 'chase',
    };
    const passIds = new Set<string>();
    for (const [caseId, kind] of Object.entries(expectedTrigger)) {
      const list = await edge.listArtifacts(coordId, {
        name: `lm/watcher/${report.passId}/${caseId}.json`,
      });
      const artifact = list.artifacts[0];
      expect(artifact, `no decision for ${caseId}`).toBeDefined();
      const access = await edge.getArtifact(coordId, artifact!.artifact_id, {
        inline: true,
      });
      const decision = JSON.parse(access.content!) as Record<string, unknown>;
      const payload = decision.payload as Record<string, unknown>;

      // Right trigger for the case.
      expect(payload.kind, `${caseId} fired the wrong trigger`).toBe(kind);
      // Propose-only — the M3 dispatch seam stays empty in M2.
      expect(
        payload.directive,
        `${caseId} is not propose-only`
      ).toBeUndefined();
      // The worklist id ties the proposal to the queue row a human sees.
      expect(String(payload.worklistItemId)).toContain(caseId);
      // No product/rate/affordability claim leaks into a proposal.
      const text = JSON.stringify(decision).toLowerCase();
      for (const marker of FORBIDDEN_CLAIM_MARKERS) {
        expect(text, `${caseId} made a claim: "${marker}"`).not.toContain(
          marker
        );
      }
      passIds.add(String(payload.passId));
    }
    // One pass, one id shared by every decision.
    expect(passIds.size).toBe(1);
    expect([...passIds][0]).toBe(report.passId);
    // Propose-only means nothing was ever submitted as a command.
    expect(edge.commands).toHaveLength(0);
  });
});
