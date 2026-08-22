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
  clearAllCrmState,
  exportCaseFile,
  importCaseFile,
  seedCrmGoldenPath,
  selectNeedsYouCount,
  selectPipelineCounts,
  useCrmCasesStore,
  useCrmClientsStore,
  useCrmDocumentsStore,
  useCrmWorkstreamStore,
} from '@/crm';
import { canonicalise } from '@/crm/caseFile';
import { beforeEach, describe, expect, it } from 'vitest';

// Journey C — Export and wipe for compliance lifecycle.
describe('Journey C — export → wipe → import round-trip', () => {
  beforeEach(() => {
    useCrmClientsStore.getState().resetForTests();
    useCrmCasesStore.getState().resetForTests();
    useCrmDocumentsStore.getState().resetForTests();
    useCrmWorkstreamStore.getState().resetForTests();
    localStorage.clear();
    seedCrmGoldenPath({ ignoreDevGate: true });
  });

  it('seed → export1 → clear → import → export2 → byte-equal', async () => {
    const export1 = exportCaseFile('c417');
    if (!('records' in export1)) throw new Error('export1 failed');
    clearAllCrmState();
    expect(Object.keys(useCrmCasesStore.getState().casesById).length).toBe(0);

    const importResult = await importCaseFile(export1);
    expect(importResult).toMatchObject({ ok: true, chainVerified: null });

    const export2 = exportCaseFile('c417');
    if (!('records' in export2)) throw new Error('export2 failed');

    // exportedAt varies — normalize before compare.
    const norm1 = canonicalise({
      ...export1,
      envelope: { ...export1.envelope, exportedAt: 0 },
    });
    const norm2 = canonicalise({
      ...export2,
      envelope: { ...export2.envelope, exportedAt: 0 },
    });
    expect(JSON.stringify(norm1)).toBe(JSON.stringify(norm2));
  });

  it('post-import selectors reproduce the design counts', async () => {
    const exportResult = exportCaseFile('c417');
    if (!('records' in exportResult)) throw new Error('export failed');
    clearAllCrmState();
    await importCaseFile(exportResult);

    expect(
      selectNeedsYouCount(useCrmWorkstreamStore.getState().worklistItems)
    ).toBeGreaterThanOrEqual(4);
    const counts = selectPipelineCounts(useCrmCasesStore.getState().casesById);
    expect(counts.DIP).toBeGreaterThanOrEqual(1);
  });

  it('second import without wipe fails with id_collision', async () => {
    const exportResult = exportCaseFile('c417');
    if (!('records' in exportResult)) throw new Error('export failed');
    const second = await importCaseFile(exportResult);
    expect(second).toMatchObject({ ok: false, reason: 'id_collision' });
  });
});
