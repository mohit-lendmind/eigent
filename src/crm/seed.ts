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

import { getCrmCasesStore } from './casesStore';
import { getCrmClientsStore } from './clientsStore';
import { getCrmDocumentsStore } from './documentsStore';
import { newCrmId } from './domain/ids';
import {
  CRM_SCHEMA_VERSION,
  type ActivityEvent,
  type FieldChangeEvent,
} from './domain/types';
import { goldenPathBundle } from './fixtures/goldenPath';
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
    // Vite exposes DEV; if not present, allow (test environments).

    const meta = import.meta as any;
    if (meta && meta.env && typeof meta.env.DEV === 'boolean') {
      return Boolean(meta.env.DEV) || Boolean(meta.env.MODE === 'test');
    }
  } catch {
    // fall through
  }
  return true;
}

export interface SeedOptions {
  force?: boolean;
  ignoreDevGate?: boolean;
}

export function seedCrmGoldenPath(opts: SeedOptions = {}): void {
  if (!opts.ignoreDevGate && !isDevGate()) return;
  if (!opts.force && anyStoreNonEmpty()) return;

  const clientsStore = getCrmClientsStore();
  const casesStore = getCrmCasesStore();
  const docsStore = getCrmDocumentsStore();
  const wsStore = getCrmWorkstreamStore();

  // Single setState per store — no per-record loops that would emit multiple
  // intermediate states to any subscribing consumer.
  const now = Date.now();

  clientsStore.setState((state) => {
    const next = { ...state.clientsById };
    for (const c of goldenPathBundle.clients) {
      next[c.id] = { ...c, schemaVersion: CRM_SCHEMA_VERSION };
    }
    return { clientsById: next };
  });

  casesStore.setState((state) => {
    const nextCases = { ...state.casesById };
    for (const c of goldenPathBundle.cases) {
      nextCases[c.id] = { ...c, schemaVersion: CRM_SCHEMA_VERSION };
    }
    const nextConflicts = { ...state.conflictsById };
    for (const r of goldenPathBundle.conflicts) {
      nextConflicts[r.id] = { ...r, schemaVersion: CRM_SCHEMA_VERSION };
    }
    const nextCriteria: Record<string, typeof goldenPathBundle.criteria> = {
      ...state.criteriaByCase,
    };
    for (const check of goldenPathBundle.criteria) {
      (nextCriteria[check.caseId] ??= []).push({
        ...check,
        schemaVersion: CRM_SCHEMA_VERSION,
      });
    }
    const nextProducts: Record<string, typeof goldenPathBundle.products> = {
      ...state.productsByCase,
    };
    for (const p of goldenPathBundle.products) {
      (nextProducts[p.caseId] ??= []).push({
        ...p,
        schemaVersion: CRM_SCHEMA_VERSION,
      });
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

  // Fix up completeness now that the raw cases are in place. Doing this via
  // upsertCases would produce a second setState per case — the direct setState
  // above keeps the subscriber-visible transition to exactly one.
  casesStore.setState((state) => {
    const nextCases = { ...state.casesById };
    for (const [cid, c] of Object.entries(nextCases)) {
      // The upsertCases path recomputes; we call it as the single write path
      // to avoid duplicating the completeness math here. But to stay atomic we
      // just mark schemaVersion — the microtask below will nudge.
      nextCases[cid] = { ...c, updated: now };
    }
    return { casesById: nextCases };
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
    const nextStream = { ...state.streamByCase };
    for (const [cid, entries] of Object.entries(goldenPathBundle.stream)) {
      const stamped = entries.map((e) => ({
        ...e,
        schemaVersion: CRM_SCHEMA_VERSION,
      }));
      nextStream[cid] = stamped;
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

    // Note a seed activity per case that received applicants.
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

  // Trigger completeness recompute so the applicants + case rollups reflect
  // the seeded fixture data. This mimics upsertCases without re-emitting the
  // whole cases record (still one further setState — subscribers observe two
  // transitions total on cases, both fully-populated).
  casesStore.getState().upsertCases(goldenPathBundle.cases);

  // Keep client back-refs for the pipeline clients too.
  for (const c of goldenPathBundle.cases) {
    for (const a of c.applicants) {
      clientsStore.getState().noteClientCase(a.clientId, c.id);
    }
  }
}

export function clearAllCrmStateInternal(): void {
  getCrmClientsStore().getState().resetForTests();
  getCrmCasesStore().getState().resetForTests();
  getCrmDocumentsStore().getState().resetForTests();
  getCrmWorkstreamStore().getState().resetForTests();
}
