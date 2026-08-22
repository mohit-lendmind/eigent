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
  computeCaseCompleteness,
  getCrmCasesStore,
  recomputeApplicantCompleteness,
} from './casesStore';
import { getCrmClientsStore } from './clientsStore';
import { getCrmDocumentsStore } from './documentsStore';
import { newCrmId } from './domain/ids';
import {
  CRM_SCHEMA_VERSION,
  type ActivityEvent,
  type CaseId,
  type FieldChangeEvent,
  type StreamEntry,
} from './domain/types';
import { c417Log } from './fixtures/caselog/c417Log';
import { goldenPathBundle } from './fixtures/goldenPath';
import { foldEntries } from './fold/caseLogFold';
import { getCrmWorkstreamStore } from './workstreamStore';

function anyStoreNonEmpty(): boolean {
  const c = getCrmClientsStore().getState();
  if (Object.keys(c.clientsById).length > 0) return true;
  const cs = getCrmCasesStore().getState();
  if (Object.keys(cs.casesById).length > 0) return true;
  const ds = getCrmDocumentsStore().getState();
  if (Object.keys(ds.documentsById).length > 0) return true;
  const ws = getCrmWorkstreamStore().getState();
  if (Object.keys(ws.worklistItems).length > 0) return true;
  if (ws.retentionEntries.length > 0) return true;
  return false;
}

function isDevGate(): boolean {
  try {
    // Vite exposes DEV. Fail CLOSED when import.meta.env is unavailable —
    // seed data must not leak into prod builds where the env probe fails.

    const meta = import.meta as any;
    if (meta && meta.env && typeof meta.env.DEV === 'boolean') {
      return Boolean(meta.env.DEV) || Boolean(meta.env.MODE === 'test');
    }
  } catch {
    // fall through
  }
  return false;
}

export interface SeedOptions {
  force?: boolean;
  ignoreDevGate?: boolean;
  // Route case c417 through the artifact-canonical fold after the upsert seed,
  // so its audit spine (watermark, chain head, freshness=live) is populated
  // from the golden log rather than left empty. The fold is deterministic and
  // converges on the same c417 projection the upsert path produced — the seed
  // and the fold agree, which is the cross-check this option exists to enable.
  // Async because the fold hashes via WebCrypto; the plain (non-fold) path
  // stays fully synchronous and completes before the returned promise settles.
  throughFold?: boolean;
}

export async function seedCrmGoldenPath(opts: SeedOptions = {}): Promise<void> {
  if (!opts.ignoreDevGate && !isDevGate()) return;
  if (!opts.force && anyStoreNonEmpty()) return;

  const clientsStore = getCrmClientsStore();
  const casesStore = getCrmCasesStore();
  const docsStore = getCrmDocumentsStore();
  const wsStore = getCrmWorkstreamStore();

  const now = Date.now();

  // ONE setState per store. Precompute case completeness here (rather than
  // rely on a follow-up upsertCases pass) so subscribers observe exactly one
  // transition per store.
  const backRefs = new Map<string, Set<CaseId>>();
  clientsStore.setState((state) => {
    const next = { ...state.clientsById };
    for (const c of goldenPathBundle.clients) {
      next[c.id] = { ...c, schemaVersion: CRM_SCHEMA_VERSION };
    }
    return { clientsById: next };
  });

  const stampedCases: Record<CaseId, (typeof goldenPathBundle.cases)[number]> =
    {};
  for (const c of goldenPathBundle.cases) {
    const applicants = c.applicants.map(recomputeApplicantCompleteness);
    stampedCases[c.id] = {
      ...c,
      schemaVersion: CRM_SCHEMA_VERSION,
      updated: now,
      applicants,
      completeness: computeCaseCompleteness(applicants),
    };
    for (const a of applicants) {
      const bucket = backRefs.get(a.clientId) ?? new Set();
      bucket.add(c.id);
      backRefs.set(a.clientId, bucket);
    }
  }

  casesStore.setState((state) => {
    const nextCases = { ...state.casesById, ...stampedCases };
    const nextConflicts = { ...state.conflictsById };
    for (const r of goldenPathBundle.conflicts) {
      nextConflicts[r.id] = { ...r, schemaVersion: CRM_SCHEMA_VERSION };
    }
    const nextCriteria: typeof state.criteriaByCase = {
      ...state.criteriaByCase,
    };
    for (const check of goldenPathBundle.criteria) {
      const arr = nextCriteria[check.caseId] ?? [];
      const merged = new Map(arr.map((x) => [x.id, x]));
      merged.set(check.id, { ...check, schemaVersion: CRM_SCHEMA_VERSION });
      nextCriteria[check.caseId] = [...merged.values()];
    }
    const nextProducts: typeof state.productsByCase = {
      ...state.productsByCase,
    };
    for (const p of goldenPathBundle.products) {
      const arr = nextProducts[p.caseId] ?? [];
      const merged = new Map(arr.map((x) => [x.id, x]));
      merged.set(p.id, { ...p, schemaVersion: CRM_SCHEMA_VERSION });
      nextProducts[p.caseId] = [...merged.values()];
    }
    const nextCompliance = { ...state.complianceByCase };
    for (const rec of goldenPathBundle.compliance) {
      nextCompliance[rec.caseId] = {
        ...rec,
        schemaVersion: CRM_SCHEMA_VERSION,
      };
    }
    return {
      casesById: nextCases,
      conflictsById: nextConflicts,
      criteriaByCase: nextCriteria,
      productsByCase: nextProducts,
      complianceByCase: nextCompliance,
    };
  });

  // Merge client back-refs into ONE setState after the cases land.
  clientsStore.setState((state) => {
    const next = { ...state.clientsById };
    let mutated = false;
    for (const [clientId, caseIds] of backRefs) {
      const client = next[clientId];
      if (!client) continue;
      const existing = new Set(client.cases);
      let added = false;
      for (const cid of caseIds) {
        if (!existing.has(cid)) {
          existing.add(cid);
          added = true;
        }
      }
      if (added) {
        next[clientId] = { ...client, cases: [...existing] };
        mutated = true;
      }
    }
    return mutated ? { clientsById: next } : state;
  });

  docsStore.setState((state) => {
    const next = { ...state.documentsById };
    for (const d of goldenPathBundle.documents) {
      next[d.id] = { ...d, schemaVersion: CRM_SCHEMA_VERSION };
    }
    const nextChecklist: typeof state.checklistByOwner = {
      ...state.checklistByOwner,
    };
    for (const item of goldenPathBundle.checklist) {
      const arr = nextChecklist[item.owner] ?? [];
      const idx = arr.findIndex((x) => x.itemKey === item.itemKey);
      nextChecklist[item.owner] =
        idx >= 0 ? arr.map((x, i) => (i === idx ? item : x)) : [...arr, item];
    }
    return {
      documentsById: next,
      checklistByOwner: nextChecklist,
    };
  });

  wsStore.setState((state) => {
    const nextWorklist = { ...state.worklistItems };
    for (const w of goldenPathBundle.worklist) {
      nextWorklist[w.id] = { ...w, schemaVersion: CRM_SCHEMA_VERSION };
    }
    const nextStream: Record<CaseId, StreamEntry[]> = { ...state.streamByCase };
    for (const [cid, entries] of Object.entries(goldenPathBundle.stream)) {
      nextStream[cid] = entries.map((e) => ({
        ...e,
        schemaVersion: CRM_SCHEMA_VERSION,
      }));
    }
    const nextRetention = [...state.retentionEntries];
    for (const r of goldenPathBundle.retention) {
      const idx = nextRetention.findIndex(
        (x) => x.clientId === r.clientId && x.endsAt === r.endsAt
      );
      const stamped = { ...r, schemaVersion: CRM_SCHEMA_VERSION };
      if (idx >= 0) nextRetention[idx] = stamped;
      else nextRetention.push(stamped);
    }

    // Emit FieldChangeEvent per seeded fact-find field (reason: 'seed').
    const nextFce = [...state.fieldChangeEvents];
    for (const c of goldenPathBundle.cases) {
      for (const a of c.applicants) {
        for (const [sec, secValue] of Object.entries(a.profile)) {
          if (!secValue) continue;
          for (const f of secValue.fields) {
            const event: FieldChangeEvent = {
              id: newCrmId('event'),
              caseId: c.id,
              clientId: a.clientId,
              section: sec as FieldChangeEvent['section'],
              fieldKey: f.k,
              priorValue: null,
              newValue: f.value,
              priorSrc: null,
              newSrc: f.src,
              changedAt: now,
              changedBy: 'seed',
              reason: 'seed',
              schemaVersion: CRM_SCHEMA_VERSION,
            };
            nextFce.push(event);
          }
        }
      }
    }

    const nextActivity = { ...state.activityByCase };
    for (const c of goldenPathBundle.cases) {
      const arr = nextActivity[c.id] ?? [];
      const activity: ActivityEvent = {
        id: newCrmId('activity'),
        caseId: c.id,
        kind: 'seed',
        title: 'Case seeded from golden path',
        when: now,
        actor: 'seed',
        schemaVersion: CRM_SCHEMA_VERSION,
      };
      nextActivity[c.id] = [...arr, activity];
    }

    return {
      worklistItems: nextWorklist,
      streamByCase: nextStream,
      retentionEntries: nextRetention,
      fieldChangeEvents: nextFce,
      activityByCase: nextActivity,
    };
  });

  if (opts.throughFold) {
    await foldEntries('c417', await c417Log());
  }
}
