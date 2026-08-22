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

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function readSrc(file: string): string {
  return readFileSync(path.resolve(ROOT, 'src/crm', file), 'utf8');
}

describe('cross-store import direction (FR-014)', () => {
  it('clientsStore does not statically import cases/documents/workstream', () => {
    const src = readSrc('clientsStore.ts');
    expect(src).not.toMatch(/from ['"]\.\/casesStore['"]/);
    expect(src).not.toMatch(/from ['"]\.\/documentsStore['"]/);
    expect(src).not.toMatch(/from ['"]\.\/workstreamStore['"]/);
  });

  it('casesStore does not statically import documents/workstream', () => {
    const src = readSrc('casesStore.ts');
    expect(src).not.toMatch(/from ['"]\.\/documentsStore['"]/);
    expect(src).not.toMatch(/from ['"]\.\/workstreamStore['"]/);
  });

  it('documentsStore does not statically import workstream', () => {
    const src = readSrc('documentsStore.ts');
    expect(src).not.toMatch(/from ['"]\.\/workstreamStore['"]/);
  });
});

describe('fold seam direction (FR-018)', () => {
  const baseStores = [
    'clientsStore.ts',
    'casesStore.ts',
    'documentsStore.ts',
    'workstreamStore.ts',
  ];

  for (const store of baseStores) {
    it(`${store} does not statically import the fold`, () => {
      const src = readSrc(store);
      expect(src).not.toMatch(/from ['"]\.\/fold\//);
      expect(src).not.toMatch(/from ['"]@\/crm\/fold\//);
    });
  }
});
