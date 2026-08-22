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

// T1 backstop (defense in depth) — M1 accepts LWW kinds only, whose echoes are
// harmless out of position by construction. Should a NON-LWW record ever settle
// out of position, that arms exactly ONE refold-from-zero: the settling fold
// drops the stored contracts version to 0, and the NEXT fold of the case
// re-evaluates from genesis and restores the version. It must fire once and
// converge — a second refold would mean the backstop re-armed on an
// already-settled record.

import {
  seedCrmGoldenPath,
  useCrmCasesStore,
  useCrmClientsStore,
  useCrmDocumentsStore,
  useCrmWorkstreamStore,
  type LocalEventCandidate,
} from '@/crm';
import { buildChain } from '@/crm/fixtures/caselog/buildChain';
import {
  CONTRACTS_VERSION,
  foldEntries,
  selectUnsettledOutbox,
} from '@/crm/fold/caseLogFold';
import { getCrmEventLogStore } from '@/crm/fold/eventLogStore';
import { settleHashOf } from '@/crm/hashChain';
import { beforeEach, describe, expect, it } from 'vitest';

const CASE = 'c417';

function stageTransitionCandidate(): LocalEventCandidate {
  return {
    kind: 'lm.caselog/1',
    caseId: CASE,
    firmId: 'lendmind',
    at: 1000,
    actor: { kind: 'adviser', id: 'EV' },
    event: { type: 'stage-transition', payload: { stage: 'DIP' } },
    origin: { artifactId: 'outbox/backstop', runId: '' },
    versions: { model: '', promptSha: '', skillSemver: '', skillSha: '' },
  } as unknown as LocalEventCandidate;
}

function caseStage(): string | undefined {
  return useCrmCasesStore.getState().casesById[CASE]?.stage;
}

describe('outbox T1 backstop — a non-LWW echo arms exactly one refold (SC-004)', () => {
  beforeEach(() => {
    useCrmClientsStore.getState().resetForTests();
    useCrmCasesStore.getState().resetForTests();
    useCrmDocumentsStore.getState().resetForTests();
    useCrmWorkstreamStore.getState().resetForTests();
    getCrmEventLogStore().getState().resetForTests();
    localStorage.clear();
    seedCrmGoldenPath({ ignoreDevGate: true });
    getCrmEventLogStore().getState().resetForTests();
    // Steady state: a live case has already folded once, so its stored version
    // matches the build. Without this the first real fold would refold anyway
    // and mask the backstop-driven refold under test.
    getCrmEventLogStore().getState().setContractsVersion(CONTRACTS_VERSION);
  });

  it('a non-LWW record settling out of position drops the version, and the next fold restores it exactly once', async () => {
    const candidate = stageTransitionCandidate();
    const echo = await buildChain([candidate]);
    const settleHash = await settleHashOf(candidate);

    // Inject the non-LWW record directly — recordLocalEvent would refuse it
    // (halted-unsupported); the backstop only exists for a record that reached
    // the outbox by some other path and now settles out of position.
    getCrmEventLogStore()
      .getState()
      .enqueueOutbox({
        id: `outbox_${CASE}_backstop`,
        caseId: CASE,
        entryCandidate: candidate,
        settleHash,
        state: 'queued',
        queuedAt: candidate.at,
      });

    expect(getCrmEventLogStore().getState().contractsVersion).toBe(
      CONTRACTS_VERSION
    );

    // The settling fold: the echo applies, the record settles, and the non-LWW
    // kind arms the backstop by dropping the version to 0.
    await foldEntries(CASE, echo);
    expect(getCrmEventLogStore().getState().outbox[0].state).toBe('settled');
    expect(selectUnsettledOutbox(CASE)).toBe(0);
    expect(getCrmEventLogStore().getState().contractsVersion).toBe(0);
    const stageAfterArm = caseStage();
    expect(stageAfterArm).toBe('DIP');

    // The convergence fold: version 0 forces a refold-from-zero, which restores
    // the version. The already-settled record cannot re-arm, so the version
    // lands back at CONTRACTS_VERSION and stays there.
    await foldEntries(CASE, echo);
    expect(getCrmEventLogStore().getState().contractsVersion).toBe(
      CONTRACTS_VERSION
    );
    expect(caseStage()).toBe(stageAfterArm); // converged, no double-apply
    expect(selectUnsettledOutbox(CASE)).toBe(0);

    // A third fold sees a matching version — no further refold, version steady.
    await foldEntries(CASE, echo);
    expect(getCrmEventLogStore().getState().contractsVersion).toBe(
      CONTRACTS_VERSION
    );
  });
});
