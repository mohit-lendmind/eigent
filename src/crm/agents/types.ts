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

// The runtime shapes of the M2 agent contracts. The normative declarations live
// in specs/003-*/contracts/*.d.ts; m2ContractFreeze.test.ts pins these against
// them by assignability, so a drift here fails a test rather than the wire.
// Bigint-valued fields cross module boundaries as decimal STRINGS — a spend
// figure must never pass through a JS float.

import type { DirectiveEnvelope } from '../agentContracts';

export interface DispatchResult {
  commandId: string;
  runId: string;
  directiveArtifactId: string;
}

export interface CaseIndexPointer {
  caseId: string;
  firmId: string;
  aionProjectId: string;
  stage: string;
  /** The case log head sequence, decimal — a 64-bit seq never as a float. */
  logHeadSeq: string;
  updatedAt: number;
}

export type WatcherDecisionKind =
  | 'propose-transition'
  | 'chase'
  | 'retention-open'
  | 'reconcile'
  | (string & {});

export interface WatcherDecisionPayload {
  passId: string;
  caseId: string;
  kind: WatcherDecisionKind;
  reason: { claim: string; working: string[]; confidence: number };
  worklistItemId: string;
  /** Dispatch-ready envelope. Unset in M2 (propose-only); M3 populates it. */
  directive?: DirectiveEnvelope;
}

export interface SpendRecord {
  passId: string;
  caseId?: string;
  runId: string;
  costMicroUsd: string;
  fxUsdPerGbpMicro: number;
  fxEffectiveDate: string;
  costMicroGbp: string;
  providerCalls: number;
  at: number;
}

export interface WatcherPassReport {
  passId: string;
  scanned: number;
  skipped: number;
  decided: number;
  breakerTrips: number;
  spend: SpendRecord;
  /**
   * Cases refused because the pass budget was exhausted, kept DISTINCT from the
   * cheap fast-path `skipped` so a supervisor can tell a healthy pass from a
   * budget-starved one (finding 15). Optional to keep the frozen contract.
   */
  budgetRefusals?: number;
  /**
   * Case pointers that could not be read during the index scan (truncated or
   * undecodable) — a corrupt pointer silently drops a case, so the count is
   * surfaced (finding 14). Optional to keep the frozen contract.
   */
  pointerSkips?: number;
}
