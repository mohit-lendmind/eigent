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

import { beforeEach, describe, expect, it } from 'vitest';
import {
  CRM_SCHEMA_VERSION,
  type ActivityEvent,
  type RetentionEntry,
  type StreamEntry,
} from './domain/types';
import { useCrmWorkstreamStore } from './workstreamStore';

describe('workstreamStore (US1 subset)', () => {
  beforeEach(() => {
    useCrmWorkstreamStore.getState().resetForTests();
  });

  it('pushStreamEntry preserves trace verbatim', () => {
    const trace = {
      claim: 'x',
      working: ['1. y'],
      evidence: [{ kind: 'policy' as const, label: 'p' }],
      confidence: 0.9,
    };
    useCrmWorkstreamStore.getState().pushStreamEntry('c1', {
      kind: 'done',
      iconTone: 'muted',
      when: 1,
      title: 'test',
      trace,
    });
    const entry = useCrmWorkstreamStore.getState().streamByCase.c1[0];
    expect(entry.trace).toEqual(trace);
    expect(entry.trace).toBe(trace);
  });

  it('noteActivity appends to activityByCase', () => {
    const activity: ActivityEvent = {
      id: 'a1',
      caseId: 'c1',
      kind: 'note',
      title: 'hi',
      when: Date.now(),
      schemaVersion: CRM_SCHEMA_VERSION,
    };
    useCrmWorkstreamStore.getState().noteActivity('c1', activity);
    useCrmWorkstreamStore.getState().noteActivity('c1', activity);
    expect(useCrmWorkstreamStore.getState().activityByCase.c1).toHaveLength(2);
  });

  it('upsertRetention updates by (clientId, endsAt) key', () => {
    const endsAt = Date.UTC(2027, 0, 1);
    const base: RetentionEntry = {
      clientId: 'tom',
      ref: 'LM-C-1187',
      endsAt,
      daysLeft: 100,
      lender: 'Coventry BS',
      rate: 1.84,
      status: 'due',
      schemaVersion: CRM_SCHEMA_VERSION,
    };
    useCrmWorkstreamStore.getState().upsertRetention(base);
    useCrmWorkstreamStore.getState().upsertRetention({ ...base, daysLeft: 79 });
    expect(useCrmWorkstreamStore.getState().retentionEntries).toHaveLength(1);
    expect(useCrmWorkstreamStore.getState().retentionEntries[0].daysLeft).toBe(
      79
    );

    useCrmWorkstreamStore.getState().upsertRetention({
      ...base,
      endsAt: Date.UTC(2028, 0, 1),
    });
    expect(useCrmWorkstreamStore.getState().retentionEntries).toHaveLength(2);
  });

  it('pushStreamEntry stamps id if omitted', () => {
    const entry: Omit<StreamEntry, 'id' | 'schemaVersion' | 'caseId'> = {
      kind: 'done',
      iconTone: 'muted',
      when: 1,
      title: 'test',
    };
    useCrmWorkstreamStore.getState().pushStreamEntry('c2', entry);
    const inserted = useCrmWorkstreamStore.getState().streamByCase.c2[0];
    expect(inserted.id).toMatch(/^stream_/);
    expect(inserted.schemaVersion).toBe(CRM_SCHEMA_VERSION);
  });
});
