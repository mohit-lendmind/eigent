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

// M5 (FR-010) — the A6 scenario agent. The directive is declarative + adviser
// attributed; the record path enforces the honesty spine BEFORE any artifact is
// minted: the scenario count is capped, the case must be G9-verified, and every
// payload routes through assertIndicative. The happy path writes a folded
// summary with the full working as a REFERENCED attachment (never inline).

import { decodeDirectiveEnvelope } from '@/crm/agentContracts';
import type { AffordabilityInput } from '@/crm/agentContracts/criteriaAffordability';
import { decodeScenarioRunPayload } from '@/crm/agentContracts/criteriaAffordability';
import { resetCaseProjectCaches } from '@/crm/agents/caseProject';
import { configureAgentEdge } from '@/crm/agents/edge';
import type { IncomeFactState } from '@/crm/agents/incomeGate';
import {
  SCENARIO_AGENT,
  buildScenarioDirective,
  dispatchScenarioRun,
  recordScenarioRun,
} from '@/crm/agents/scenario';
import { type ScenarioBasis } from '@/crm/criteria/counterfactual';
import {
  SYNTHETIC_CASE_FACTS,
  SYNTHETIC_CRITERIA_PACK,
  SYNTHETIC_LENDER_PANEL,
} from '@/crm/fixtures/criteriaPack';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeEdge } from './fakeEdge';

const AFFORDABILITY_INPUTS: readonly AffordabilityInput[] = [
  {
    key: 'annualIncomePence',
    valuePence: 6_000_000,
    provenance: 'det',
    sourceRef: 'doc:payslip',
  },
  { key: 'termYears', value: 25, provenance: 'det', sourceRef: 'app:term' },
  { key: 'rateBps', value: 499, provenance: 'det', sourceRef: 'product:rate' },
  {
    key: 'incomeMultiple',
    value: 4.5,
    provenance: 'det',
    sourceRef: 'product:lti',
  },
];

const BASIS: ScenarioBasis = {
  pack: SYNTHETIC_CRITERIA_PACK,
  caseFacts: SYNTHETIC_CASE_FACTS,
  lenderPanel: SYNTHETIC_LENDER_PANEL,
  affordabilityInputs: AFFORDABILITY_INPUTS,
  stressRateBps: 700,
  caseId: 'c417',
};

const DET_INCOME: readonly IncomeFactState[] = [
  {
    clientId: 'app-1',
    fieldKey: 'basicIncome',
    src: 'det',
    valueType: 'money',
  },
];
const SYN_INCOME: readonly IncomeFactState[] = [
  {
    clientId: 'app-1',
    fieldKey: 'basicIncome',
    src: 'syn',
    valueType: 'money',
  },
];

beforeEach(() => {
  resetCaseProjectCaches();
  localStorage.clear();
});
afterEach(() => {
  configureAgentEdge(null);
});

describe('buildScenarioDirective — declarative + adviser-attributed (FR-010)', () => {
  it('is a well-formed envelope naming the scenario agent + adviser', () => {
    const envelope = buildScenarioDirective({
      caseId: 'c417',
      firmId: 'firm-lm',
      adviserId: 'adv-1',
      deltaCount: 3,
    });
    expect(() => decodeDirectiveEnvelope(envelope)).not.toThrow();
    expect(envelope.agent).toBe(SCENARIO_AGENT);
    expect(envelope.issuedBy).toEqual({ kind: 'adviser', id: 'adv-1' });
    expect(envelope.gatePolicy).toBe('scenario-run');
  });
});

describe('dispatchScenarioRun — fire-and-forget (FR-010)', () => {
  it('admits a command referencing the published directive', async () => {
    configureAgentEdge(new FakeEdge());
    const out = await dispatchScenarioRun({
      caseId: 'c417',
      firmId: 'firm-lm',
      adviserId: 'adv-1',
      deltaCount: 2,
    });
    expect(out.commandId).toBeTruthy();
    expect(out.directiveArtifactId).toBeTruthy();
  });
});

describe('recordScenarioRun — honesty spine enforced before write (FR-010)', () => {
  it('writes a folded summary with the full working as an attachment', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);
    const out = await recordScenarioRun({
      firmId: 'firm-lm',
      adviserId: 'adv-1',
      basis: BASIS,
      deltas: [{ depositPence: 9_000_000 }, { rateBps: 699 }],
      income: { applicants: ['app-1'], facts: DET_INCOME },
      now: 1_724_400_000_000,
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.payload.scenarioCount).toBe(3);
      expect(out.payload.summary.passCountByScenario).toHaveLength(3);
      expect(out.payload.baseRef).toBe(SYNTHETIC_CRITERIA_PACK.packRef);
      expect(out.workingArtifactId).toBeTruthy();
      expect(out.payload.workingAttachmentId).toBe(out.workingArtifactId);
      // The written payload decodes cleanly against the default cap.
      expect(() => decodeScenarioRunPayload(out.payload)).not.toThrow();
    }
  });

  it('refuses (cap-exceeded) BEFORE minting any artifact', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);
    const out = await recordScenarioRun({
      firmId: 'firm-lm',
      adviserId: 'adv-1',
      basis: BASIS,
      // 1 base + 2 deltas = 3 scenarios, but the firm cap is 2.
      deltas: [{ depositPence: 9_000_000 }, { rateBps: 699 }],
      scenarioCap: 2,
      income: { applicants: ['app-1'], facts: DET_INCOME },
    });
    expect(out).toEqual({
      ok: false,
      reason: 'cap-exceeded',
      scenarioCount: 3,
      cap: 2,
    });
    // Nothing was written — the refusal happened before any upload.
    expect([...edge.projects.values()].flat()).toHaveLength(0);
  });

  it('refuses (g9-unverified) when income is not det-verified, naming the step', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);
    const out = await recordScenarioRun({
      firmId: 'firm-lm',
      adviserId: 'adv-1',
      basis: BASIS,
      deltas: [{ depositPence: 9_000_000 }],
      income: { applicants: ['app-1'], facts: SYN_INCOME },
    });
    expect(out.ok).toBe(false);
    if (!out.ok && out.reason === 'g9-unverified') {
      expect(out.blocking[0]?.reason).toBe('syn-only');
      expect(out.blockingSteps[0]).toMatch(/app-1/);
    }
    expect([...edge.projects.values()].flat()).toHaveLength(0);
  });
});
