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
import { clearAllCrmState } from './caseFile';
import { CRM_CASES_STORE_KEY, useCrmCasesStore } from './casesStore';
import { CRM_CLIENTS_STORE_KEY, useCrmClientsStore } from './clientsStore';
import {
  CRM_DOCUMENTS_STORE_KEY,
  useCrmDocumentsStore,
} from './documentsStore';
import { seedCrmGoldenPath } from './seed';
import {
  CRM_WORKSTREAM_STORE_KEY,
  useCrmWorkstreamStore,
} from './workstreamStore';

describe('clearAllCrmState', () => {
  beforeEach(() => {
    useCrmClientsStore.getState().resetForTests();
    useCrmCasesStore.getState().resetForTests();
    useCrmDocumentsStore.getState().resetForTests();
    useCrmWorkstreamStore.getState().resetForTests();
    localStorage.clear();
  });

  it('empties all four stores and removes CRM localStorage keys but leaves others alone', () => {
    seedCrmGoldenPath({ ignoreDevGate: true });
    // Force persist writes.
    useCrmClientsStore.setState((s) => ({ ...s }));
    useCrmCasesStore.setState((s) => ({ ...s }));
    useCrmDocumentsStore.setState((s) => ({ ...s }));
    useCrmWorkstreamStore.setState((s) => ({ ...s }));

    localStorage.setItem('unrelated', '1');

    clearAllCrmState();

    expect(Object.keys(useCrmClientsStore.getState().clientsById)).toHaveLength(
      0
    );
    expect(Object.keys(useCrmCasesStore.getState().casesById)).toHaveLength(0);
    expect(
      Object.keys(useCrmDocumentsStore.getState().documentsById)
    ).toHaveLength(0);
    expect(
      Object.keys(useCrmWorkstreamStore.getState().worklistItems)
    ).toHaveLength(0);

    for (const key of [
      CRM_CLIENTS_STORE_KEY,
      CRM_CASES_STORE_KEY,
      CRM_DOCUMENTS_STORE_KEY,
      CRM_WORKSTREAM_STORE_KEY,
    ]) {
      expect(localStorage.getItem(key)).toBeNull();
    }
    expect(localStorage.getItem('unrelated')).toBe('1');
  });
});
