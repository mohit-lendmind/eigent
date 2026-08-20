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

import { EMPTY_ARRAY } from './domain/emptyConstants';
import { STAGES } from './domain/stages';
import type {
  Applicant,
  Case,
  CaseId,
  ConflictRecord,
  RetentionEntry,
  Stage,
  StreamEntry,
  WorklistItem,
} from './domain/types';

const EMPTY_STREAM_SECTIONS = Object.freeze({
  live: EMPTY_ARRAY as readonly StreamEntry[],
  needsYou: EMPTY_ARRAY as readonly StreamEntry[],
  directives: EMPTY_ARRAY as readonly StreamEntry[],
  activity: EMPTY_ARRAY as readonly StreamEntry[],
});

export function selectNeedsYou(
  worklistItems: Record<string, WorklistItem>
): WorklistItem[] {
  const open: WorklistItem[] = [];
  for (const it of Object.values(worklistItems)) {
    if (it.status === 'open') open.push(it);
  }
  if (open.length === 0) return EMPTY_ARRAY as unknown as WorklistItem[];
  return open.sort((a, b) => a.createdAt - b.createdAt);
}

export function selectNeedsYouCount(
  worklistItems: Record<string, WorklistItem>
): number {
  let n = 0;
  for (const it of Object.values(worklistItems)) {
    if (it.status === 'open') n += 1;
  }
  return n;
}

export function selectPipelineCounts(
  cases: Record<CaseId, Case>
): Record<Stage, number> {
  const out: Record<Stage, number> = {
    LEAD: 0,
    FACT_FIND: 0,
    SOURCING: 0,
    DIP: 0,
    APPLICATION: 0,
    VALUATION: 0,
    OFFER: 0,
    COMPLETION: 0,
  };
  for (const c of Object.values(cases)) {
    out[c.stage] += 1;
  }
  return out;
}

export function selectOpenConflicts(
  conflicts: Record<string, ConflictRecord>
): ConflictRecord[] {
  const open: ConflictRecord[] = [];
  for (const c of Object.values(conflicts)) {
    if (!c.resolvedAt) open.push(c);
  }
  if (open.length === 0) return EMPTY_ARRAY as unknown as ConflictRecord[];
  return open;
}

export function selectRetentionUrgency(
  entries: readonly RetentionEntry[],
  _now: number = Date.now()
): RetentionEntry[] {
  if (entries.length === 0) return EMPTY_ARRAY as unknown as RetentionEntry[];
  return [...entries].sort((a, b) => a.daysLeft - b.daysLeft);
}

export interface CaseStreamSections {
  live: readonly StreamEntry[];
  needsYou: readonly StreamEntry[];
  directives: readonly StreamEntry[];
  activity: readonly StreamEntry[];
}

export function selectCaseStreamSections(
  stream: readonly StreamEntry[] | undefined
): CaseStreamSections {
  if (!stream || stream.length === 0) return EMPTY_STREAM_SECTIONS;
  const live: StreamEntry[] = [];
  const needsYou: StreamEntry[] = [];
  const directives: StreamEntry[] = [];
  const activity: StreamEntry[] = [];
  for (const e of stream) {
    if (e.kind === 'live') live.push(e);
    else if (
      e.kind === 'conflict' ||
      e.kind === 'approval' ||
      e.kind === 'blocked'
    )
      needsYou.push(e);
    else if (e.kind === 'intent' || e.kind === 'directive') directives.push(e);
    else activity.push(e);
  }
  live.sort((a, b) => (a.pinned ? -1 : b.pinned ? 1 : b.when - a.when));
  return {
    live,
    needsYou,
    directives,
    activity,
  };
}

export interface DetSynCounts {
  det: number;
  syn: number;
  awaiting: number;
}

export function selectDetSynCounts(applicant: Applicant): DetSynCounts {
  let det = 0;
  let syn = 0;
  let awaiting = 0;
  for (const sec of Object.values(applicant.profile)) {
    if (!sec) continue;
    for (const f of sec.fields) {
      if (f.src === 'det') det += 1;
      else if (f.confirmedAt) det += 1;
      else {
        syn += 1;
        if (f.flag || f.conflictId) awaiting += 1;
      }
    }
  }
  return { det, syn, awaiting };
}

export function selectCaseCompleteness(
  caseId: CaseId,
  cases: Record<CaseId, Case>
): number {
  const c = cases[caseId];
  if (!c) return 0;
  return c.completeness;
}

export const STAGE_ORDER = STAGES.map((s) => s.key);
