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

// SC-005 — the M3 dispatch seam is additive, proven by a spike. A watcher
// decision in M2 carries no `directive`, so a consumer that only dispatches when
// one is present does NOTHING (propose-only). M3 changes exactly one thing: it
// populates the decision's already-declared optional `directive` field. The same
// consumer then dispatches it through the EXISTING dispatchDirective seam — no
// watcher rewrite, no new command shape. This test stands in for that consumer
// and shows both halves: the empty decision is inert, the populated one dispatches.

import {
  decodeDirectiveEnvelope,
  type DirectiveEnvelope,
} from '@/crm/agentContracts';
import { resetCaseProjectCaches } from '@/crm/agents/caseProject';
import { dispatchDirective, type DispatchResult } from '@/crm/agents/dispatch';
import { configureAgentEdge } from '@/crm/agents/edge';
import type { WatcherDecisionPayload } from '@/crm/agents/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeEdge } from './fakeEdge';

// A watcher decision exactly as M2 writes it: propose-only, no directive.
function m2Decision(): WatcherDecisionPayload {
  return {
    passId: 'pass_firm-alpha_1',
    caseId: 'c417',
    kind: 'retention-open',
    reason: {
      claim: 'Fixed-rate deal ends within the firm lead window.',
      working: ['days remaining=30'],
      confidence: 0.8,
    },
    worklistItemId: 'wl_pass_firm-alpha_1_c417',
  };
}

// The directive M3 would attach — a lm.directive/1 envelope for the sourcing
// agent. Nothing in M2 constructs this; the seam simply carries it.
function m3Directive(caseId: string): DirectiveEnvelope {
  return {
    kind: 'lm.directive/1',
    agent: 'lm-sourcing',
    caseId,
    firmId: 'firm-alpha',
    directive: 'open-retention-review',
    inputs: { artifacts: [] },
    constraints: {},
    issuedBy: { kind: 'watcher', id: 'lm-watcher' },
    gatePolicy: 'G7',
    traceId: 'trace-retention-1',
    attemptNonce: 'nonce-1',
    versions: {
      model: 'lm-watcher',
      promptSha: 'lm-watcher',
      skillSemver: '1.0.0',
      skillSha: 'lm-watcher-m2',
    },
    budgetMicroGbp: 20_000,
  };
}

// The M3 consumer — the only new code M3 adds. It dispatches a decision iff a
// directive is present; the M2-shaped decision leaves it inert.
async function consume(
  decision: WatcherDecisionPayload
): Promise<DispatchResult | null> {
  if (!decision.directive) return null;
  return dispatchDirective(decision.directive);
}

describe('dispatch seam — M3 is additive (SC-005)', () => {
  beforeEach(() => {
    resetCaseProjectCaches();
  });
  afterEach(() => {
    configureAgentEdge(null);
  });

  it('an M2 decision has no directive and dispatches nothing', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);

    const decision = m2Decision();
    expect(decision.directive).toBeUndefined();

    const result = await consume(decision);
    expect(result).toBeNull();
    expect(edge.commands).toHaveLength(0);
  });

  it('populating the optional directive dispatches it through the existing seam', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);

    // M3 changes exactly one thing: it sets the already-declared field. The rest
    // of the M2 payload is untouched and still valid.
    const decision: WatcherDecisionPayload = {
      ...m2Decision(),
      directive: m3Directive('c417'),
    };
    // The attached directive is a well-formed lm.directive/1 envelope.
    expect(() => decodeDirectiveEnvelope(decision.directive)).not.toThrow();

    const result = await consume(decision);
    expect(result).not.toBeNull();
    expect(result!.commandId).toBeTruthy();
    expect(result!.directiveArtifactId).toBeTruthy();

    // The consumer dispatched exactly one command, referencing the published
    // directive artifact — the same command shape M1/M2 already submit.
    expect(edge.commands).toHaveLength(1);
    const submitted = edge.commands[0];
    expect(submitted.request.attachment_ids).toContain(
      result!.directiveArtifactId
    );
    expect(submitted.request.text).toBe('open-retention-review');
  });
});
