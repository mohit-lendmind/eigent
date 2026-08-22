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

// Frozen M2 — watcher decision payload (inside lm.watcher.decision/1). The M3 dispatch seam.
import type { DirectiveEnvelope } from '../../002-mesh-m1-contracts-audit-spine/contracts/envelope';
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
  /** Dispatch-ready envelope. Unset in M2 (propose-only); M3 populates + a consumer runs it — no watcher rewrite. */
  directive?: DirectiveEnvelope;
}
export interface SpendRecord {
  passId: string;
  caseId?: string;
  runId: string;
  costMicroUsd: string /* bigint */;
  fxUsdPerGbpMicro: number;
  fxEffectiveDate: string;
  costMicroGbp: string /* bigint, derived */;
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
}
export declare function runWatcherPass(
  firmId: string
): Promise<WatcherPassReport>;
