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
import { getCrmClientsStore, useCrmClientsStore } from './clientsStore';
import { CRM_SCHEMA_VERSION, type Client } from './domain/types';

function seedClient(id: string, cases: string[] = []): Client {
  return {
    id,
    ref: `LM-C-${id}`,
    firstName: 'First',
    lastName: 'Last',
    initials: 'FL',
    tint: 'brand',
    textCls: 'brand',
    cases,
    since: Date.now(),
    schemaVersion: CRM_SCHEMA_VERSION,
  };
}

describe('clientsStore', () => {
  beforeEach(() => {
    useCrmClientsStore.getState().resetForTests();
  });

  it('upsertClients inserts and updates by id (idempotent)', () => {
    const c = seedClient('c1');
    useCrmClientsStore.getState().upsertClients([c]);
    useCrmClientsStore.getState().upsertClients([c]);
    expect(Object.keys(useCrmClientsStore.getState().clientsById)).toEqual([
      'c1',
    ]);
  });

  it('upsertClients merges cases lists on update', () => {
    useCrmClientsStore.getState().upsertClients([seedClient('c1', ['caseA'])]);
    useCrmClientsStore.getState().upsertClients([seedClient('c1', ['caseB'])]);
    const merged = useCrmClientsStore.getState().clientsById.c1.cases.sort();
    expect(merged).toEqual(['caseA', 'caseB']);
  });

  it('noteClientCase appends when absent, no-op when present', () => {
    useCrmClientsStore.getState().upsertClients([seedClient('c1', [])]);
    useCrmClientsStore.getState().noteClientCase('c1', 'caseX');
    useCrmClientsStore.getState().noteClientCase('c1', 'caseX');
    expect(useCrmClientsStore.getState().clientsById.c1.cases).toEqual([
      'caseX',
    ]);
  });

  it('ensureClient returns a repaired placeholder for missing ids', () => {
    const placeholder = useCrmClientsStore.getState().ensureClient('missing');
    expect(placeholder.repaired).toBe(true);
    expect(placeholder.firstName).toBe('Unknown');
    expect(() =>
      useCrmClientsStore.getState().ensureClient('missing')
    ).not.toThrow();
  });

  it('getCrmClientsStore returns the same underlying store', () => {
    expect(getCrmClientsStore()).toBe(useCrmClientsStore);
  });
});
