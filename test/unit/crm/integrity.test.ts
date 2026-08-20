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

import {
  CRM_SCHEMA_VERSION,
  crmIntegrityRepair,
  getLastRepairReport,
  useCrmCasesStore,
  useCrmClientsStore,
  useCrmDocumentsStore,
  useCrmWorkstreamStore,
  type Case,
  type CrmDocument,
} from '@/crm';
import type { Pence } from '@/crm/domain/money';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function baseCase(overrides: Partial<Case>): Case {
  return {
    id: 'c-repair',
    ref: 'LM-2026-9999',
    type: 'Purchase',
    kind: 'FTB',
    label: 'Repair case',
    stage: 'LEAD',
    completeness: 0,
    updated: Date.now(),
    applicants: [],
    property: { address: 'x', price: 0 as Pence },
    deposit: { amount: 0 as Pence, percent: 0, sources: [] },
    requirement: {
      loan: 0 as Pence,
      ltv: 0,
      ltvPercent: 0,
      lti: 0,
      termYears: 25,
      repaymentType: 'C&I',
      productType: '2yr',
    },
    affordability: {
      combinedIncome: 0 as Pence,
      monthlyCommitments: 0 as Pence,
    },
    schemaVersion: CRM_SCHEMA_VERSION,
    ...overrides,
  };
}

describe('crmIntegrityRepair', () => {
  beforeEach(() => {
    useCrmClientsStore.getState().resetForTests();
    useCrmCasesStore.getState().resetForTests();
    useCrmDocumentsStore.getState().resetForTests();
    useCrmWorkstreamStore.getState().resetForTests();
    localStorage.clear();
  });

  it('creates a placeholder client for a case referencing a missing id', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useCrmCasesStore.getState().upsertCases([
      baseCase({
        id: 'c-repair',
        applicants: [
          { clientId: 'missing_x', role: 'sole', profile: {}, completeness: 0 },
        ],
      }),
    ]);
    const report = crmIntegrityRepair();
    expect(report.placeholderClientsCreated).toContain('missing_x');
    expect(useCrmClientsStore.getState().clientsById.missing_x?.repaired).toBe(
      true
    );
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('retargets a document whose owner is missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const doc: CrmDocument = {
      id: 'd-missing',
      owner: 'orphan_owner',
      name: 'x.pdf',
      type: 'Test',
      status: 'COMPLETED',
      size: 1,
      when: Date.now(),
      iconTone: 'muted',
      attribution: 0.5,
      insights: [],
      schemaVersion: CRM_SCHEMA_VERSION,
    };
    useCrmDocumentsStore.getState().addDocument(doc);
    const report = crmIntegrityRepair();
    expect(report.retargetedDocuments).toContain('d-missing');
    expect(report.placeholderClientsCreated).toContain('orphan_owner');
    warn.mockRestore();
  });

  it('prunes orphan worklist items whose caseId is unknown', () => {
    useCrmWorkstreamStore.getState().upsertWorklistItems([
      {
        id: 'w-orphan',
        caseId: 'unknown_case',
        kind: 'doc',
        title: 'orphan',
        detail: '',
        status: 'open',
        createdAt: Date.now(),
        schemaVersion: CRM_SCHEMA_VERSION,
      },
    ]);
    const report = crmIntegrityRepair();
    expect(report.prunedWorklist).toContain('w-orphan');
    expect(
      useCrmWorkstreamStore.getState().worklistItems['w-orphan']
    ).toBeUndefined();
  });

  it('prunes orphan stream and activity entries', () => {
    useCrmWorkstreamStore.getState().pushStreamEntry('unknown_case', {
      kind: 'done',
      iconTone: 'muted',
      when: 1,
      title: 'orphan stream',
    });
    useCrmWorkstreamStore.getState().noteActivity('unknown_case', {
      id: 'a-orphan',
      caseId: 'unknown_case',
      kind: 'note',
      title: 'x',
      when: 1,
      schemaVersion: CRM_SCHEMA_VERSION,
    });
    const report = crmIntegrityRepair();
    expect(report.prunedStream.length).toBeGreaterThan(0);
    expect(report.prunedActivity.length).toBeGreaterThan(0);
  });

  it('recomputes case completeness after touching a case', () => {
    useCrmCasesStore.getState().upsertCases([
      baseCase({
        id: 'c-recompute',
        applicants: [
          {
            clientId: 'missing_ru',
            role: 'sole',
            profile: {},
            completeness: 0,
          },
        ],
      }),
    ]);
    const report = crmIntegrityRepair();
    expect(report.recomputedCases).toContain('c-recompute');
  });

  it('getLastRepairReport returns the same report published by the pass', () => {
    useCrmCasesStore.getState().upsertCases([
      baseCase({
        id: 'c-1',
        applicants: [
          {
            clientId: 'missing_lr',
            role: 'sole',
            profile: {},
            completeness: 0,
          },
        ],
      }),
    ]);
    const report = crmIntegrityRepair();
    const last = getLastRepairReport();
    expect(last).toEqual(report);
  });
});
