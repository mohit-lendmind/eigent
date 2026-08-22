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

// Frozen M1 contract — agent artifact kinds + quarantine router. See data-model.md.
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
  known: boolean; // family recognised AND major <= build's known major
  quarantine: boolean; // !known → route to quarantine, never throw/drop
}

export declare function classifyKind(kind: string): KindClassification;
export declare const KNOWN_MAJORS: Readonly<
  Record<KnownArtifactFamily, number>
>;

export interface FailureArtifact extends Record<string, unknown> {
  kind: 'lm.failure/1';
  agent: string;
  caseId: string;
  reason: string;
  retryHint: 'retryable' | 'terminal' | 'needs-adviser' | (string & {});
  traceId: string;
  versions: {
    model: string;
    promptSha: string;
    skillSemver: string;
    skillSha: string;
  };
}
export declare function decodeFailureArtifact(value: unknown): FailureArtifact;
