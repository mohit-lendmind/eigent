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
import { CRM_SCHEMA_VERSION, type CrmDocument } from './domain/types';
import { seedCrmGoldenPath } from './seed';

function baseDoc(overrides: Partial<CrmDocument> = {}): CrmDocument {
  return {
    id: 'doc_test',
    owner: 'aisha',
    name: 'test.pdf',
    type: 'Test',
    status: 'PROCESSING',
    size: 1000,
    when: Date.now(),
    iconTone: 'muted',
    attribution: null,
    insights: [],
    schemaVersion: CRM_SCHEMA_VERSION,
    ...overrides,
  };
}

describe('documentsStore (US1 subset)', () => {
  beforeEach(() => {
    useCrmDocumentsStore.getState().resetForTests();
    useCrmCasesStore.getState().resetForTests();
    useCrmClientsStore.getState().resetForTests();
  });

  it('addDocument holds PROCESSING when attribution is null', () => {
    const doc = baseDoc({ id: 'd_p', attribution: null, status: 'COMPLETED' });
    useCrmDocumentsStore.getState().addDocument(doc);
    expect(useCrmDocumentsStore.getState().documentsById.d_p.status).toBe(
      'PROCESSING'
    );
  });

  it('completeDocument flips status to COMPLETED and stores insights', () => {
    useCrmDocumentsStore.getState().addDocument(baseDoc({ id: 'd1' }));
    useCrmDocumentsStore.getState().completeDocument('d1', {
      type: 'Payslip',
      attribution: 0.98,
      insights: [
        {
          id: 'i-1',
          label: 'Basic',
          value: '£42,000',
          conf: 0.99,
        },
      ],
    });
    const d = useCrmDocumentsStore.getState().documentsById.d1;
    expect(d.status).toBe('COMPLETED');
    expect(d.type).toBe('Payslip');
    expect(d.attribution).toBe(0.98);
    expect(d.insights).toHaveLength(1);
  });

  it('confirmAttribution timestamps the record', () => {
    useCrmDocumentsStore.getState().addDocument(baseDoc({ id: 'd2' }));
    useCrmDocumentsStore
      .getState()
      .confirmAttribution('d2', { confirmedBy: 'EV' });
    expect(useCrmDocumentsStore.getState().documentsById.d2.confirmedBy).toBe(
      'EV'
    );
    expect(
      useCrmDocumentsStore.getState().documentsById.d2.confirmedAt
    ).toBeGreaterThan(0);
  });

  it('setChecklistStatus updates or inserts the item', () => {
    useCrmDocumentsStore
      .getState()
      .setChecklistStatus('aisha', 'photo_id', 'received', {
        label: 'Photo ID',
      });
    useCrmDocumentsStore
      .getState()
      .setChecklistStatus('aisha', 'photo_id', 'partial');
    const item = useCrmDocumentsStore.getState().checklistByOwner.aisha[0];
    expect(item.status).toBe('partial');
    expect(item.label).toBe('Photo ID');
  });

  it('insight conflict flag does not auto-mutate any fact-find field (FR-026)', () => {
    seedCrmGoldenPath({ ignoreDevGate: true });
    const before = useCrmCasesStore.getState().casesById.c417;
    const daniel = before.applicants.find((a) => a.clientId === 'daniel');
    const priorConflict = daniel?.profile.income?.fields.find(
      (f) => f.k === 'basic'
    )?.conflictId;
    expect(priorConflict).toBeDefined();
    // Manually flip the insight; must not mutate the field.
    useCrmDocumentsStore
      .getState()
      .flipInsightConflict('d5', 'income', 'basic', false);
    const after = useCrmCasesStore.getState().casesById.c417;
    const danielAfter = after.applicants.find((a) => a.clientId === 'daniel');
    const stillConflict = danielAfter?.profile.income?.fields.find(
      (f) => f.k === 'basic'
    )?.conflictId;
    expect(stillConflict).toBe(priorConflict);
  });
});
