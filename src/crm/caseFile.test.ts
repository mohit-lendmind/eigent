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
import { canonicalise, exportCaseFile } from './caseFile';
import { useCrmCasesStore } from './casesStore';
import { useCrmClientsStore } from './clientsStore';
import { useCrmDocumentsStore } from './documentsStore';
import { CRM_SCHEMA_VERSION } from './domain/types';
import { seedCrmGoldenPath } from './seed';
import { useCrmWorkstreamStore } from './workstreamStore';

describe('caseFile', () => {
  beforeEach(() => {
    useCrmClientsStore.getState().resetForTests();
    useCrmCasesStore.getState().resetForTests();
    useCrmDocumentsStore.getState().resetForTests();
    useCrmWorkstreamStore.getState().resetForTests();
    localStorage.clear();
    seedCrmGoldenPath({ ignoreDevGate: true });
  });

  it('exportCaseFile(c417) returns envelope + record counts (spec User Story 3 acceptance #1)', () => {
    const res = exportCaseFile('c417');
    expect('records' in res).toBe(true);
    if (!('records' in res)) return;
    expect(res.envelope.exportVersion).toBe(1);
    expect(res.envelope.caseId).toBe('c417');
    expect(res.envelope.crmSchemaVersion).toBe(CRM_SCHEMA_VERSION);
    expect(res.records.applicants).toHaveLength(2);
    expect(res.records.documents.length).toBeGreaterThanOrEqual(5);
    expect(res.records.stream.length).toBeGreaterThanOrEqual(7);
    expect(res.records.conflicts.length).toBeGreaterThanOrEqual(1);
  });

  it("exportCaseFile('nonexistent') returns typed refusal, not throw", () => {
    const res = exportCaseFile('does_not_exist');
    expect(res).toEqual({ ok: false, reason: 'unknown_case' });
  });

  it('every exported stream entry retains its full trace', () => {
    const res = exportCaseFile('c417');
    if (!('records' in res)) throw new Error('export failed');
    const withTrace = res.records.stream.filter((e) => e.trace);
    expect(withTrace.length).toBeGreaterThanOrEqual(6);
  });

  it('every exported ConflictRecord retains both values', () => {
    const res = exportCaseFile('c417');
    if (!('records' in res)) throw new Error('export failed');
    for (const c of res.records.conflicts) {
      expect(c.values.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('canonicalise sorts nested keys deterministically', () => {
    const a = { b: 2, a: 1, c: { z: 26, a: 1 } };
    const b = { c: { a: 1, z: 26 }, a: 1, b: 2 };
    expect(JSON.stringify(canonicalise(a))).toBe(
      JSON.stringify(canonicalise(b))
    );
  });
});
