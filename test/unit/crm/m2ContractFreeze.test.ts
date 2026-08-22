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

// FR-021 — the M2 runtime exports are pinned against the FROZEN declarations in
// specs/003-.../contracts/*.d.ts (dispatch, firmIndex, watcher, queue). The pin
// is type-level: each `pin<Frozen, Runtime>(true)` fails to compile if either
// side drifts, in either direction. A handful of runtime smoke assertions keep
// the file a live (passing) vitest suite too. The watcher's runtime signature
// carries an optional options bag; it stays mutually assignable to the frozen
// one-arg declaration because a function of fewer params is assignable to one of
// more — that is the M3 seam left open without breaking the frozen contract.

import * as rtCaseProject from '@/crm/agents/caseProject';
import * as rtDispatch from '@/crm/agents/dispatch';
import * as rtFirmIndex from '@/crm/agents/firmIndex';
import * as rtTypes from '@/crm/agents/types';
import * as rtWatcher from '@/crm/agents/watcher';
import * as rtGateCard from '@/crm/ui/GateCard';
import * as rtQueue from '@/crm/ui/queueModel';
import { describe, expect, it } from 'vitest';

// True only when A and B are assignable to each other — any drift collapses one
// arm to `never`, which fails the `true` argument.
type MutuallyAssignable<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : never
  : never;
function pin<A, B>(_proof: MutuallyAssignable<A, B>): void {
  void _proof;
}

// ---- dispatch.d.ts ---------------------------------------------------------
pin<
  import('../../../specs/003-mesh-m2-watcher-onboarding/contracts/dispatch').DispatchResult,
  rtTypes.DispatchResult
>(true);
pin<
  typeof import('../../../specs/003-mesh-m2-watcher-onboarding/contracts/dispatch').dispatchDirective,
  typeof rtDispatch.dispatchDirective
>(true);
pin<
  typeof import('../../../specs/003-mesh-m2-watcher-onboarding/contracts/dispatch').ensureCaseProject,
  typeof rtCaseProject.ensureCaseProject
>(true);
pin<
  typeof import('../../../specs/003-mesh-m2-watcher-onboarding/contracts/dispatch').firmCoordinatorProject,
  typeof rtCaseProject.firmCoordinatorProject
>(true);

// ---- firmIndex.d.ts --------------------------------------------------------
pin<
  import('../../../specs/003-mesh-m2-watcher-onboarding/contracts/firmIndex').CaseIndexPointer,
  rtTypes.CaseIndexPointer
>(true);
pin<
  typeof import('../../../specs/003-mesh-m2-watcher-onboarding/contracts/firmIndex').publishCasePointer,
  typeof rtFirmIndex.publishCasePointer
>(true);
pin<
  typeof import('../../../specs/003-mesh-m2-watcher-onboarding/contracts/firmIndex').readFirmIndex,
  typeof rtFirmIndex.readFirmIndex
>(true);

// ---- watcher.d.ts ----------------------------------------------------------
pin<
  import('../../../specs/003-mesh-m2-watcher-onboarding/contracts/watcher').WatcherDecisionKind,
  rtTypes.WatcherDecisionKind
>(true);
pin<
  import('../../../specs/003-mesh-m2-watcher-onboarding/contracts/watcher').WatcherDecisionPayload,
  rtTypes.WatcherDecisionPayload
>(true);
pin<
  import('../../../specs/003-mesh-m2-watcher-onboarding/contracts/watcher').SpendRecord,
  rtTypes.SpendRecord
>(true);
pin<
  import('../../../specs/003-mesh-m2-watcher-onboarding/contracts/watcher').WatcherPassReport,
  rtTypes.WatcherPassReport
>(true);
pin<
  typeof import('../../../specs/003-mesh-m2-watcher-onboarding/contracts/watcher').runWatcherPass,
  typeof rtWatcher.runWatcherPass
>(true);

// ---- queue.d.ts ------------------------------------------------------------
pin<
  import('../../../specs/003-mesh-m2-watcher-onboarding/contracts/queue').QueueSource,
  rtQueue.QueueSource
>(true);
pin<
  import('../../../specs/003-mesh-m2-watcher-onboarding/contracts/queue').Freshness,
  rtQueue.Freshness
>(true);
pin<
  import('../../../specs/003-mesh-m2-watcher-onboarding/contracts/queue').QueueRow,
  rtQueue.QueueRow
>(true);
pin<
  typeof import('../../../specs/003-mesh-m2-watcher-onboarding/contracts/queue').selectTodayQueue,
  typeof rtQueue.selectTodayQueue
>(true);
pin<
  typeof import('../../../specs/003-mesh-m2-watcher-onboarding/contracts/queue').selectQueueDegraded,
  typeof rtQueue.selectQueueDegraded
>(true);
pin<
  import('../../../specs/003-mesh-m2-watcher-onboarding/contracts/queue').GateCardProps,
  rtGateCard.GateCardProps
>(true);
pin<
  typeof import('../../../specs/003-mesh-m2-watcher-onboarding/contracts/queue').subscribeOpenGate,
  typeof rtGateCard.subscribeOpenGate
>(true);

describe('m2 contract freeze (FR-021)', () => {
  it('runtime modules export the pinned callables', () => {
    expect(typeof rtDispatch.dispatchDirective).toBe('function');
    expect(typeof rtCaseProject.ensureCaseProject).toBe('function');
    expect(typeof rtCaseProject.firmCoordinatorProject).toBe('function');
    expect(typeof rtFirmIndex.publishCasePointer).toBe('function');
    expect(typeof rtFirmIndex.readFirmIndex).toBe('function');
    expect(typeof rtWatcher.runWatcherPass).toBe('function');
    expect(typeof rtQueue.selectTodayQueue).toBe('function');
    expect(typeof rtQueue.selectQueueDegraded).toBe('function');
    expect(typeof rtGateCard.subscribeOpenGate).toBe('function');
    expect(typeof rtGateCard.GateCard).toBe('function');
  });
});
