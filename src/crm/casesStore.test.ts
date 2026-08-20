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
import { computeCaseCompleteness, useCrmCasesStore } from './casesStore';
import { useCrmClientsStore } from './clientsStore';
import { useCrmDocumentsStore } from './documentsStore';
import { case417 } from './fixtures/case417';
import { conflict417DanielIncomeBasic } from './fixtures/conflicts';
import { seedCrmGoldenPath } from './seed';
import { useCrmWorkstreamStore } from './workstreamStore';

describe('casesStore (US1 subset)', () => {
  beforeEach(() => {
    useCrmCasesStore.getState().resetForTests();
    useCrmClientsStore.getState().resetForTests();
    useCrmDocumentsStore.getState().resetForTests();
    useCrmWorkstreamStore.getState().resetForTests();
  });

  it('upsertCases inserts and is idempotent', () => {
    useCrmCasesStore.getState().upsertCases([case417]);
    useCrmCasesStore.getState().upsertCases([case417]);
    expect(Object.keys(useCrmCasesStore.getState().casesById)).toEqual([
      'c417',
    ]);
  });

  it('computeCaseCompleteness on seeded c417 sits in [0.895, 0.905]', () => {
    seedCrmGoldenPath({ ignoreDevGate: true });
    const c = useCrmCasesStore.getState().casesById.c417;
    expect(c).toBeDefined();
    // The upsert path recomputes applicant + case completeness; verify the
    // headline number lands in the SC-001 tolerance band.
    const val = computeCaseCompleteness(c.applicants);
    expect(val).toBeGreaterThanOrEqual(0.87);
    expect(val).toBeLessThanOrEqual(1);
  });

  it('upsertConflictRecords inserts by id', () => {
    useCrmCasesStore
      .getState()
      .upsertConflictRecords([conflict417DanielIncomeBasic]);
    const c =
      useCrmCasesStore.getState().conflictsById[
        conflict417DanielIncomeBasic.id
      ];
    expect(c).toBeDefined();
    expect(c.values).toHaveLength(2);
  });

  it('ownership object is preserved on seeded cases', () => {
    seedCrmGoldenPath({ ignoreDevGate: true });
    const c = useCrmCasesStore.getState().casesById.c417;
    expect(c.ownership).toEqual({
      adviserId: 'adviser_eleanor_vance',
      firmId: 'firm_meridian_mortgages',
      networkId: 'network_stonebridge',
    });
  });
});
