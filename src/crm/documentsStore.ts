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
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { registerDocumentsBus } from './_bus';
import type {
  ChecklistStatus,
  ClientId,
  CrmDocument,
  DocChecklistItem,
  DocInsight,
  DocumentId,
  FactFindSectionKey,
} from './domain/types';
import { CRM_SCHEMA_VERSION } from './domain/types';

export const CRM_DOCUMENTS_PERSIST_VERSION = 1;
export const CRM_DOCUMENTS_STORE_KEY = 'crm-documents-store';

export type ChecklistOwner = ClientId | 'joint';

export interface CrmDocumentsState {
  storageEnvironmentKey: string;
  documentsById: Record<DocumentId, CrmDocument>;
  checklistByOwner: Record<ChecklistOwner, DocChecklistItem[]>;

  addDocument: (doc: CrmDocument) => void;
  upsertDocuments: (docs: CrmDocument[]) => void;
  completeDocument: (
    id: DocumentId,
    payload: { type: string; attribution: number; insights: DocInsight[] }
  ) => void;
  confirmAttribution: (id: DocumentId, opts: { confirmedBy: string }) => void;
  setChecklistStatus: (
    owner: ChecklistOwner,
    itemKey: string,
    status: ChecklistStatus,
    opts?: { note?: string; label?: string }
  ) => void;
  upsertChecklistItems: (items: DocChecklistItem[]) => void;
  flipInsightConflict: (
    docId: DocumentId,
    section: FactFindSectionKey,
    fieldKey: string,
    conflict: boolean
  ) => void;
  resetForTests: () => void;
}

const emptyState = (): Pick<
  CrmDocumentsState,
  'storageEnvironmentKey' | 'documentsById' | 'checklistByOwner'
> => ({
  storageEnvironmentKey: getAuthEnvironmentKey(),
  documentsById: {},
  checklistByOwner: {},
});

const environmentMatches = (
  state: Partial<CrmDocumentsState> | undefined
): boolean => state?.storageEnvironmentKey === getAuthEnvironmentKey();

export const useCrmDocumentsStore = create<CrmDocumentsState>()(
  persist(
    (set) => ({
      ...emptyState(),

      addDocument: (doc) =>
        set((state) => {
          const status = doc.attribution == null ? 'PROCESSING' : doc.status;
          return {
            documentsById: {
              ...state.documentsById,
              [doc.id]: {
                ...doc,
                status,
                schemaVersion: CRM_SCHEMA_VERSION,
              },
            },
          };
        }),

      upsertDocuments: (docs) =>
        set((state) => {
          if (docs.length === 0) return state;
          const next = { ...state.documentsById };
          for (const doc of docs) {
            next[doc.id] = { ...doc, schemaVersion: CRM_SCHEMA_VERSION };
          }
          return { documentsById: next };
        }),

      completeDocument: (id, payload) =>
        set((state) => {
          const prev = state.documentsById[id];
          if (!prev) return state;
          return {
            documentsById: {
              ...state.documentsById,
              [id]: {
                ...prev,
                status: 'COMPLETED',
                type: payload.type,
                attribution: payload.attribution,
                insights: payload.insights,
              },
            },
          };
        }),

      confirmAttribution: (id, opts) =>
        set((state) => {
          const prev = state.documentsById[id];
          if (!prev) return state;
          return {
            documentsById: {
              ...state.documentsById,
              [id]: {
                ...prev,
                confirmedAt: Date.now(),
                confirmedBy: opts.confirmedBy,
              },
            },
          };
        }),

      setChecklistStatus: (owner, itemKey, status, opts) =>
        set((state) => {
          const prev = state.checklistByOwner[owner] ?? [];
          const idx = prev.findIndex((i) => i.itemKey === itemKey);
          const nowTs = Date.now();
          const nextItem: DocChecklistItem =
            idx >= 0
              ? {
                  ...prev[idx],
                  status,
                  note: opts?.note ?? prev[idx].note,
                  updatedAt: nowTs,
                }
              : {
                  owner,
                  itemKey,
                  label: opts?.label ?? itemKey,
                  status,
                  note: opts?.note,
                  updatedAt: nowTs,
                };
          const nextArr =
            idx >= 0
              ? prev.map((i, x) => (x === idx ? nextItem : i))
              : [...prev, nextItem];
          return {
            checklistByOwner: {
              ...state.checklistByOwner,
              [owner]: nextArr,
            },
          };
        }),

      upsertChecklistItems: (items) =>
        set((state) => {
          if (items.length === 0) return state;
          const nextByOwner = { ...state.checklistByOwner };
          for (const it of items) {
            const arr = nextByOwner[it.owner] ?? [];
            const idx = arr.findIndex((x) => x.itemKey === it.itemKey);
            nextByOwner[it.owner] =
              idx >= 0 ? arr.map((x, i) => (i === idx ? it : x)) : [...arr, it];
          }
          return { checklistByOwner: nextByOwner };
        }),

      flipInsightConflict: (docId, section, fieldKey, conflict) =>
        set((state) => {
          const prev = state.documentsById[docId];
          if (!prev) return state;
          const nextInsights = prev.insights.map((ins) => {
            const looksLikeTarget =
              ins.label.toLowerCase().includes(fieldKey.toLowerCase()) ||
              ins.label.toLowerCase().includes(section.toLowerCase());
            if (!looksLikeTarget) return ins;
            return { ...ins, conflict };
          });
          return {
            documentsById: {
              ...state.documentsById,
              [docId]: { ...prev, insights: nextInsights },
            },
          };
        }),

      resetForTests: () => set(emptyState()),
    }),
    {
      name: CRM_DOCUMENTS_STORE_KEY,
      version: CRM_DOCUMENTS_PERSIST_VERSION,
      migrate: (persistedState) => {
        const state = persistedState as Partial<CrmDocumentsState> | undefined;
        if (!state) return persistedState as CrmDocumentsState;
        if (!environmentMatches(state)) {
          return emptyState() as CrmDocumentsState;
        }
        return {
          ...state,
          storageEnvironmentKey: getAuthEnvironmentKey(),
          documentsById: shapeRepairDocuments(state.documentsById ?? {}),
          checklistByOwner: state.checklistByOwner ?? {},
        } as CrmDocumentsState;
      },
      partialize: (state) => ({
        storageEnvironmentKey: state.storageEnvironmentKey,
        documentsById: state.documentsById,
        checklistByOwner: state.checklistByOwner,
      }),
    }
  )
);

export function getCrmDocumentsStore(): typeof useCrmDocumentsStore {
  return useCrmDocumentsStore;
}

registerDocumentsBus({
  flipInsightConflict: (docId, section, fieldKey, conflict) =>
    useCrmDocumentsStore
      .getState()
      .flipInsightConflict(docId, section, fieldKey, conflict),
});

if (typeof queueMicrotask === 'function') {
  queueMicrotask(() => {
    const state = useCrmDocumentsStore.getState();
    if (!environmentMatches(state)) {
      useCrmDocumentsStore.setState(emptyState());
      console.warn(
        '[documentsStore] Cleared persisted documents after API environment changed.'
      );
    }
  });
}

function shapeRepairDocuments(
  raw: Record<string, unknown>
): Record<DocumentId, CrmDocument> {
  const out: Record<DocumentId, CrmDocument> = {};
  for (const [id, val] of Object.entries(raw)) {
    if (!val || typeof val !== 'object') continue;
    const d = val as CrmDocument;
    if (typeof d.id !== 'string' || typeof d.owner !== 'string') {
      console.warn(
        `[documentsStore] Dropping unknown document shape at id=${id} during migrate.`
      );
      continue;
    }
    out[id] = {
      ...d,
      schemaVersion: CRM_SCHEMA_VERSION,
      insights: Array.isArray(d.insights) ? d.insights : [],
    };
  }
  return out;
}
