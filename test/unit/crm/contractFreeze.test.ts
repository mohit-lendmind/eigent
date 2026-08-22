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

// FR-006 / SC-006: the runtime agent-contract exports are pinned against the
// FROZEN declarations in specs/002-.../contracts/*.d.ts. The pin is type-level
// — each `mutuallyAssignable<Frozen, Runtime>()` line fails to compile if the
// runtime type drifts from the contract in either direction — with a handful of
// runtime smoke assertions so the file is a live (passing) vitest suite too.

import * as rtArtifact from '@/crm/agentContracts/artifactKinds';
import * as rtCaseLog from '@/crm/agentContracts/caseLog';
import * as rtEnvelope from '@/crm/agentContracts/envelope';
import * as rtFirm from '@/crm/agentContracts/firmConfig';
import * as rtGates from '@/crm/agentContracts/gates';
import { describe, expect, it } from 'vitest';

// ---- Frozen module shapes (values) and their exported types ---------------
type FEnvelope =
  typeof import('../../../specs/002-mesh-m1-contracts-audit-spine/contracts/envelope');
type FCaseLog =
  typeof import('../../../specs/002-mesh-m1-contracts-audit-spine/contracts/caseLog');
type FArtifact =
  typeof import('../../../specs/002-mesh-m1-contracts-audit-spine/contracts/artifactKinds');
type FGates =
  typeof import('../../../specs/002-mesh-m1-contracts-audit-spine/contracts/gates');
type FFirm =
  typeof import('../../../specs/002-mesh-m1-contracts-audit-spine/contracts/firmConfig');

// True only when A and B are assignable to each other — i.e. identical up to
// structural equivalence. Any drift collapses one arm to `never`.
type MutuallyAssignable<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : never
  : never;
function pin<A, B>(_proof: MutuallyAssignable<A, B>): void {
  void _proof;
}

// ---- envelope.d.ts ---------------------------------------------------------
pin<
  import('../../../specs/002-mesh-m1-contracts-audit-spine/contracts/envelope').DirectiveEnvelope,
  rtEnvelope.DirectiveEnvelope
>(true);
pin<
  import('../../../specs/002-mesh-m1-contracts-audit-spine/contracts/envelope').VersionStamp,
  rtEnvelope.VersionStamp
>(true);
pin<
  import('../../../specs/002-mesh-m1-contracts-audit-spine/contracts/envelope').AgentId,
  rtEnvelope.AgentId
>(true);
pin<
  import('../../../specs/002-mesh-m1-contracts-audit-spine/contracts/envelope').DirectiveIssuerKind,
  rtEnvelope.DirectiveIssuerKind
>(true);
pin<
  FEnvelope['decodeDirectiveEnvelope'],
  typeof rtEnvelope.decodeDirectiveEnvelope
>(true);
pin<
  FEnvelope['encodeDirectiveEnvelope'],
  typeof rtEnvelope.encodeDirectiveEnvelope
>(true);
pin<FEnvelope['directiveIdentity'], typeof rtEnvelope.directiveIdentity>(true);

// ---- caseLog.d.ts ----------------------------------------------------------
pin<
  import('../../../specs/002-mesh-m1-contracts-audit-spine/contracts/caseLog').CaseLogEntry,
  rtCaseLog.CaseLogEntry
>(true);
pin<
  import('../../../specs/002-mesh-m1-contracts-audit-spine/contracts/caseLog').CaseLogEvent,
  rtCaseLog.CaseLogEvent
>(true);
pin<
  import('../../../specs/002-mesh-m1-contracts-audit-spine/contracts/caseLog').CaseLogEventKind,
  rtCaseLog.CaseLogEventKind
>(true);
pin<
  import('../../../specs/002-mesh-m1-contracts-audit-spine/contracts/caseLog').CaseLogActorKind,
  rtCaseLog.CaseLogActorKind
>(true);
pin<
  import('../../../specs/002-mesh-m1-contracts-audit-spine/contracts/caseLog').DecimalSeq,
  rtCaseLog.DecimalSeq
>(true);
pin<FCaseLog['decodeCaseLogEntry'], typeof rtCaseLog.decodeCaseLogEntry>(true);
pin<FCaseLog['encodeCaseLogEntry'], typeof rtCaseLog.encodeCaseLogEntry>(true);
pin<FCaseLog['settleHashOf'], typeof rtCaseLog.settleHashOf>(true);
pin<FCaseLog['verifyChain'], typeof rtCaseLog.verifyChain>(true);

// ---- artifactKinds.d.ts ----------------------------------------------------
pin<
  import('../../../specs/002-mesh-m1-contracts-audit-spine/contracts/artifactKinds').KindClassification,
  rtArtifact.KindClassification
>(true);
pin<
  import('../../../specs/002-mesh-m1-contracts-audit-spine/contracts/artifactKinds').KnownArtifactFamily,
  rtArtifact.KnownArtifactFamily
>(true);
pin<
  import('../../../specs/002-mesh-m1-contracts-audit-spine/contracts/artifactKinds').FailureArtifact,
  rtArtifact.FailureArtifact
>(true);
pin<FArtifact['classifyKind'], typeof rtArtifact.classifyKind>(true);
pin<
  FArtifact['decodeFailureArtifact'],
  typeof rtArtifact.decodeFailureArtifact
>(true);
pin<FArtifact['KNOWN_MAJORS'], typeof rtArtifact.KNOWN_MAJORS>(true);

// ---- gates.d.ts ------------------------------------------------------------
pin<
  import('../../../specs/002-mesh-m1-contracts-audit-spine/contracts/gates').GateDescriptor,
  rtGates.GateDescriptor
>(true);
pin<
  import('../../../specs/002-mesh-m1-contracts-audit-spine/contracts/gates').GateId,
  rtGates.GateId
>(true);
pin<
  import('../../../specs/002-mesh-m1-contracts-audit-spine/contracts/gates').GateApprover,
  rtGates.GateApprover
>(true);
pin<FGates['GATE_REGISTRY'], typeof rtGates.GATE_REGISTRY>(true);
pin<FGates['gateById'], typeof rtGates.gateById>(true);
pin<FGates['delegableGates'], typeof rtGates.delegableGates>(true);

// ---- firmConfig.d.ts -------------------------------------------------------
pin<
  import('../../../specs/002-mesh-m1-contracts-audit-spine/contracts/firmConfig').FirmConfig,
  rtFirm.FirmConfig
>(true);
pin<FFirm['decodeFirmConfig'], typeof rtFirm.decodeFirmConfig>(true);

describe('contract freeze', () => {
  it('runtime modules export the pinned callables and constants', () => {
    expect(typeof rtEnvelope.decodeDirectiveEnvelope).toBe('function');
    expect(typeof rtEnvelope.directiveIdentity).toBe('function');
    expect(typeof rtCaseLog.decodeCaseLogEntry).toBe('function');
    expect(typeof rtCaseLog.verifyChain).toBe('function');
    expect(typeof rtArtifact.classifyKind).toBe('function');
    expect(typeof rtGates.gateById).toBe('function');
    expect(typeof rtFirm.decodeFirmConfig).toBe('function');
    expect(rtGates.GATE_REGISTRY.length).toBe(11);
    expect(Object.keys(rtArtifact.KNOWN_MAJORS).length).toBe(11);
  });
});
