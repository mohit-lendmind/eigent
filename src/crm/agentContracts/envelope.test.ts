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
  decodeDirectiveEnvelope,
  directiveIdentity,
  encodeDirectiveEnvelope,
  type DirectiveEnvelope,
} from './envelope';
import { ContractDecodeError } from './errors';

function validEnvelope(): DirectiveEnvelope {
  return {
    kind: 'lm.directive/1',
    agent: 'lm-sourcing',
    caseId: 'c417',
    firmId: 'firm-lm',
    directive: 'source-products',
    inputs: { factFindDigest: 'digest-1', artifacts: ['art-1', 'art-2'] },
    constraints: { lenderPanel: ['A', 'B'] },
    issuedBy: { kind: 'adviser', id: 'adv-imran' },
    gatePolicy: 'G5',
    traceId: 'trace-1',
    attemptNonce: 'nonce-1',
    versions: {
      model: 'claude',
      promptSha: 'p',
      skillSemver: '1.0.0',
      skillSha: 's',
    },
    budgetMicroGbp: 20_000,
  };
}

describe('decodeDirectiveEnvelope', () => {
  it('round-trips a valid envelope through encode/decode', () => {
    const env = validEnvelope();
    const decoded = decodeDirectiveEnvelope(
      JSON.parse(encodeDirectiveEnvelope(env))
    );
    expect(decoded).toEqual(env);
  });

  it('retains additive fields the decoder does not name', () => {
    const env = { ...validEnvelope(), futureField: { nested: true } };
    const decoded = decodeDirectiveEnvelope(env);
    expect(decoded.futureField).toEqual({ nested: true });
  });

  it('accepts an open-set agent id', () => {
    const decoded = decodeDirectiveEnvelope({
      ...validEnvelope(),
      agent: 'lm-future-agent',
    });
    expect(decoded.agent).toBe('lm-future-agent');
  });

  it('throws ContractDecodeError naming the field on a bad kind', () => {
    expect(() =>
      decodeDirectiveEnvelope({ ...validEnvelope(), kind: 'nope' })
    ).toThrowError(ContractDecodeError);
    try {
      decodeDirectiveEnvelope({ ...validEnvelope(), kind: 'nope' });
    } catch (error) {
      expect((error as ContractDecodeError).field).toBe(
        'DirectiveEnvelope.kind'
      );
    }
  });

  it('throws when inputs.artifacts is not an array', () => {
    try {
      decodeDirectiveEnvelope({
        ...validEnvelope(),
        inputs: { artifacts: 'x' },
      });
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ContractDecodeError);
      expect((error as ContractDecodeError).field).toBe(
        'DirectiveEnvelope.inputs.artifacts'
      );
    }
  });

  it('throws when budgetMicroGbp is missing', () => {
    const env = validEnvelope() as Record<string, unknown>;
    delete env.budgetMicroGbp;
    expect(() => decodeDirectiveEnvelope(env)).toThrowError(
      ContractDecodeError
    );
  });
});

describe('directiveIdentity', () => {
  it('is a stable function of content (nonce included)', async () => {
    const a = await directiveIdentity(validEnvelope());
    const b = await directiveIdentity(validEnvelope());
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when the attempt nonce changes', async () => {
    const a = await directiveIdentity(validEnvelope());
    const b = await directiveIdentity({
      ...validEnvelope(),
      attemptNonce: 'nonce-2',
    });
    expect(a).not.toBe(b);
  });
});
