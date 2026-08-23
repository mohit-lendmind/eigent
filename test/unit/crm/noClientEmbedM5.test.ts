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

// M5 (FR-008) — the adviser-only guarantee for criteria + affordability is
// STRUCTURAL, not UI hiding. A criteria/affordability/scenario payload carries
// surfaceClass:'adviser-only', and no component outside the adviser workspace
// (src/crm) may decode or embed one — neither a view path nor a comms/export
// path. This test scans git-tracked source for the M5 payload symbols and fails
// if any module outside the allowlist references them.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf-8',
}).trim();

// Symbols that decode or carry a full criteria/affordability/scenario payload.
// Naming one outside the adviser workspace is what an embed looks like.
const M5_SYMBOLS =
  /\b(decodeCriteriaAssessment|decodeAffordabilityAssessment|decodeScenarioRunPayload|assessCriteria|computeAffordability|CriteriaAssessment|AffordabilityAssessment|ScenarioRunPayload|assertIndicative)\b/;

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
    .filter((rel) => /^src\/.*\.(tsx|ts|jsx|js)$/.test(rel));
}

describe('no-client-embed — M5 criteria/affordability is adviser-only (FR-008)', () => {
  it('no module outside the adviser workspace references an M5 payload symbol', () => {
    const offenders: { rel: string; line: number; text: string }[] = [];
    for (const rel of trackedSource()) {
      if (ALLOWED.some((x) => x.test(rel))) continue;
      const lines = fs
        .readFileSync(path.join(repoRoot, rel), 'utf-8')
        .split('\n');
      lines.forEach((text, i) => {
        if (M5_SYMBOLS.test(text)) {
          offenders.push({ rel, line: i + 1, text: text.trim() });
        }
      });
    }
    expect(
      offenders,
      `A client-facing module embeds an M5 payload:\n${offenders
        .map((o) => `  ${o.rel}:${o.line}: ${o.text}`)
        .join('\n')}`
    ).toEqual([]);
  });

  it('the M5 payload types are stamped adviser-only at the source', () => {
    const src = fs.readFileSync(
      path.join(repoRoot, 'src/crm/agentContracts/criteriaAffordability.ts'),
      'utf-8'
    );
    expect(src).toContain("CRITERIA_SURFACE_CLASS = 'adviser-only'");
  });
});
