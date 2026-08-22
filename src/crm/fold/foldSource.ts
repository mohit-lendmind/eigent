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

// FR-015, D9 — the live edge between the aion artifact store and the fold. It
// pages a Project's published artifacts, keeps only this case's log rows by a
// client-side name prefix, reads each inline, decodes it, and hands the batch
// to the deterministic fold. It never talks to the transport directly — it
// rides the same cached `aionArtifactsStore` accessors the artifact panes use,
// so a Project already open is not re-listed behind the app's back.
//
// Freshness is the fold's honesty about its own source: `no-project` when the
// case is not bound to a Project, `live` while a subscription is attached and
// refreshing, `stale` once detached, `failed` when a read throws.

import {
  loadAionArtifacts,
  readAionArtifact,
  subscribeAionArtifacts,
} from '@/store/aionArtifactsStore';
import type { CaseId, CaseLogEntry } from '../agentContracts/caseLog';
import { decodeCaseLogEntry } from '../agentContracts/caseLog';
import { getCrmCasesStore } from '../casesStore';
import { foldEntries, type FoldReport } from './caseLogFold';
import { getCrmEventLogStore, type SourceStatus } from './eventLogStore';

// Case-log artifacts are published under a per-case name prefix; a client-side
// filter is cheap and keeps the fold from ever seeing a Project's other rows.
export function caseLogArtifactPrefix(caseId: CaseId): string {
  return `lm/case/${caseId}/`;
}

// A live subscription supplies the Project id for its refreshes; fall back to
// the case's bound `aionProjectId` for a bare refreshCaseLog call.
const liveProjects = new Map<CaseId, string>();

function resolveProjectId(caseId: CaseId): string | undefined {
  return (
    liveProjects.get(caseId) ??
    getCrmCasesStore().getState().casesById[caseId]?.aionProjectId
  );
}

function setSource(caseId: CaseId, sourceStatus: SourceStatus): void {
  const store = getCrmEventLogStore().getState();
  const prior = store.freshness[caseId];
  store.setCaseFreshness(caseId, {
    lastFoldedAt: prior?.lastFoldedAt ?? 0,
    sourceStatus,
  });
}

function emptyReport(caseId: CaseId): FoldReport {
  return { caseId, applied: 0, buffered: 0, quarantined: 0, halted: null };
}

export async function refreshCaseLog(caseId: CaseId): Promise<FoldReport> {
  const projectId = resolveProjectId(caseId);
  if (!projectId) {
    setSource(caseId, 'no-project');
    return emptyReport(caseId);
  }

  const prefix = caseLogArtifactPrefix(caseId);
  const entries: CaseLogEntry[] = [];
  let truncated = 0;

  try {
    let pageToken: string | undefined;
    do {
      const page = await loadAionArtifacts(projectId, pageToken);
      for (const artifact of page.artifacts) {
        if (!artifact.name.startsWith(prefix)) continue;
        const read = await readAionArtifact(projectId, artifact.artifactId);
        if (read.truncated || read.content === undefined) {
          // content_truncated: too large to inline (or not text). It cannot be
          // placed in the chain, so account it loudly as an oversize refusal.
          truncated += 1;
          continue;
        }
        entries.push(decodeCaseLogEntry(JSON.parse(read.content)));
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
  } catch {
    setSource(caseId, 'failed');
    return emptyReport(caseId);
  }

  const report = await foldEntries(caseId, entries);

  if (truncated > 0) {
    const store = getCrmEventLogStore().getState();
    const prior = store.anomalies[caseId] ?? { duplicateSeq: 0, oversize: 0 };
    store.applyCaseFold({
      caseId,
      anomalies: {
        duplicateSeq: prior.duplicateSeq,
        oversize: prior.oversize + truncated,
      },
    });
  }

  setSource(caseId, 'live');
  return report;
}

export function attachCaseLogLiveSource(
  projectId: string,
  caseId: CaseId
): () => void {
  liveProjects.set(caseId, projectId);
  setSource(caseId, 'live');

  const unsubscribe = subscribeAionArtifacts(projectId, () => {
    void refreshCaseLog(caseId);
  });
  // Prime the projection immediately — a subscription only wakes on the NEXT
  // publish, so without this a freshly-attached case renders empty.
  void refreshCaseLog(caseId);

  return () => {
    unsubscribe();
    liveProjects.delete(caseId);
    setSource(caseId, 'stale');
  };
}
