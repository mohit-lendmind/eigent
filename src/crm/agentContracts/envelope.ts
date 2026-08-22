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

// DirectiveEnvelope (lm.directive/1): one agent invocation. Decode follows the
// house pattern (src/api/aion/v1/contracts.ts): required-string checks, every
// additive field retained, open-set agent/issuer typing. Identity is the
// sha256 of the canonical envelope (nonce inside) — the edge's
// command_id-as-Idempotency-Key discipline transposed to this layer.

import { sha256HexCanonical } from '../hashChain';
import type { CaseId } from './caseLog';
import {
  asRecord,
  ContractDecodeError,
  requireNumber,
  requireString,
} from './errors';

export type AgentId =
  | 'lm-onboarding'
  | 'lm-watcher'
  | 'lm-docintel'
  | 'lm-sourcing'
  | 'lm-criteria'
  | 'lm-affordability'
  | 'lm-comms'
  | 'lm-admin'
  | (string & {});

export interface VersionStamp {
  model: string;
  promptSha: string;
  skillSemver: string;
  skillSha: string;
}

export type DirectiveIssuerKind =
  'adviser' | 'watcher' | 'schedule' | (string & {});

export interface DirectiveEnvelope extends Record<string, unknown> {
  kind: 'lm.directive/1';
  agent: AgentId;
  caseId: CaseId;
  firmId: string;
  directive: string;
  inputs: { factFindDigest?: string; artifacts: string[] };
  constraints: Record<string, unknown>;
  issuedBy: { kind: DirectiveIssuerKind; id: string };
  gatePolicy: string;
  traceId: string;
  attemptNonce: string;
  versions: VersionStamp;
  budgetMicroGbp: number;
}

export function decodeVersionStamp(
  value: unknown,
  label: string
): VersionStamp {
  const object = asRecord(value, label);
  return {
    model: requireString(object, label, 'model'),
    promptSha: requireString(object, label, 'promptSha'),
    skillSemver: requireString(object, label, 'skillSemver'),
    skillSha: requireString(object, label, 'skillSha'),
  };
}

export function decodeDirectiveEnvelope(value: unknown): DirectiveEnvelope {
  const object = asRecord(value, 'DirectiveEnvelope');
  if (object.kind !== 'lm.directive/1') {
    throw new ContractDecodeError(
      'DirectiveEnvelope.kind',
      "must be 'lm.directive/1'",
      object.kind
    );
  }
  requireString(object, 'DirectiveEnvelope', 'agent');
  requireString(object, 'DirectiveEnvelope', 'caseId');
  requireString(object, 'DirectiveEnvelope', 'firmId');
  requireString(object, 'DirectiveEnvelope', 'directive');
  requireString(object, 'DirectiveEnvelope', 'gatePolicy');
  requireString(object, 'DirectiveEnvelope', 'traceId');
  requireString(object, 'DirectiveEnvelope', 'attemptNonce');

  const inputs = asRecord(object.inputs, 'DirectiveEnvelope.inputs');
  if (!Array.isArray(inputs.artifacts)) {
    throw new ContractDecodeError(
      'DirectiveEnvelope.inputs.artifacts',
      'must be an array of strings',
      inputs.artifacts
    );
  }
  if (
    inputs.factFindDigest !== undefined &&
    typeof inputs.factFindDigest !== 'string'
  ) {
    throw new ContractDecodeError(
      'DirectiveEnvelope.inputs.factFindDigest',
      'must be a string when present',
      inputs.factFindDigest
    );
  }

  asRecord(object.constraints, 'DirectiveEnvelope.constraints');

  const issuedBy = asRecord(object.issuedBy, 'DirectiveEnvelope.issuedBy');
  requireString(issuedBy, 'DirectiveEnvelope.issuedBy', 'kind');
  requireString(issuedBy, 'DirectiveEnvelope.issuedBy', 'id');

  decodeVersionStamp(object.versions, 'DirectiveEnvelope.versions');
  requireNumber(object, 'DirectiveEnvelope', 'budgetMicroGbp');

  return { ...object } as DirectiveEnvelope;
}

export function encodeDirectiveEnvelope(envelope: DirectiveEnvelope): string {
  return JSON.stringify(envelope);
}

/** sha256HexCanonical(envelope) — the idempotency identity (nonce included). */
export function directiveIdentity(
  envelope: DirectiveEnvelope
): Promise<string> {
  return sha256HexCanonical(envelope);
}
