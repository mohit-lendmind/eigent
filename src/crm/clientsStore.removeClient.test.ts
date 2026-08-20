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
import { useCrmCasesStore } from './casesStore';
import { useCrmClientsStore } from './clientsStore';
import { useCrmDocumentsStore } from './documentsStore';
import { CRM_SCHEMA_VERSION, type Client } from './domain/types';
import { seedCrmGoldenPath } from './seed';
import { useCrmWorkstreamStore } from './workstreamStore';

describe('removeClient', () => {
  beforeEach(() => {
    useCrmClientsStore.getState().resetForTests();
    useCrmCasesStore.getState().resetForTests();
    useCrmDocumentsStore.getState().resetForTests();
    useCrmWorkstreamStore.getState().resetForTests();
  });

  it('refuses when a case still references the client and appends an ActivityEvent', () => {
    seedCrmGoldenPath({ ignoreDevGate: true });
    const result = useCrmClientsStore.getState().removeClient('aisha');
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        reason: 'referenced_by_case',
        caseIds: expect.arrayContaining(['c417']),
      })
    );
    expect(useCrmClientsStore.getState().clientsById.aisha).toBeDefined();
    const activities =
      useCrmWorkstreamStore.getState().activityByCase.c417 ?? [];
    expect(activities.some((a) => a.kind === 'refusal')).toBe(true);
  });

  it('removes an unreferenced client cleanly', () => {
    const c: Client = {
      id: 'orphan',
      ref: 'LM-C-orph',
      firstName: 'Orphan',
      lastName: 'Reyes',
      initials: 'OR',
      tint: 'muted',
      textCls: 'muted',
      cases: [],
      since: Date.now(),
      schemaVersion: CRM_SCHEMA_VERSION,
    };
    useCrmClientsStore.getState().upsertClients([c]);
    const result = useCrmClientsStore.getState().removeClient('orphan');
    expect(result).toEqual({ ok: true });
    expect(useCrmClientsStore.getState().clientsById.orphan).toBeUndefined();
  });
});
