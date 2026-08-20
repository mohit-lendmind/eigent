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
import { newCrmId } from './domain/ids';
import type { CaseId, Client, ClientId, Placeholder } from './domain/types';
import { CRM_SCHEMA_VERSION } from './domain/types';

export const CRM_CLIENTS_PERSIST_VERSION = 1;
export const CRM_CLIENTS_STORE_KEY = 'crm-clients-store';

type ClientRefusal = {
  ok: false;
  reason: 'referenced_by_case';
  caseIds: CaseId[];
};

export interface CrmClientsState {
  storageEnvironmentKey: string;
  clientsById: Record<ClientId, Client>;

  upsertClients: (clients: Client[]) => void;
  removeClient: (id: ClientId) => { ok: true } | ClientRefusal;
  noteClientCase: (clientId: ClientId, caseId: CaseId) => void;
  ensureClient: (id: ClientId) => Client | Placeholder;
  resetForTests: () => void;
}

const emptyState = (): Pick<
  CrmClientsState,
  'storageEnvironmentKey' | 'clientsById'
> => ({
  storageEnvironmentKey: getAuthEnvironmentKey(),
  clientsById: {},
});

const environmentMatches = (
  state: Partial<CrmClientsState> | undefined
): boolean => state?.storageEnvironmentKey === getAuthEnvironmentKey();

// Cross-store readers are lazily-loaded via dynamic import at call time so
// the module graph stays one-directional. The refusal guard reads casesStore
// state (allowed under FR-014 as a read, not a subscription).
type CasesGetState = () => { casesById: Record<string, unknown> };
type CasesModule = { getCrmCasesStore: () => { getState: CasesGetState } };
let cachedCasesModule: CasesModule | null = null;

async function loadCasesModule(): Promise<CasesModule> {
  if (!cachedCasesModule) {
    cachedCasesModule =
      (await import('./casesStore')) as unknown as CasesModule;
  }
  return cachedCasesModule;
}

function findCaseIdsReferencing(clientId: ClientId): CaseId[] {
  if (!cachedCasesModule) return [];
  const state = cachedCasesModule.getCrmCasesStore().getState() as unknown as {
    casesById: Record<
      string,
      { id: CaseId; applicants: Array<{ clientId: ClientId }> }
    >;
  };
  const hits: CaseId[] = [];
  for (const c of Object.values(state.casesById)) {
    if (c.applicants.some((a) => a.clientId === clientId)) {
      hits.push(c.id);
    }
  }
  return hits;
}

function makePlaceholder(id: ClientId): Placeholder {
  return {
    id,
    ref: id,
    firstName: 'Unknown',
    lastName: '(repaired)',
    initials: '??',
    tint: 'placeholder',
    textCls: 'placeholder',
    cases: [],
    since: Date.now(),
    schemaVersion: CRM_SCHEMA_VERSION,
    repaired: true,
  } satisfies Placeholder;
}

export const useCrmClientsStore = create<CrmClientsState>()(
  persist(
    (set, get) => ({
      ...emptyState(),

      upsertClients: (clients) =>
        set((state) => {
          if (clients.length === 0) return state;
          const next = { ...state.clientsById };
          for (const c of clients) {
            const prev = next[c.id];
            next[c.id] = {
              ...c,
              schemaVersion: CRM_SCHEMA_VERSION,
              cases: dedupeCases(prev?.cases, c.cases),
            };
          }
          return { clientsById: next };
        }),

      removeClient: (id) => {
        // Preload cases module lazily (safe — this store never subscribes).
        if (!cachedCasesModule) {
          void loadCasesModule();
        }
        const refs = findCaseIdsReferencing(id);
        if (refs.length > 0) {
          return { ok: false, reason: 'referenced_by_case', caseIds: refs };
        }
        set((state) => {
          if (!state.clientsById[id]) return state;
          const next = { ...state.clientsById };
          delete next[id];
          return { clientsById: next };
        });
        return { ok: true };
      },

      noteClientCase: (clientId, caseId) =>
        set((state) => {
          const client = state.clientsById[clientId];
          if (!client) return state;
          if (client.cases.includes(caseId)) return state;
          return {
            clientsById: {
              ...state.clientsById,
              [clientId]: {
                ...client,
                cases: [...client.cases, caseId],
              },
            },
          };
        }),

      ensureClient: (id) => {
        const found = get().clientsById[id];
        if (found) return found;
        return makePlaceholder(id);
      },

      resetForTests: () => set(emptyState()),
    }),
    {
      name: CRM_CLIENTS_STORE_KEY,
      version: CRM_CLIENTS_PERSIST_VERSION,
      migrate: (persistedState) => {
        const state = persistedState as Partial<CrmClientsState> | undefined;
        if (!state) return persistedState as CrmClientsState;
        if (!environmentMatches(state)) {
          return emptyState() as CrmClientsState;
        }
        return {
          ...state,
          storageEnvironmentKey: getAuthEnvironmentKey(),
          clientsById: shapeRepairClients(state.clientsById ?? {}),
        } as CrmClientsState;
      },
      partialize: (state) => ({
        storageEnvironmentKey: state.storageEnvironmentKey,
        clientsById: state.clientsById,
      }),
    }
  )
);

export function getCrmClientsStore(): typeof useCrmClientsStore {
  return useCrmClientsStore;
}

// Pre-load the cases module so removeClient can consult it synchronously
// after the first tick. This is a one-directional read (spec FR-014).
if (typeof queueMicrotask === 'function') {
  queueMicrotask(() => {
    void loadCasesModule();
    const state = useCrmClientsStore.getState();
    if (!environmentMatches(state)) {
      useCrmClientsStore.setState(emptyState());
      console.warn(
        '[clientsStore] Cleared persisted clients after API environment changed.'
      );
    }
  });
}

function dedupeCases(
  prev: CaseId[] | undefined,
  next: CaseId[] | undefined
): CaseId[] {
  const merged = new Set<CaseId>([...(prev ?? []), ...(next ?? [])]);
  return [...merged];
}

function shapeRepairClients(
  raw: Record<string, unknown>
): Record<ClientId, Client> {
  const out: Record<ClientId, Client> = {};
  for (const [id, val] of Object.entries(raw)) {
    if (!val || typeof val !== 'object') continue;
    const c = val as Partial<Client>;
    if (
      typeof c.id !== 'string' ||
      typeof c.firstName !== 'string' ||
      typeof c.lastName !== 'string'
    ) {
      console.warn(
        `[clientsStore] Dropping unknown client shape at id=${id} during migrate.`
      );
      continue;
    }
    out[id] = {
      id: c.id,
      ref: c.ref ?? c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      initials: c.initials ?? c.firstName.slice(0, 1) + c.lastName.slice(0, 1),
      tint: c.tint ?? 'placeholder',
      textCls: c.textCls ?? 'placeholder',
      role: c.role,
      email: c.email,
      phone: c.phone,
      cases: Array.isArray(c.cases) ? c.cases : [],
      since: typeof c.since === 'number' ? c.since : Date.now(),
      schemaVersion: CRM_SCHEMA_VERSION,
      repaired: c.repaired,
      ownershipHint: c.ownershipHint,
      origin: c.origin,
    };
  }
  return out;
}

// Kept for internal helpers referenced from other CRM modules; not re-exported
// to preserve the public barrel.
export function _internalCreatePlaceholderClient(id: ClientId): Placeholder {
  return makePlaceholder(id);
}

// Reserved id namespace helper — public consumers should mint via newCrmId.
export const _reservedClientIdHelper = () => newCrmId('client');
