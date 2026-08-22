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

import { CRM_CASES_STORE_KEY, getCrmCasesStore } from './casesStore';
import { CRM_CLIENTS_STORE_KEY, getCrmClientsStore } from './clientsStore';
import {
  CRM_DOCUMENTS_STORE_KEY,
  getCrmDocumentsStore,
} from './documentsStore';
import {
  CRM_SCHEMA_VERSION,
  type CaseFileExport,
  type CaseId,
} from './domain/types';
import {
  CRM_EVENTLOG_STORE_KEY,
  getCrmEventLogStore,
} from './fold/eventLogStore';
import {
  CRM_WORKSTREAM_STORE_KEY,
  getCrmWorkstreamStore,
} from './workstreamStore';

export type ExportFailure =
  { ok: false; reason: 'unknown_case' } | { ok: false; reason: 'no_case_id' };

export type ImportFailure =
  | {
      ok: false;
      reason: 'envelope_incompatible';
      got: number;
      expected: number;
    }
  | { ok: false; reason: 'id_collision'; ids: string[] };

export type ImportSuccess = {
  ok: true;
  imported: {
    cases: number;
    clients: number;
    documents: number;
    workstream: number;
  };
};

export function exportCaseFile(caseId: CaseId): CaseFileExport | ExportFailure {
  if (!caseId) return { ok: false, reason: 'no_case_id' };
  const cases = getCrmCasesStore().getState();
  const clients = getCrmClientsStore().getState();
  const docs = getCrmDocumentsStore().getState();
  const ws = getCrmWorkstreamStore().getState();

  const c = cases.casesById[caseId];
  if (!c) return { ok: false, reason: 'unknown_case' };

  const applicantClientIds = new Set(c.applicants.map((a) => a.clientId));

  const referencedClients = Object.values(clients.clientsById).filter((cl) =>
    applicantClientIds.has(cl.id)
  );

  const documents = Object.values(docs.documentsById).filter((d) =>
    d.owner === 'joint' ? d.joint : applicantClientIds.has(d.owner)
  );

  const checklist = Object.entries(docs.checklistByOwner).flatMap(
    ([owner, items]) =>
      applicantClientIds.has(owner) || owner === 'joint' ? items : []
  );

  const worklist = Object.values(ws.worklistItems).filter(
    (w) => w.caseId === caseId
  );

  const stream = ws.streamByCase[caseId] ?? [];
  const activity = ws.activityByCase[caseId] ?? [];

  const criteria = cases.criteriaByCase[caseId] ?? [];
  const products = cases.productsByCase[caseId] ?? [];
  const compliance = cases.complianceByCase[caseId] ?? null;

  const conflicts = Object.values(cases.conflictsById).filter(
    (r) => r.caseId === caseId
  );

  const fieldChangeEvents = ws.fieldChangeEvents.filter(
    (e) => e.caseId === caseId
  );

  const retention = ws.retentionEntries.filter((r) =>
    applicantClientIds.has(r.clientId)
  );

  return {
    envelope: {
      exportVersion: 1,
      exportedAt: Date.now(),
      crmSchemaVersion: CRM_SCHEMA_VERSION,
      caseId,
    },
    records: {
      case: c,
      clients: referencedClients,
      applicants: c.applicants,
      documents,
      checklist,
      worklist,
      stream,
      activity,
      criteria,
      products,
      retention,
      compliance,
      conflicts,
      fieldChangeEvents,
    },
  };
}

export function importCaseFile(
  bundle: CaseFileExport
): ImportSuccess | ImportFailure {
  if (bundle.envelope.exportVersion !== 1) {
    return {
      ok: false,
      reason: 'envelope_incompatible',
      got: bundle.envelope.exportVersion,
      expected: 1,
    };
  }
  const cases = getCrmCasesStore();
  const clients = getCrmClientsStore();
  const docs = getCrmDocumentsStore();
  const ws = getCrmWorkstreamStore();

  const collisions: string[] = [];
  const clientsState = clients.getState();
  const casesState = cases.getState();
  const docsState = docs.getState();
  const wsState = ws.getState();
  for (const cl of bundle.records.clients) {
    if (clientsState.clientsById[cl.id]) collisions.push(cl.id);
  }
  if (casesState.casesById[bundle.records.case.id]) {
    collisions.push(bundle.records.case.id);
  }
  for (const d of bundle.records.documents) {
    if (docsState.documentsById[d.id]) collisions.push(d.id);
  }
  for (const c of bundle.records.conflicts) {
    if (casesState.conflictsById[c.id]) collisions.push(c.id);
  }
  for (const w of bundle.records.worklist) {
    if (wsState.worklistItems[w.id]) collisions.push(w.id);
  }
  const existingEventIds = new Set(wsState.fieldChangeEvents.map((e) => e.id));
  for (const e of bundle.records.fieldChangeEvents) {
    if (existingEventIds.has(e.id)) collisions.push(e.id);
  }
  const existingStreamIds = new Set<string>();
  for (const arr of Object.values(wsState.streamByCase)) {
    for (const e of arr) existingStreamIds.add(e.id);
  }
  for (const e of bundle.records.stream) {
    if (existingStreamIds.has(e.id)) collisions.push(e.id);
  }
  const existingActivityIds = new Set<string>();
  for (const arr of Object.values(wsState.activityByCase)) {
    for (const e of arr) existingActivityIds.add(e.id);
  }
  for (const e of bundle.records.activity) {
    if (existingActivityIds.has(e.id)) collisions.push(e.id);
  }
  if (collisions.length > 0) {
    return { ok: false, reason: 'id_collision', ids: collisions };
  }

  // Single setState per store.
  clients.setState((state) => {
    const next = { ...state.clientsById };
    for (const cl of bundle.records.clients) {
      next[cl.id] = cl;
    }
    return { clientsById: next };
  });

  cases.setState((state) => {
    const nextCases = { ...state.casesById };
    nextCases[bundle.records.case.id] = bundle.records.case;
    const nextConflicts = { ...state.conflictsById };
    for (const c of bundle.records.conflicts) nextConflicts[c.id] = c;
    const nextCriteria = { ...state.criteriaByCase };
    nextCriteria[bundle.records.case.id] = bundle.records.criteria;
    const nextProducts = { ...state.productsByCase };
    nextProducts[bundle.records.case.id] = bundle.records.products;
    const nextCompliance = { ...state.complianceByCase };
    if (bundle.records.compliance) {
      nextCompliance[bundle.records.case.id] = bundle.records.compliance;
    }
    return {
      casesById: nextCases,
      conflictsById: nextConflicts,
      criteriaByCase: nextCriteria,
      productsByCase: nextProducts,
      complianceByCase: nextCompliance,
    };
  });

  docs.setState((state) => {
    const nextDocs = { ...state.documentsById };
    for (const d of bundle.records.documents) nextDocs[d.id] = d;
    const nextChecklist = { ...state.checklistByOwner };
    for (const item of bundle.records.checklist) {
      const arr = nextChecklist[item.owner] ?? [];
      const idx = arr.findIndex((x) => x.itemKey === item.itemKey);
      nextChecklist[item.owner] =
        idx >= 0 ? arr.map((x, i) => (i === idx ? item : x)) : [...arr, item];
    }
    return { documentsById: nextDocs, checklistByOwner: nextChecklist };
  });

  ws.setState((state) => {
    const nextWorklist = { ...state.worklistItems };
    for (const w of bundle.records.worklist) nextWorklist[w.id] = w;
    const nextStream = {
      ...state.streamByCase,
      [bundle.records.case.id]: bundle.records.stream,
    };
    const nextActivity = {
      ...state.activityByCase,
      [bundle.records.case.id]: bundle.records.activity,
    };
    const nextRetention = [...state.retentionEntries];
    for (const r of bundle.records.retention) {
      const idx = nextRetention.findIndex(
        (x) => x.clientId === r.clientId && x.endsAt === r.endsAt
      );
      if (idx >= 0) nextRetention[idx] = r;
      else nextRetention.push(r);
    }
    return {
      worklistItems: nextWorklist,
      streamByCase: nextStream,
      activityByCase: nextActivity,
      retentionEntries: nextRetention,
      fieldChangeEvents: [
        ...state.fieldChangeEvents,
        ...bundle.records.fieldChangeEvents,
      ],
    };
  });

  return {
    ok: true,
    imported: {
      cases: 1,
      clients: bundle.records.clients.length,
      documents: bundle.records.documents.length,
      workstream:
        bundle.records.worklist.length +
        bundle.records.stream.length +
        bundle.records.activity.length,
    },
  };
}

const CRM_LS_KEYS = [
  CRM_CLIENTS_STORE_KEY,
  CRM_CASES_STORE_KEY,
  CRM_DOCUMENTS_STORE_KEY,
  CRM_WORKSTREAM_STORE_KEY,
  CRM_EVENTLOG_STORE_KEY,
];

export function clearAllCrmState(): void {
  getCrmClientsStore().getState().resetForTests();
  getCrmCasesStore().getState().resetForTests();
  getCrmDocumentsStore().getState().resetForTests();
  getCrmWorkstreamStore().getState().resetForTests();
  getCrmEventLogStore().getState().resetForTests();
  if (typeof localStorage !== 'undefined') {
    for (const key of CRM_LS_KEYS) {
      localStorage.removeItem(key);
    }
  }
}

// Deterministic recursive key-sort for byte-equal round-trip checks (SC-003).
export function canonicalise<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((v) => canonicalise(v)) as unknown as T;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    out[k] = canonicalise((value as Record<string, unknown>)[k]);
  }
  return out as unknown as T;
}
