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

import { describe, expect, it } from 'vitest';
import {
  classifyKind,
  decodeCommsDraft,
  decodeFailureArtifact,
  decodeOnboardingRequest,
  KNOWN_MAJORS,
  type FailureArtifact,
} from './artifactKinds';
import { ContractDecodeError } from './errors';

describe('classifyKind', () => {
  it('marks a known family at a known major as known, not quarantined', () => {
    const c = classifyKind('lm.sourcing.snapshot/1');
    expect(c).toMatchObject({
      family: 'lm.sourcing.snapshot',
      major: 1,
      known: true,
      quarantine: false,
    });
  });

  it('quarantines a known family at an unknown (higher) major, never throws', () => {
    const c = classifyKind('lm.sourcing.snapshot/2');
    expect(c.known).toBe(false);
    expect(c.quarantine).toBe(true);
    expect(c.major).toBe(2);
  });

  it('quarantines an entirely unknown family', () => {
    const c = classifyKind('lm.quantum.flux/1');
    expect(c.quarantine).toBe(true);
    expect(c.family).toBe('lm.quantum.flux');
  });

  it('quarantines a kind with no major segment', () => {
    expect(classifyKind('lm.sourcing.snapshot').quarantine).toBe(true);
  });

  it('classifies every known family at its recorded major as known', () => {
    for (const [family, major] of Object.entries(KNOWN_MAJORS)) {
      expect(classifyKind(`${family}/${major}`).known).toBe(true);
    }
  });
});

describe('decodeFailureArtifact', () => {
  const valid: FailureArtifact = {
    kind: 'lm.failure/1',
    agent: 'lm-sourcing',
    caseId: 'c417',
    reason: 'timeout',
    retryHint: 'retryable',
    traceId: 'trace-1',
    versions: {
      model: 'm',
      promptSha: 'p',
      skillSemver: '1.0.0',
      skillSha: 's',
    },
  };

  it('decodes a valid failure artifact', () => {
    expect(decodeFailureArtifact(valid)).toEqual(valid);
  });

  it('throws ContractDecodeError naming the field on a bad kind', () => {
    try {
      decodeFailureArtifact({ ...valid, kind: 'lm.failure/2' });
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ContractDecodeError);
      expect((error as ContractDecodeError).field).toBe('FailureArtifact.kind');
    }
  });
});

describe('per-agent decoders', () => {
  const base = {
    caseId: 'c417',
    traceId: 'trace-1',
    versions: {
      model: 'm',
      promptSha: 'p',
      skillSemver: '1.0.0',
      skillSha: 's',
    },
  };

  it('decodes an onboarding request and retains additive payload', () => {
    const decoded = decodeOnboardingRequest({
      ...base,
      kind: 'lm.onboarding.request/1',
      applicants: 2,
    });
    expect(decoded.kind).toBe('lm.onboarding.request/1');
    expect(decoded.applicants).toBe(2);
  });

  it('throws when the kind does not match the decoder', () => {
    expect(() =>
      decodeCommsDraft({ ...base, kind: 'lm.onboarding.request/1' })
    ).toThrowError(ContractDecodeError);
  });
});
