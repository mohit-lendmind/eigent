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
import { c417Log } from '../fixtures/caselog/c417Log';
import {
  decodeCaseLogEntry,
  encodeCaseLogEntry,
  isKnownCaseLogEventKind,
  KNOWN_CASELOG_EVENT_KINDS,
} from './caseLog';
import { ContractDecodeError } from './errors';

describe('decodeCaseLogEntry over the golden log', () => {
  it('decodes every golden entry and round-trips through encode', async () => {
    const log = await c417Log();
    expect(log.length).toBeGreaterThanOrEqual(40);
    for (const entry of log) {
      const decoded = decodeCaseLogEntry(JSON.parse(encodeCaseLogEntry(entry)));
      expect(decoded).toEqual(entry);
    }
  });

  it('exercises every known event-kind member somewhere in the log', async () => {
    const log = await c417Log();
    const seen = new Set(log.map((entry) => entry.event.type));
    for (const kind of KNOWN_CASELOG_EVENT_KINDS) {
      expect(seen.has(kind)).toBe(true);
    }
  });
});

describe('decodeCaseLogEntry open set + failures', () => {
  const base = () => ({
    kind: 'lm.caselog/1' as const,
    caseId: 'c417',
    firmId: 'firm-lm',
    seq: '1',
    at: 1,
    actor: { kind: 'agent', id: 'f07' },
    event: { type: 'field-change', payload: {} },
    origin: { artifactId: 'a', runId: 'r' },
    versions: {
      model: 'm',
      promptSha: 'p',
      skillSemver: '1.0.0',
      skillSha: 's',
    },
    prevHash: 'genesis',
    hash: 'h',
  });

  it('decodes an unknown event member without throwing (open set)', () => {
    const decoded = decodeCaseLogEntry({
      ...base(),
      event: { type: 'from-a-future-agent', payload: { x: 1 } },
    });
    expect(decoded.event.type).toBe('from-a-future-agent');
    expect(isKnownCaseLogEventKind('from-a-future-agent')).toBe(false);
  });

  it('rejects a non-decimal seq, naming the field', () => {
    try {
      decodeCaseLogEntry({ ...base(), seq: 'not-a-number' });
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ContractDecodeError);
      expect((error as ContractDecodeError).field).toBe('CaseLogEntry.seq');
    }
  });

  it('rejects a wrong kind literal, naming the field', () => {
    try {
      decodeCaseLogEntry({ ...base(), kind: 'lm.caselog/2' });
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as ContractDecodeError).field).toBe('CaseLogEntry.kind');
    }
  });

  it('rejects a missing nested event.payload', () => {
    expect(() =>
      decodeCaseLogEntry({ ...base(), event: { type: 'activity' } })
    ).toThrowError(ContractDecodeError);
  });
});
