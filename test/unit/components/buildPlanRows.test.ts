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
  buildPlanRows,
  latestArtifactIdByName,
} from '@/components/Session/SidePanelSections/buildPlanRows';
import type { TodoState } from '@/api/aion/v1/reducer';
import { describe, expect, it } from 'vitest';

function todo(overrides: Partial<TodoState> & { todoId: string }): TodoState {
  return {
    title: overrides.todoId,
    status: 'pending',
    closed: false,
    runId: 'run-1',
    sequence: '1',
    ...overrides,
  };
}

describe('buildPlanRows', () => {
  it('returns an empty plan for no todos', () => {
    expect(buildPlanRows([])).toEqual({ rows: [], done: 0, total: 0 });
  });

  it('nests children under parents depth-first in creation order', () => {
    const { rows, done, total } = buildPlanRows([
      todo({ todoId: 'root', title: 'Research', childExecution: 'parallel' }),
      todo({ todoId: 'a', parentId: 'root', status: 'done' }),
      todo({ todoId: 'root2', title: 'Write up' }),
      todo({ todoId: 'b', parentId: 'root', status: 'in_progress' }),
    ]);
    expect(rows.map((r) => [r.todoId, r.depth])).toEqual([
      ['root', 0],
      ['a', 1],
      ['b', 1],
      ['root2', 0],
    ]);
    // The parallel badge rides the parent only — and only because it HAS
    // children; a leaf declaring an execution mode badges nothing.
    expect(rows[0].childExecution).toBe('parallel');
    expect(rows[0].hasChildren).toBe(true);
    expect(rows[1].childExecution).toBeUndefined();
    expect(done).toBe(1);
    expect(total).toBe(4);
  });

  it('renders an orphan whose parent never surfaced at the root', () => {
    const { rows } = buildPlanRows([
      todo({ todoId: 'child', parentId: 'never-seen' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].depth).toBe(0);
  });

  it('survives a parent cycle without recursing forever', () => {
    const { rows, total } = buildPlanRows([
      todo({ todoId: 'a', parentId: 'b' }),
      todo({ todoId: 'b', parentId: 'a' }),
    ]);
    // Mutually-parented rows have no root; nothing renders, nothing hangs.
    expect(total).toBe(rows.length);
  });

  it('counts done by status, not by closed — a cancelled close is not done', () => {
    const { done, total } = buildPlanRows([
      todo({ todoId: 'a', status: 'done', closed: true }),
      todo({ todoId: 'b', status: 'cancelled', closed: true }),
      todo({ todoId: 'c', status: 'in_progress' }),
    ]);
    expect(done).toBe(1);
    expect(total).toBe(3);
  });

  it('joins file evidence to artifacts by full path, then basename', () => {
    const { rows } = buildPlanRows(
      [
        todo({
          todoId: 'a',
          evidence: [
            { kind: 'file', ref: 'workspace:notes/report.md' },
            { kind: 'file', ref: 'workspace:missing.csv' },
            { kind: 'url', ref: 'https://example.com' },
          ],
        }),
      ],
      { 'notes/report.md': 'art-full', 'report.md': 'art-base' }
    );
    const [byPath, missing, url] = rows[0].evidence;
    // Full path outranks the basename so `notes/report.md` never resolves
    // to a same-named sibling published from elsewhere.
    expect(byPath).toEqual({
      kind: 'file',
      ref: 'workspace:notes/report.md',
      label: 'report.md',
      artifactId: 'art-full',
    });
    // An unresolved file ref keeps its chip, unlinked.
    expect(missing.artifactId).toBeUndefined();
    expect(missing.label).toBe('missing.csv');
    // Non-file kinds never link into the artifact viewer.
    expect(url.artifactId).toBeUndefined();
  });

  it('falls back to the basename when the full path names nothing', () => {
    const { rows } = buildPlanRows(
      [
        todo({
          todoId: 'a',
          evidence: [{ kind: 'file', ref: 'workspace:deep/dir/report.md' }],
        }),
      ],
      { 'report.md': 'art-1' }
    );
    expect(rows[0].evidence[0].artifactId).toBe('art-1');
  });
});

describe('latestArtifactIdByName', () => {
  it('keeps the newest version per name and skips unnamed rows', () => {
    expect(
      latestArtifactIdByName({
        'art-1': { name: 'report.md', version: 1 },
        'art-2': { name: 'report.md', version: 2 },
        'art-3': { name: 'other.md', version: 1 },
        'art-4': { media_type: 'text/plain' },
      })
    ).toEqual({ 'report.md': 'art-2', 'other.md': 'art-3' });
  });
});
