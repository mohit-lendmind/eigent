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

import type { TodoState } from '@/api/aion/v1/reducer';

/**
 * One evidence reference rendered as a chip on a plan row. `artifactId` is
 * set when the ref resolved to a published artifact, making the chip a link
 * into the artifact viewer; unresolved refs render as inert labels rather
 * than being dropped — the agent's claim of evidence is content even when
 * the join misses.
 */
export interface PlanEvidenceLink {
  kind: string;
  ref: string;
  /** Display name: the ref with any `scheme:` prefix and directories stripped. */
  label: string;
  artifactId?: string;
}

export interface PlanRow {
  todoId: string;
  title: string;
  /** Verbatim engine status (`pending`, `in_progress`, `done`, ...). */
  status: string;
  closed: boolean;
  /** Tree depth: 0 for roots and for orphans whose parent never surfaced. */
  depth: number;
  hasChildren: boolean;
  /** `parallel` / `sequential` — badged on parents only; other values omitted. */
  childExecution?: string;
  assignee?: string;
  evidence: PlanEvidenceLink[];
}

export interface PlanRows {
  rows: PlanRow[];
  /** Rows whose status is `done` — a todo closed as cancelled is not done. */
  done: number;
  total: number;
}

/**
 * Flattens the todo map into depth-first render rows. Sibling order is the
 * input order (the reducer keys `todos` in creation order); a child whose
 * parent id names a todo that never surfaced renders at the root rather than
 * disappearing — a late-joining consumer may materialize children before
 * their parent's own event arrives.
 *
 * Pure and store-independent (the `buildContextItems` discipline) so the
 * tree shape unit-tests without the DOM.
 */
export function buildPlanRows(
  todos: TodoState[],
  artifactIdByName: Record<string, string> = {}
): PlanRows {
  const ids = new Set(todos.map((t) => t.todoId));
  const childrenOf = new Map<string, TodoState[]>();
  const roots: TodoState[] = [];
  for (const todo of todos) {
    const parent = todo.parentId;
    if (parent && ids.has(parent) && parent !== todo.todoId) {
      const siblings = childrenOf.get(parent) ?? [];
      siblings.push(todo);
      childrenOf.set(parent, siblings);
    } else {
      roots.push(todo);
    }
  }

  const rows: PlanRow[] = [];
  const walk = (todo: TodoState, depth: number, seen: Set<string>) => {
    // A parent cycle would recurse forever; each id renders at most once.
    if (seen.has(todo.todoId)) return;
    seen.add(todo.todoId);
    const children = childrenOf.get(todo.todoId) ?? [];
    const childExecution =
      children.length > 0 &&
      (todo.childExecution === 'parallel' ||
        todo.childExecution === 'sequential')
        ? todo.childExecution
        : undefined;
    rows.push({
      todoId: todo.todoId,
      title: todo.title,
      status: todo.status,
      closed: todo.closed,
      depth,
      hasChildren: children.length > 0,
      childExecution,
      assignee: todo.assignee,
      evidence: (todo.evidence ?? []).map((e) => {
        const path = evidencePath(e.ref);
        const label = path.split('/').filter(Boolean).at(-1) ?? path;
        return {
          kind: e.kind,
          ref: e.ref,
          label,
          artifactId:
            e.kind === 'file' || e.kind === 'file_store_id'
              ? // Emitters publish under the rel path's own name; try the
                // full path first so `notes/report.md` beats a same-named
                // sibling, then the basename.
                (artifactIdByName[path] ?? artifactIdByName[label])
              : undefined,
        };
      }),
    });
    for (const child of children) walk(child, depth + 1, seen);
  };
  const seen = new Set<string>();
  for (const root of roots) walk(root, 0, seen);

  return {
    rows,
    done: rows.filter((r) => r.status === 'done').length,
    total: rows.length,
  };
}

/** `workspace:notes/report.md` → `notes/report.md` (scheme stripped). */
function evidencePath(ref: string): string {
  return ref.includes(':') ? ref.slice(ref.indexOf(':') + 1) : ref;
}

/**
 * Name → the artifact id of its newest published version, from the reducer's
 * raw artifact bank. Newest wins by `version`; frames and image captures are
 * plan evidence as much as documents are, so nothing is filtered here beyond
 * rows missing an id or name.
 */
export function latestArtifactIdByName(
  artifacts: Record<string, Record<string, unknown>>
): Record<string, string> {
  const best = new Map<string, { id: string; version: number }>();
  for (const [id, artifact] of Object.entries(artifacts)) {
    const name = typeof artifact.name === 'string' ? artifact.name : '';
    if (!name) continue;
    const version =
      typeof artifact.version === 'number' ? artifact.version : 0;
    const prev = best.get(name);
    if (!prev || version >= prev.version) best.set(name, { id, version });
  }
  const out: Record<string, string> = {};
  for (const [name, { id }] of best) out[name] = id;
  return out;
}
