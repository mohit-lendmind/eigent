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

// M4 (FR-001/004) — the A4 sourcing agent. It has two seams that never blur:
//
//   • DISPATCH (fire-and-forget): when a case reaches income-determined, the
//     agent asks the adapter for its DECLARATIVE plan (buildQuery) and hands that
//     plan to the parked-delegation pump via a directive. The agent NEVER drives
//     the browser executor — it only publishes the plan the pump runs. Resolves
//     the moment the command is admitted.
//
//   • RECORD (post-run): when the pump returns the captured tool_result, the
//     agent runs the adapter's PURE extractor over it and writes the sourcing
//     snapshot (folded summary + full set as attachment, `verified` DERIVED, the
//     acting adviser stamped). This is the only path that produces a snapshot.
//
// The split matters for the honesty spine: the plan is declarative, the extractor
// is pure, and `verified` is derived by the writer — the agent hand-sets nothing.

import type {
  AgentId,
  DirectiveEnvelope,
  VersionStamp,
} from '../agentContracts';
import type { SourcingAdapter } from '../connectors/SourcingAdapter';
import {
  writeSourcingSnapshot,
  type WriteSourcingSnapshotResult,
} from '../connectors/snapshotWriter';
import { dispatchDirective } from './dispatch';
import type { DispatchResult } from './types';

export const SOURCING_AGENT: AgentId = 'lm-sourcing';

const SOURCING_VERSIONS: VersionStamp = {
  model: 'lm-sourcing',
  promptSha: 'lm-sourcing',
  skillSemver: '1.0.0',
  skillSha: 'lm-sourcing-m4',
};

// A curated best-buy / firm-panel run is cheap and bounded; the pump enforces the
// real ceiling, this is the declared envelope budget.
const SOURCING_BUDGET_MICRO_GBP = 250_000;

export interface DispatchSourcingInput {
  caseId: string;
  firmId: string;
  /** The resolved adapter (firmConfig.adapters.sourcing → resolveSourcingAdapter). */
  adapter: SourcingAdapter;
  /** The case facts the adapter's plan fills (loan amount, term, …). */
  caseFacts: Record<string, unknown>;
  /** The adviser the run acts as — stamped on the directive's issuedBy. */
  adviserId: string;
  traceId?: string;
  factFindDigest?: string;
}

/**
 * Build the directive that carries the adapter's declarative plan to the pump.
 * The plan rides in `constraints.plan`; the directive text is the human-readable
 * instruction. issuedBy is the adviser, so the run is attributable (FR-010).
 */
export function buildSourcingDirective(
  input: DispatchSourcingInput
): DirectiveEnvelope {
  const plan = input.adapter.buildQuery(input.caseFacts);
  return {
    kind: 'lm.directive/1',
    agent: SOURCING_AGENT,
    caseId: input.caseId,
    firmId: input.firmId,
    directive: `Source products for case ${input.caseId} via the ${input.adapter.id} panel and capture the results.`,
    inputs: {
      ...(input.factFindDigest ? { factFindDigest: input.factFindDigest } : {}),
      artifacts: [],
    },
    // The declarative plan the pump runs. Kept in constraints so the executor
    // seam sees a plan, not free-form instructions.
    constraints: {
      plan,
      sessionMode: input.adapter.sessionMode,
      coverage: input.adapter.coverage(),
    },
    issuedBy: { kind: 'adviser', id: input.adviserId },
    gatePolicy: 'sourcing-run',
    traceId: input.traceId ?? `sourcing_${input.caseId}`,
    attemptNonce: `${input.caseId}:${input.adapter.id}`,
    versions: SOURCING_VERSIONS,
    budgetMicroGbp: SOURCING_BUDGET_MICRO_GBP,
  };
}

/**
 * Fire the sourcing run: publish the adapter's plan as a directive for the pump.
 * This is what income-determined dispatches. Fire-and-forget — resolves on
 * admission; the captured result is observed later and passed to
 * `recordSourcingRun`. The agent never touches the browser executor here.
 */
export function dispatchSourcingRun(
  input: DispatchSourcingInput
): Promise<DispatchResult> {
  return dispatchDirective(buildSourcingDirective(input));
}

export interface RecordSourcingInput {
  caseId: string;
  firmId: string;
  adviserId: string;
  /** The resolved adapter — its PURE extractor turns the capture into Products. */
  adapter: SourcingAdapter;
  ratesAsAt: string;
  /** The captured tool_result the pump returned (JSON for MSE, scraped rows for
   * a licensed portal). Extracted PURELY — no browser in this path. */
  recordedResult: unknown;
  /** The run's evidence. Present + complete → the writer derives verified:true.
   * A scaffold adapter supplies none, so its snapshot is verified:false. */
  verification?: import('../agentContracts').VerificationRef;
  now?: number;
}

/**
 * Extract the captured result with the adapter's PURE extractor and write the
 * sourcing snapshot. `verified` is DERIVED by the writer from `verification` —
 * this agent never sets it. The coverage is taken from the adapter, never widened.
 */
export function recordSourcingRun(
  input: RecordSourcingInput
): Promise<WriteSourcingSnapshotResult> {
  const products = input.adapter.extract(input.recordedResult);
  return writeSourcingSnapshot({
    caseId: input.caseId,
    firmId: input.firmId,
    adviserId: input.adviserId,
    adapterId: input.adapter.id,
    coverage: input.adapter.coverage(),
    ratesAsAt: input.ratesAsAt,
    products,
    ...(input.verification ? { verification: input.verification } : {}),
    ...(input.now !== undefined ? { now: input.now } : {}),
  });
}
