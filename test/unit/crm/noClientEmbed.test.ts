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

// M4 (FR-007) — the adviser-only guarantee is STRUCTURAL, not UI hiding. A
// sourcing snapshot carries surfaceClass:'adviser-only', and no component
// outside the adviser workspace (src/crm) may decode or embed one. This test
// scans git-tracked source for the sourcing-snapshot symbols and fails if any
// module outside the allowlist references them — so a client-facing surface
// cannot grow a snapshot embed even by accident.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf-8',
}).trim();

// Symbols that decode or carry a full sourcing snapshot / result set. Naming one
// is what an embed looks like.
const SNAPSHOT_SYMBOLS =
  /\b(decodeSourcingSnapshotPayload|decodeSourcingProductsAttachment|SourcingSnapshotPayload|exportEvidenceOfResearch|SourcingResults)\b/;

// The adviser workspace + non-shipping paths. Everything under src/crm is the
// adviser-only surface; tests/specs/scripts do not ship to a client.
const ALLOWED = [/^src\/crm\//, /^test\//, /^specs\//, /^scripts\//];

function trackedSource(): string[] {
  return execFileSync('git', ['ls-files', '-z'], {
    encoding: 'utf-8',
    cwd: repoRoot,
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean)
    .filter((rel) => /^src\/.*\.(ts|tsx|js|jsx)$/.test(rel));
}

describe('no-client-embed — a sourcing snapshot is adviser-only (FR-007)', () => {
  it('no module outside the adviser workspace references a snapshot symbol', () => {
    const offenders: { rel: string; line: number; text: string }[] = [];
    for (const rel of trackedSource()) {
      if (ALLOWED.some((x) => x.test(rel))) continue;
      const lines = fs
        .readFileSync(path.join(repoRoot, rel), 'utf-8')
        .split('\n');
      lines.forEach((text, i) => {
        if (SNAPSHOT_SYMBOLS.test(text)) {
          offenders.push({ rel, line: i + 1, text: text.trim() });
        }
      });
    }
    expect(
      offenders,
      `A client-facing module embeds a sourcing snapshot:\n${offenders
        .map((o) => `  ${o.rel}:${o.line}: ${o.text}`)
        .join('\n')}`
    ).toEqual([]);
  });

  it('the snapshot type is stamped adviser-only at the source', () => {
    const src = fs.readFileSync(
      path.join(repoRoot, 'src/crm/agentContracts/sourcingSnapshot.ts'),
      'utf-8'
    );
    expect(src).toContain("SOURCING_SURFACE_CLASS = 'adviser-only'");
  });
});
