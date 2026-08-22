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

import type { CaseLogEntry, DecimalSeq } from './agentContracts/caseLog';
import {
  FIRM_CONFIG_DEFAULTS,
  type FirmConfig,
} from './agentContracts/firmConfig';
import { GATE_REGISTRY, type GateDescriptor } from './agentContracts/gates';
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
import { CRM_FIRM_STORE_KEY, getCrmFirmStore } from './firmStore';
import { CONTRACTS_VERSION } from './fold/caseLogFold';
import {
  CRM_EVENTLOG_STORE_KEY,
  getCrmEventLogStore,
} from './fold/eventLogStore';
import { verifyChain } from './hashChain';
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
  // v1 bundles carry no chain to check → null ("not verifiable"). v2 bundles
  // are re-verified from their embedded case-log before this flag is trusted.
  chainVerified: boolean | null;
};

// ---- Export v2 (FR-021) — a tamper-evident compliance envelope. ------------
export interface CaseFileExportEnvelopeV2 {
  exportVersion: 2;
  exportedAt: number;
  crmSchemaVersion: number;
  contractsVersion: number;
  caseId: CaseId;
  firmId: string;
  chainHead: { seq: DecimalSeq; hash: string } | null;
  chainVerified: boolean;
  artifactManifest: readonly {
    name: string;
    artifactId: string;
    version: number;
    sha256: string;
  }[];
  gatePolicySnapshot: {
    registry: readonly GateDescriptor[];
    delegationRoster: readonly unknown[];
  };
  versionsStamp: Record<string, string>;
}

export interface CaseFileExportV2 {
  envelope: CaseFileExportEnvelopeV2;
  records: CaseFileExport['records'] & {
    caseLogEntries: readonly CaseLogEntry[];
    outboxUnflushed: readonly unknown[];
    quarantine: readonly unknown[];
    quarantineTombstones: readonly { hash: string; kind: string; at: number }[];
  };
}

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

function bySeq(a: CaseLogEntry, b: CaseLogEntry): number {
  const da = BigInt(a.seq);
  const db = BigInt(b.seq);
  return da < db ? -1 : da > db ? 1 : 0;
}

// The v2 envelope is a compliance snapshot: it re-verifies the case's chain from
// the entries handed in (the same array the fold consumed, freshly re-read from
// the artifact store), stamps the verified tip, and folds in the gate policy and
// version provenance a reviewer needs to trust it. The raw entries + unflushed
// outbox + quarantine ride along so the export is self-contained.
export async function exportCaseFileV2(
  caseId: CaseId,
  entries: readonly CaseLogEntry[],
  options: { firmConfig?: FirmConfig } = {}
): Promise<CaseFileExportV2 | ExportFailure> {
  const v1 = exportCaseFile(caseId);
  if (!('records' in v1)) return v1;

  const ordered = [...entries].sort(bySeq);
  const verify = await verifyChain(ordered);
  const log = getCrmEventLogStore().getState();
  const head = ordered[ordered.length - 1];
  const delegationRoster =
    options.firmConfig?.delegationRoster ??
    FIRM_CONFIG_DEFAULTS.delegationRoster ??
    [];

  const envelope: CaseFileExportEnvelopeV2 = {
    exportVersion: 2,
    exportedAt: Date.now(),
    crmSchemaVersion: CRM_SCHEMA_VERSION,
    contractsVersion: CONTRACTS_VERSION,
    caseId,
    firmId: head?.firmId ?? options.firmConfig?.firmId ?? '',
    chainHead: log.chainHeads[caseId] ?? null,
    chainVerified: verify.ok,
    artifactManifest: ordered.map((e) => ({
      name: `lm/case/${caseId}/${e.seq}`,
      artifactId: e.origin.artifactId,
      version: 1,
      sha256: e.hash,
    })),
    gatePolicySnapshot: { registry: GATE_REGISTRY, delegationRoster },
    versionsStamp: head ? ({ ...head.versions } as Record<string, string>) : {},
  };

  return {
    envelope,
    records: {
      ...v1.records,
      caseLogEntries: ordered,
      outboxUnflushed: log.outbox.filter(
        (r) => r.caseId === caseId && r.state !== 'settled'
      ),
      quarantine: log.quarantine.filter((r) => r.caseId === caseId),
      quarantineTombstones: log.quarantineTombstones,
    },
  };
}

export async function importCaseFile(
  bundle: CaseFileExport | CaseFileExportV2
): Promise<ImportSuccess | ImportFailure> {
  const exportVersion = bundle.envelope.exportVersion;
  if (exportVersion !== 1 && exportVersion !== 2) {
    return {
      ok: false,
      reason: 'envelope_incompatible',
      got: exportVersion,
      expected: 1,
    };
  }
  // v2 records are a structural superset of v1 (the v1 records are spread in at
  // export), so the collision scan and apply below read them as v1-shaped.
  const v1Records = bundle.records as CaseFileExport['records'];
  const cases = getCrmCasesStore();
  const clients = getCrmClientsStore();
  const docs = getCrmDocumentsStore();
  const ws = getCrmWorkstreamStore();

  const collisions: string[] = [];
  const clientsState = clients.getState();
  const casesState = cases.getState();
  const docsState = docs.getState();
  const wsState = ws.getState();
  for (const cl of v1Records.clients) {
    if (clientsState.clientsById[cl.id]) collisions.push(cl.id);
  }
  if (casesState.casesById[v1Records.case.id]) {
    collisions.push(v1Records.case.id);
  }
  for (const d of v1Records.documents) {
    if (docsState.documentsById[d.id]) collisions.push(d.id);
  }
  for (const c of v1Records.conflicts) {
    if (casesState.conflictsById[c.id]) collisions.push(c.id);
  }
  for (const w of v1Records.worklist) {
    if (wsState.worklistItems[w.id]) collisions.push(w.id);
  }
  const existingEventIds = new Set(wsState.fieldChangeEvents.map((e) => e.id));
  for (const e of v1Records.fieldChangeEvents) {
    if (existingEventIds.has(e.id)) collisions.push(e.id);
  }
  const existingStreamIds = new Set<string>();
  for (const arr of Object.values(wsState.streamByCase)) {
    for (const e of arr) existingStreamIds.add(e.id);
  }
  for (const e of v1Records.stream) {
    if (existingStreamIds.has(e.id)) collisions.push(e.id);
  }
  const existingActivityIds = new Set<string>();
  for (const arr of Object.values(wsState.activityByCase)) {
    for (const e of arr) existingActivityIds.add(e.id);
  }
  for (const e of v1Records.activity) {
    if (existingActivityIds.has(e.id)) collisions.push(e.id);
  }
  if (collisions.length > 0) {
    return { ok: false, reason: 'id_collision', ids: collisions };
  }

  // Single setState per store.
  clients.setState((state) => {
    const next = { ...state.clientsById };
    for (const cl of v1Records.clients) {
      next[cl.id] = cl;
    }
    return { clientsById: next };
  });

  cases.setState((state) => {
    const nextCases = { ...state.casesById };
    nextCases[v1Records.case.id] = v1Records.case;
    const nextConflicts = { ...state.conflictsById };
    for (const c of v1Records.conflicts) nextConflicts[c.id] = c;
    const nextCriteria = { ...state.criteriaByCase };
    nextCriteria[v1Records.case.id] = v1Records.criteria;
    const nextProducts = { ...state.productsByCase };
    nextProducts[v1Records.case.id] = v1Records.products;
    const nextCompliance = { ...state.complianceByCase };
    if (v1Records.compliance) {
      nextCompliance[v1Records.case.id] = v1Records.compliance;
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
    for (const d of v1Records.documents) nextDocs[d.id] = d;
    const nextChecklist = { ...state.checklistByOwner };
    for (const item of v1Records.checklist) {
      const arr = nextChecklist[item.owner] ?? [];
      const idx = arr.findIndex((x) => x.itemKey === item.itemKey);
      nextChecklist[item.owner] =
        idx >= 0 ? arr.map((x, i) => (i === idx ? item : x)) : [...arr, item];
    }
    return { documentsById: nextDocs, checklistByOwner: nextChecklist };
  });

  ws.setState((state) => {
    const nextWorklist = { ...state.worklistItems };
    for (const w of v1Records.worklist) nextWorklist[w.id] = w;
    const nextStream = {
      ...state.streamByCase,
      [v1Records.case.id]: v1Records.stream,
    };
    const nextActivity = {
      ...state.activityByCase,
      [v1Records.case.id]: v1Records.activity,
    };
    const nextRetention = [...state.retentionEntries];
    for (const r of v1Records.retention) {
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
        ...v1Records.fieldChangeEvents,
      ],
    };
  });

  // v1 carries no chain → null ("not verifiable"). v2 is re-verified from its
  // embedded case-log before its chainVerified claim is trusted (FR-021).
  let chainVerified: boolean | null = null;
  if (exportVersion === 2) {
    const verify = await verifyChain(
      (bundle as CaseFileExportV2).records.caseLogEntries
    );
    chainVerified = verify.ok;
  }

  return {
    ok: true,
    imported: {
      cases: 1,
      clients: v1Records.clients.length,
      documents: v1Records.documents.length,
      workstream:
        v1Records.worklist.length +
        v1Records.stream.length +
        v1Records.activity.length,
    },
    chainVerified,
  };
}

const CRM_LS_KEYS = [
  CRM_CLIENTS_STORE_KEY,
  CRM_CASES_STORE_KEY,
  CRM_DOCUMENTS_STORE_KEY,
  CRM_WORKSTREAM_STORE_KEY,
  CRM_EVENTLOG_STORE_KEY,
  CRM_FIRM_STORE_KEY,
];

export function clearAllCrmState(): void {
  getCrmClientsStore().getState().resetForTests();
  getCrmCasesStore().getState().resetForTests();
  getCrmDocumentsStore().getState().resetForTests();
  getCrmWorkstreamStore().getState().resetForTests();
  getCrmEventLogStore().getState().resetForTests();
  getCrmFirmStore().getState().resetForTests();
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
