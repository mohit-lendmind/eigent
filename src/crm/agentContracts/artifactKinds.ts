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

// Per-agent artifact kinds + the quarantine router. Kind strings are
// `<family>/<major>`. A kind whose family is unknown, OR whose major exceeds
// this build's known major for that family, routes to quarantine — never throw,
// never drop (the open-set / unknown-major rule, FR-002).

import { asRecord, ContractDecodeError, requireString } from './errors';

export type KnownArtifactFamily =
  | 'lm.onboarding.request'
  | 'lm.watcher.decision'
  | 'lm.docintel.extraction'
  | 'lm.sourcing.snapshot'
  | 'lm.criteria.verdicts'
  | 'lm.affordability.model'
  | 'lm.comms.draft'
  | 'lm.admin.chase'
  | 'lm.failure'
  | 'lm.caselog'
  | 'lm.directive';

export interface KindClassification {
  family: KnownArtifactFamily | (string & {});
  major: number;
  known: boolean;
  quarantine: boolean;
}

export const KNOWN_MAJORS: Readonly<Record<KnownArtifactFamily, number>> = {
  'lm.onboarding.request': 1,
  'lm.watcher.decision': 1,
  'lm.docintel.extraction': 1,
  'lm.sourcing.snapshot': 1,
  'lm.criteria.verdicts': 1,
  'lm.affordability.model': 1,
  'lm.comms.draft': 1,
  'lm.admin.chase': 1,
  'lm.failure': 1,
  'lm.caselog': 1,
  'lm.directive': 1,
};

export function classifyKind(kind: string): KindClassification {
  const slash = kind.lastIndexOf('/');
  const family = slash >= 0 ? kind.slice(0, slash) : kind;
  const majorRaw = slash >= 0 ? kind.slice(slash + 1) : '';
  const major = Number.parseInt(majorRaw, 10);
  const knownMajor = (KNOWN_MAJORS as Record<string, number | undefined>)[
    family
  ];
  const known =
    knownMajor !== undefined &&
    Number.isFinite(major) &&
    major >= 1 &&
    major <= knownMajor;
  return {
    family,
    major: Number.isFinite(major) ? major : 0,
    known,
    quarantine: !known,
  };
}

export interface AgentArtifactVersions {
  model: string;
  promptSha: string;
  skillSemver: string;
  skillSha: string;
}

function decodeVersions(value: unknown, label: string): AgentArtifactVersions {
  const object = asRecord(value, label);
  return {
    model: requireString(object, label, 'model'),
    promptSha: requireString(object, label, 'promptSha'),
    skillSemver: requireString(object, label, 'skillSemver'),
    skillSha: requireString(object, label, 'skillSha'),
  };
}

export interface FailureArtifact extends Record<string, unknown> {
  kind: 'lm.failure/1';
  agent: string;
  caseId: string;
  reason: string;
  retryHint: 'retryable' | 'terminal' | 'needs-adviser' | (string & {});
  traceId: string;
  versions: AgentArtifactVersions;
}

export function decodeFailureArtifact(value: unknown): FailureArtifact {
  const object = asRecord(value, 'FailureArtifact');
  if (object.kind !== 'lm.failure/1') {
    throw new ContractDecodeError(
      'FailureArtifact.kind',
      "must be 'lm.failure/1'",
      object.kind
    );
  }
  requireString(object, 'FailureArtifact', 'agent');
  requireString(object, 'FailureArtifact', 'caseId');
  requireString(object, 'FailureArtifact', 'reason');
  requireString(object, 'FailureArtifact', 'retryHint');
  requireString(object, 'FailureArtifact', 'traceId');
  decodeVersions(object.versions, 'FailureArtifact.versions');
  return { ...object } as FailureArtifact;
}

// --- Per-agent (A1–A8) minimal typed payloads. Each retains every additive
// field; decode validates only the stable spine (kind literal, caseId,
// traceId, versions) so future payload growth cannot silently drop data. ---

export interface AgentArtifact<K extends string> extends Record<
  string,
  unknown
> {
  kind: K;
  caseId: string;
  traceId: string;
  versions: AgentArtifactVersions;
}

function decodeAgentArtifact<K extends string>(
  value: unknown,
  kind: K,
  label: string
): AgentArtifact<K> {
  const object = asRecord(value, label);
  if (object.kind !== kind) {
    throw new ContractDecodeError(
      `${label}.kind`,
      `must be '${kind}'`,
      object.kind
    );
  }
  requireString(object, label, 'caseId');
  requireString(object, label, 'traceId');
  decodeVersions(object.versions, `${label}.versions`);
  return { ...object } as AgentArtifact<K>;
}

export type OnboardingRequestArtifact =
  AgentArtifact<'lm.onboarding.request/1'>;
export const decodeOnboardingRequest = (
  v: unknown
): OnboardingRequestArtifact =>
  decodeAgentArtifact(
    v,
    'lm.onboarding.request/1',
    'OnboardingRequestArtifact'
  );

export type WatcherDecisionArtifact = AgentArtifact<'lm.watcher.decision/1'>;
export const decodeWatcherDecision = (v: unknown): WatcherDecisionArtifact =>
  decodeAgentArtifact(v, 'lm.watcher.decision/1', 'WatcherDecisionArtifact');

export type DocintelExtractionArtifact =
  AgentArtifact<'lm.docintel.extraction/1'>;
export const decodeDocintelExtraction = (
  v: unknown
): DocintelExtractionArtifact =>
  decodeAgentArtifact(
    v,
    'lm.docintel.extraction/1',
    'DocintelExtractionArtifact'
  );

export type SourcingSnapshotArtifact = AgentArtifact<'lm.sourcing.snapshot/1'>;
export const decodeSourcingSnapshot = (v: unknown): SourcingSnapshotArtifact =>
  decodeAgentArtifact(v, 'lm.sourcing.snapshot/1', 'SourcingSnapshotArtifact');

export type CriteriaVerdictsArtifact = AgentArtifact<'lm.criteria.verdicts/1'>;
export const decodeCriteriaVerdicts = (v: unknown): CriteriaVerdictsArtifact =>
  decodeAgentArtifact(v, 'lm.criteria.verdicts/1', 'CriteriaVerdictsArtifact');

export type AffordabilityModelArtifact =
  AgentArtifact<'lm.affordability.model/1'>;
export const decodeAffordabilityModel = (
  v: unknown
): AffordabilityModelArtifact =>
  decodeAgentArtifact(
    v,
    'lm.affordability.model/1',
    'AffordabilityModelArtifact'
  );

export type CommsDraftArtifact = AgentArtifact<'lm.comms.draft/1'>;
export const decodeCommsDraft = (v: unknown): CommsDraftArtifact =>
  decodeAgentArtifact(v, 'lm.comms.draft/1', 'CommsDraftArtifact');

export type AdminChaseArtifact = AgentArtifact<'lm.admin.chase/1'>;
export const decodeAdminChase = (v: unknown): AdminChaseArtifact =>
  decodeAgentArtifact(v, 'lm.admin.chase/1', 'AdminChaseArtifact');
