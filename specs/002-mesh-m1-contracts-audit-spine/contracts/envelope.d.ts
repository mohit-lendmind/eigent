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

// Frozen M1 contract — DirectiveEnvelope (lm.directive/1). See data-model.md.
import type { CaseId } from './caseLog';

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

export declare function decodeDirectiveEnvelope(
  value: unknown
): DirectiveEnvelope;
export declare function encodeDirectiveEnvelope(
  envelope: DirectiveEnvelope
): string;
/** sha256HexCanonical(envelope) — the idempotency identity (nonce included). */
export declare function directiveIdentity(
  envelope: DirectiveEnvelope
): Promise<string>;
