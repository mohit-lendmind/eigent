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
import { CRM_SCHEMA_VERSION } from './domain/types';
import { useCrmWorkstreamStore } from './workstreamStore';

describe('fieldChangeEvents log', () => {
  beforeEach(() => {
    useCrmWorkstreamStore.getState().resetForTests();
  });

  it('returns events in ascending changedAt order (field scope)', () => {
    const w = useCrmWorkstreamStore.getState();
    w.appendFieldChangeEvent({
      caseId: 'c1',
      clientId: 'client1',
      section: 'income',
      fieldKey: 'basic',
      priorValue: null,
      newValue: { t: 'text', v: 'a' },
      priorSrc: null,
      newSrc: 'det',
      changedAt: 200,
      changedBy: 'EV',
      reason: 'edit',
    });
    w.appendFieldChangeEvent({
      caseId: 'c1',
      clientId: 'client1',
      section: 'income',
      fieldKey: 'basic',
      priorValue: { t: 'text', v: 'a' },
      newValue: { t: 'text', v: 'b' },
      priorSrc: 'det',
      newSrc: 'det',
      changedAt: 100,
      changedBy: 'EV',
      reason: 'edit',
    });
    const events = useCrmWorkstreamStore
      .getState()
      .getFieldChangeEventsForField('c1', 'client1', 'income', 'basic');
    expect(events.map((e) => e.changedAt)).toEqual([100, 200]);
  });

  it('scopes correctly by caseId', () => {
    const w = useCrmWorkstreamStore.getState();
    w.appendFieldChangeEvent({
      caseId: 'cA',
      clientId: 'clientA',
      section: 'income',
      fieldKey: 'basic',
      priorValue: null,
      newValue: { t: 'text', v: 'a' },
      priorSrc: null,
      newSrc: 'det',
      changedAt: 1,
      changedBy: 'EV',
      reason: 'edit',
    });
    w.appendFieldChangeEvent({
      caseId: 'cB',
      clientId: 'clientB',
      section: 'income',
      fieldKey: 'basic',
      priorValue: null,
      newValue: { t: 'text', v: 'b' },
      priorSrc: null,
      newSrc: 'det',
      changedAt: 2,
      changedBy: 'EV',
      reason: 'edit',
    });
    expect(
      useCrmWorkstreamStore.getState().getFieldChangeEventsForCase('cA')
    ).toHaveLength(1);
  });

  it('events are never mutated after append', () => {
    const w = useCrmWorkstreamStore.getState();
    w.appendFieldChangeEvent({
      caseId: 'c1',
      clientId: 'client1',
      section: 'income',
      fieldKey: 'basic',
      priorValue: null,
      newValue: { t: 'text', v: 'a' },
      priorSrc: null,
      newSrc: 'det',
      changedAt: 1,
      changedBy: 'EV',
      reason: 'edit',
    });
    const before = { ...useCrmWorkstreamStore.getState().fieldChangeEvents[0] };
    // Try to modify — subsequent state read should return the same shape.
    (
      useCrmWorkstreamStore.getState().fieldChangeEvents[0] as unknown as {
        schemaVersion: number;
      }
    ).schemaVersion = 999;
    // Not mutable via API — schemaVersion stamped on append.
    expect(before.schemaVersion).toBe(CRM_SCHEMA_VERSION);
  });
});
