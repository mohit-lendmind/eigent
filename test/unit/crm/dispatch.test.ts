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

import {
  decodeDirectiveEnvelope,
  directiveIdentity,
  type DirectiveEnvelope,
} from '@/crm/agentContracts';
import { resetCaseProjectCaches } from '@/crm/agents/caseProject';
import { dispatchDirective } from '@/crm/agents/dispatch';
import { configureAgentEdge } from '@/crm/agents/edge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeEdge } from './fakeEdge';

function envelope(
  overrides: Partial<DirectiveEnvelope> = {}
): DirectiveEnvelope {
  return {
    kind: 'lm.directive/1',
    agent: 'lm-onboarding',
    caseId: 'c417',
    firmId: 'firm-alpha',
    directive: 'Draft the welcome and document request for this new case.',
    inputs: { artifacts: [] },
    constraints: {},
    issuedBy: { kind: 'adviser', id: 'adviser-1' },
    gatePolicy: 'G1',
    traceId: 'trace-1',
    attemptNonce: 'nonce-1',
    versions: {
      model: 'test',
      promptSha: 'p',
      skillSemver: '1.0.0',
      skillSha: 's',
    },
    budgetMicroGbp: 15_000_000,
    ...overrides,
  };
}

describe('dispatchDirective — envelope → artifact → command', () => {
  beforeEach(() => {
    resetCaseProjectCaches();
  });

  afterEach(() => {
    configureAgentEdge(null);
  });

  it('publishes the envelope as a JSON artifact and references it in the command', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);
    const env = envelope();

    const result = await dispatchDirective(env);

    // One case project was created; the directive artifact lives in it.
    const projectId = result.directiveArtifactId
      ? [...edge.projects.keys()].find((p) =>
          (edge.projects.get(p) ?? []).some(
            (a) => a.artifact_id === result.directiveArtifactId
          )
        )
      : undefined;
    expect(projectId).toBeDefined();

    const stored = edge.projects
      .get(projectId!)!
      .find((a) => a.artifact_id === result.directiveArtifactId)!;
    expect(stored.media_type).toBe('application/json');
    // Non-`aion-` name, and kept out of the `lm/case/` fold namespace.
    expect(stored.name.startsWith('lm/directive/c417/')).toBe(true);
    expect(stored.name.startsWith('aion-')).toBe(false);

    // The artifact round-trips back to the exact envelope.
    const decoded = decodeDirectiveEnvelope(JSON.parse(stored.contentText));
    expect(decoded).toEqual(env);

    // The command references the artifact and carries the directive text.
    expect(edge.commands).toHaveLength(1);
    const command = edge.commands[0].request;
    expect(command.attachment_ids).toEqual([result.directiveArtifactId]);
    expect(command.text).toBe(env.directive);

    // command_id is the directive identity — the idempotency key.
    const identity = await directiveIdentity(env);
    expect(command.command_id).toBe(`cmd_${identity}`);
    expect(result.commandId).toBe(`cmd_${identity}`);
    expect(result.runId).toMatch(/^run_/);
  });

  it('is idempotent: re-dispatching the same envelope reuses the command id', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);
    const env = envelope();

    const first = await dispatchDirective(env);
    const second = await dispatchDirective(env);

    expect(second.commandId).toBe(first.commandId);
  });
});
