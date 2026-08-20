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

import { getAuthEnvironmentKey } from '@/lib/authEnvironment';
import { computeSectionCompleteness, getCrmCasesStore } from './casesStore';
import {
  _internalCreatePlaceholderClient,
  getCrmClientsStore,
} from './clientsStore';
import { getCrmDocumentsStore } from './documentsStore';
import { requiredKeysForSection } from './domain/factFindSchema';
import { newCrmId } from './domain/ids';
import type {
  ActivityEvent,
  ActivityId,
  Applicant,
  CaseId,
  ClientId,
  DocumentId,
  RepairReport,
  StreamId,
  WorklistId,
} from './domain/types';
import { CRM_SCHEMA_VERSION } from './domain/types';
import { getCrmWorkstreamStore } from './workstreamStore';

function emptyReport(): RepairReport {
  return {
    ranAt: Date.now(),
    envMismatch: false,
    placeholderClientsCreated: [],
    prunedWorklist: [],
    prunedStream: [],
    prunedActivity: [],
    retargetedDocuments: [],
    recomputedCases: [],
  };
}

export function crmIntegrityRepair(): RepairReport {
  const report = emptyReport();
  const clientsStore = getCrmClientsStore();
  const casesStore = getCrmCasesStore();
  const documentsStore = getCrmDocumentsStore();
  const workstreamStore = getCrmWorkstreamStore();

  const clientsState = clientsStore.getState();
  const casesState = casesStore.getState();
  const documentsState = documentsStore.getState();
  const workstreamState = workstreamStore.getState();

  if (clientsState.storageEnvironmentKey !== getAuthEnvironmentKey()) {
    report.envMismatch = true;
  }

  // Pass 1: placeholder clients for cases whose applicants reference missing ids.
  const knownClients = new Set(Object.keys(clientsState.clientsById));
  const placeholdersToCreate: ClientId[] = [];
  for (const c of Object.values(casesState.casesById)) {
    for (const a of c.applicants) {
      if (!knownClients.has(a.clientId)) {
        placeholdersToCreate.push(a.clientId);
      }
    }
  }
  if (placeholdersToCreate.length > 0) {
    const placeholders = placeholdersToCreate.map((id) =>
      _internalCreatePlaceholderClient(id)
    );
    clientsStore.getState().upsertClients(placeholders);
    for (const id of placeholdersToCreate) {
      report.placeholderClientsCreated.push(id);
      console.warn(
        `[integrity] Created placeholder client for missing id=${id}`
      );
    }
  }

  // Pass 2: placeholder document owners.
  const refreshedClients = new Set(
    Object.keys(clientsStore.getState().clientsById)
  );
  const retargetedDocs: DocumentId[] = [];
  const orphanDocOwners: ClientId[] = [];
  for (const d of Object.values(documentsState.documentsById)) {
    if (d.owner === 'joint') continue;
    if (!refreshedClients.has(d.owner)) {
      orphanDocOwners.push(d.owner);
      retargetedDocs.push(d.id);
    }
  }
  if (orphanDocOwners.length > 0) {
    const orphanClients = orphanDocOwners.map((id) =>
      _internalCreatePlaceholderClient(id)
    );
    clientsStore.getState().upsertClients(orphanClients);
    for (const id of orphanDocOwners) {
      report.placeholderClientsCreated.push(id);
      console.warn(
        `[integrity] Created placeholder document-owner client for missing id=${id}`
      );
    }
  }
  for (const id of retargetedDocs) {
    report.retargetedDocuments.push(id);
    console.warn(`[integrity] Retargeted document ${id} to placeholder owner`);
  }

  // Pass 3: prune orphan worklist items.
  const knownCaseIds = new Set(Object.keys(casesState.casesById));
  const prunedWorklist: WorklistId[] = [];
  const nextWorklist: Record<
    WorklistId,
    (typeof workstreamState.worklistItems)[string]
  > = {};
  for (const [id, w] of Object.entries(workstreamState.worklistItems)) {
    if (!knownCaseIds.has(w.caseId)) {
      prunedWorklist.push(id);
      console.warn(
        `[integrity] Pruned orphan worklist item ${id} (caseId ${w.caseId} not found)`
      );
      continue;
    }
    nextWorklist[id] = w;
  }
  if (prunedWorklist.length > 0) {
    workstreamStore.setState({ worklistItems: nextWorklist });
    report.prunedWorklist = prunedWorklist;
  }

  // Pass 4: prune orphan stream entries and activity events.
  const prunedStream: StreamId[] = [];
  const nextStream: Record<
    CaseId,
    (typeof workstreamState.streamByCase)[string]
  > = {};
  for (const [cid, arr] of Object.entries(workstreamState.streamByCase)) {
    if (!knownCaseIds.has(cid)) {
      for (const e of arr) {
        prunedStream.push(e.id);
        console.warn(
          `[integrity] Pruned orphan stream entry ${e.id} (caseId ${cid} not found)`
        );
      }
      continue;
    }
    nextStream[cid] = arr;
  }
  if (prunedStream.length > 0) {
    workstreamStore.setState({ streamByCase: nextStream });
    report.prunedStream = prunedStream;
  }

  const prunedActivity: ActivityId[] = [];
  const nextActivity: Record<CaseId, ActivityEvent[]> = {};
  for (const [cid, arr] of Object.entries(workstreamState.activityByCase)) {
    if (!knownCaseIds.has(cid)) {
      for (const e of arr) {
        prunedActivity.push(e.id);
        console.warn(
          `[integrity] Pruned orphan activity event ${e.id} (caseId ${cid} not found)`
        );
      }
      continue;
    }
    nextActivity[cid] = arr;
  }
  if (prunedActivity.length > 0) {
    workstreamStore.setState({ activityByCase: nextActivity });
    report.prunedActivity = prunedActivity;
  }

  // Pass 5: recompute case completeness for every touched case.
  const touchedCases = new Set<CaseId>();
  for (const id of placeholdersToCreate) {
    for (const c of Object.values(casesStore.getState().casesById)) {
      if (c.applicants.some((a) => a.clientId === id)) touchedCases.add(c.id);
    }
  }
  for (const id of retargetedDocs) {
    const d = documentsState.documentsById[id];
    if (!d || d.owner === 'joint') continue;
    for (const c of Object.values(casesStore.getState().casesById)) {
      if (c.applicants.some((a) => a.clientId === d.owner)) {
        touchedCases.add(c.id);
      }
    }
  }
  if (touchedCases.size > 0) {
    const nextCases = { ...casesStore.getState().casesById };
    for (const cid of touchedCases) {
      const c = nextCases[cid];
      if (!c) continue;
      const applicants: Applicant[] = c.applicants.map((a) => {
        const nextProfile = { ...a.profile };
        for (const [sec, sectionValue] of Object.entries(a.profile)) {
          if (!sectionValue) continue;
          const keys = requiredKeysForSection(
            'employed',
            sec as never
          ) as readonly string[];
          (nextProfile as Record<string, unknown>)[sec] = {
            ...sectionValue,
            completeness: computeSectionCompleteness(sectionValue, keys),
          };
        }
        return { ...a, profile: nextProfile };
      });
      const completeness =
        applicants.length === 0
          ? 0
          : applicants.reduce((s, x) => s + x.completeness, 0) /
            applicants.length;
      nextCases[cid] = {
        ...c,
        applicants,
        completeness,
      };
      report.recomputedCases.push(cid);
    }
    casesStore.setState({ casesById: nextCases });
  }

  // Publish the report.
  workstreamStore.getState().setLastRepairReport(report);

  // Log a repair activity for any case where state was changed.
  const anyMutation =
    report.placeholderClientsCreated.length > 0 ||
    report.retargetedDocuments.length > 0 ||
    report.prunedWorklist.length > 0 ||
    report.prunedStream.length > 0 ||
    report.prunedActivity.length > 0 ||
    report.recomputedCases.length > 0 ||
    report.envMismatch;
  if (anyMutation) {
    const summary = `Placeholders:${report.placeholderClientsCreated.length} PrunedWL:${report.prunedWorklist.length} PrunedStream:${report.prunedStream.length} PrunedActivity:${report.prunedActivity.length} Recomputed:${report.recomputedCases.length}`;
    for (const cid of report.recomputedCases) {
      workstreamStore.getState().noteActivity(cid, {
        id: newCrmId('activity'),
        caseId: cid,
        kind: 'repair',
        title: 'Integrity repair ran',
        detail: summary,
        when: Date.now(),
        actor: 'system',
        schemaVersion: CRM_SCHEMA_VERSION,
      });
    }
  }

  return report;
}

export function getLastRepairReport(): RepairReport | null {
  return getCrmWorkstreamStore().getState().getLastRepairReport();
}

// Post-hydration barrier: wait a microtask for all four stores to hydrate,
// then run the single ordered repair pass.
let barrierScheduled = false;
export function scheduleIntegrityRepair(): void {
  if (barrierScheduled) return;
  barrierScheduled = true;
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(() => {
      try {
        crmIntegrityRepair();
      } catch (err) {
        console.warn('[integrity] Repair pass threw:', err);
      }
    });
  }
}
