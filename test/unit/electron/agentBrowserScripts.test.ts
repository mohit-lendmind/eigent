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

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  consoleHookScript,
  consoleReadScript,
  focusAndClearScript,
  focusAndClearTemplate,
  refRectScript,
  refRectTemplate,
  selectScript,
  selectTemplate,
  snapshotScript,
} from '../../../electron/main/agentBrowserScripts';

// The vendored copy of aion's cmd/aion-browserctl/js.go. Updating it (to
// resync with a pod-side script change) fails the hash pin below, forcing a
// conscious re-copy into agentBrowserScripts.ts — the two must move together
// or delegated actions stop behaving like their pod twins.
const FIXTURE_PATH = resolve(
  __dirname,
  '../../fixtures/aion/browserctl/js.go'
);
const FIXTURE_SHA256 =
  '30d6221327157b1b4fee3b8a12fd88d9d04977d55673e0fde08b0a0e853ec0a6';

const fixture = readFileSync(FIXTURE_PATH, 'utf8');

function goLiteral(constName: string): string {
  const match = fixture.match(
    new RegExp('const ' + constName + ' = `([^`]*)`')
  );
  if (!match) throw new Error(`const ${constName} not found in js.go fixture`);
  return match[1];
}

describe('agentBrowserScripts js.go parity', () => {
  it('pins the vendored js.go fixture byte-for-byte', () => {
    const hash = createHash('sha256').update(fixture, 'utf8').digest('hex');
    expect(hash).toBe(FIXTURE_SHA256);
  });

  it.each([
    ['consoleHookJS', consoleHookScript],
    ['snapshotJS', snapshotScript],
    ['refRectJS', refRectTemplate],
    ['focusAndClearJS', focusAndClearTemplate],
    ['selectJS', selectTemplate],
    ['consoleReadJS', consoleReadScript],
  ])('matches the %s literal exactly', (goName, tsValue) => {
    expect(tsValue).toBe(goLiteral(goName as string));
  });

  it('substitutes %q markers the way Go fmt does', () => {
    expect(refRectScript('e9')).toBe(
      refRectTemplate.replace('%q', '"e9"')
    );
    expect(focusAndClearScript('e12').endsWith('})("e12")')).toBe(true);
    const twoArg = selectScript('e3', 'United "Kingdom"');
    expect(twoArg.endsWith('})("e3", "United \\"Kingdom\\"")')).toBe(true);
    expect(twoArg).not.toContain('%q');
  });
});
