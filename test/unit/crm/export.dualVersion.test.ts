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

// Journey 2 dep — the importer accepts both envelope generations and tells the
// truth about integrity. A v1 bundle carries no embedded chain, so import
// reports chainVerified null (unknown, not asserted). A v2 bundle carries the
// raw case-log, so import re-verifies from scratch: a clean chain round-trips to
// true, a tampered one to false — the flag in the envelope is never trusted on
// its word.

import {
  clearAllCrmState,
  exportCaseFile,
  exportCaseFileV2,
  importCaseFile,
  seedCrmGoldenPath,
} from '@/crm';
import { c417Log } from '@/crm/fixtures/caselog/c417Log';
import { tamperedHash } from '@/crm/fixtures/caselog/negatives';
import { foldEntries } from '@/crm/fold/caseLogFold';
import { beforeEach, describe, expect, it } from 'vitest';

const CASE = 'c417';

describe('dual-version export/import (FR-021)', () => {
  beforeEach(() => {
    clearAllCrmState();
  });

  it('v1 bundle imports with chainVerified null — no chain to trust', async () => {
    seedCrmGoldenPath({ ignoreDevGate: true });

    const v1 = exportCaseFile(CASE);
    if (!('records' in v1)) throw new Error('v1 export failed');
    expect(v1.envelope.exportVersion).toBe(1);

    clearAllCrmState();
    const result = await importCaseFile(v1);
    expect(result).toMatchObject({ ok: true, chainVerified: null });
  });

  it('v2 clean bundle round-trips with chainVerified true', async () => {
    const log = await c417Log();
    await foldEntries(CASE, log);

    const v2 = await exportCaseFileV2(CASE, log);
    if (!('records' in v2)) throw new Error('v2 export failed');
    expect(v2.envelope.exportVersion).toBe(2);
    expect(v2.envelope.chainVerified).toBe(true);

    clearAllCrmState();
    const result = await importCaseFile(v2);
    expect(result).toMatchObject({ ok: true, chainVerified: true });
  });

  it('tampered v2 bundle imports with chainVerified false — re-verified, not trusted', async () => {
    const { entries } = await tamperedHash();
    await foldEntries(CASE, entries);

    const v2 = await exportCaseFileV2(CASE, entries);
    if (!('records' in v2)) throw new Error('v2 export failed');
    // The envelope itself already reports the break; import must not merely echo
    // it but recompute the chain and independently arrive at false.
    expect(v2.envelope.chainVerified).toBe(false);

    clearAllCrmState();
    const result = await importCaseFile(v2);
    expect(result).toMatchObject({ ok: true, chainVerified: false });
  });
});
