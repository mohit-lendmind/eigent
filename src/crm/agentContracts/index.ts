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

// Public surface of the agent-contract package. The frozen declarations in
// specs/002-*/contracts/*.d.ts are normative; a type-assignability test
// (contractFreeze.test.ts) pins these runtime exports against them.

export {
  ContractDecodeError,
  asRecord,
  requireNumber,
  requireString,
} from './errors';

export {
  decodeDirectiveEnvelope,
  decodeVersionStamp,
  directiveIdentity,
  encodeDirectiveEnvelope,
  type AgentId,
  type DirectiveEnvelope,
  type DirectiveIssuerKind,
  type VersionStamp,
} from './envelope';

export {
  KNOWN_CASELOG_EVENT_KINDS,
  decodeCaseLogEntry,
  encodeCaseLogEntry,
  isKnownCaseLogEventKind,
  settleHashOf,
  verifyChain,
  type CaseLogActorKind,
  type CaseLogEntry,
  type CaseLogEvent,
  type CaseLogEventKind,
  type DecimalSeq,
} from './caseLog';

export {
  KNOWN_MAJORS,
  classifyKind,
  decodeAdminChase,
  decodeAffordabilityModel,
  decodeCommsDraft,
  decodeCriteriaVerdicts,
  decodeDocintelExtraction,
  decodeFailureArtifact,
  decodeOnboardingRequest,
  decodeSourcingSnapshot,
  decodeWatcherDecision,
  type AgentArtifact,
  type AgentArtifactVersions,
  type FailureArtifact,
  type KindClassification,
  type KnownArtifactFamily,
} from './artifactKinds';

export {
  GATE_REGISTRY,
  delegableGates,
  gateById,
  type GateApprover,
  type GateDescriptor,
  type GateId,
} from './gates';

export {
  FIRM_CONFIG_DEFAULTS,
  decodeFirmConfig,
  type FirmConfig,
} from './firmConfig';

export {
  FOLD_REASON_CODES,
  foldWorklistItemId,
  formatFoldTitle,
  type FoldReasonCode,
  type ReasonParams,
} from './reasonCodes';
