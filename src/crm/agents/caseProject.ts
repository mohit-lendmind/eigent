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

// FR-003 — the Project-per-case and Project-per-firm-coordinator mapping. A
// case's directives ride one aion Project so its artifacts (the case log, the
// directive envelopes, the produced documents) share a listing; the firm's
// watcher runs in a single coordinator Project so one `*/5` schedule fires over
// the whole firm rather than one per case.
//
// Both resolvers are promise-cached per id: createProject mints a fresh
// idempotency key on every call, so without the cache two concurrent dispatches
// for the same case would create two Projects. The case→Project pointer is also
// written back onto the Case (via the cases store) so it survives a restart;
// the coordinator pointer is cached for the renderer lifetime.

import { getAionModelCatalog, resolveModelAlias } from '@/store/aionChatBridge';
import { getCrmCasesStore } from '../casesStore';
import { getAgentEdge } from './edge';

// A keyless/fixture stack offers the picker nothing; the created Project still
// needs an alias, and the backend that has no catalog also accepts this one.
const FALLBACK_MODEL_ALIAS = 'default';

async function agentModelAlias(): Promise<string> {
  try {
    const catalog = await getAionModelCatalog();
    if (catalog) {
      const alias = resolveModelAlias(catalog);
      if (alias) return alias;
    }
  } catch {
    // No catalog to hand (local/keyless/test) — fall through to the default.
  }
  return FALLBACK_MODEL_ALIAS;
}

const caseProjects = new Map<string, Promise<string>>();
const coordinatorProjects = new Map<string, Promise<string>>();

async function resolveCaseProject(caseId: string): Promise<string> {
  const store = getCrmCasesStore();
  const existing = store.getState().casesById[caseId];
  if (existing?.aionProjectId) return existing.aionProjectId;

  const edge = await getAgentEdge();
  const project = await edge.createProject({
    title: `lm case ${caseId}`,
    model_alias: await agentModelAlias(),
  });
  // Pin the pointer on the Case so a later renderer resolves it without a
  // create. A case absent from the store (unseeded) still dispatches — the
  // in-memory cache keeps this session idempotent — but has nowhere to persist.
  if (existing) {
    store
      .getState()
      .upsertCases([{ ...existing, aionProjectId: project.project_id }]);
  }
  return project.project_id;
}

export function ensureCaseProject(caseId: string): Promise<string> {
  const cached = caseProjects.get(caseId);
  if (cached) return cached;
  const pending = resolveCaseProject(caseId).catch((error: unknown) => {
    caseProjects.delete(caseId);
    throw error;
  });
  caseProjects.set(caseId, pending);
  return pending;
}

async function resolveCoordinatorProject(firmId: string): Promise<string> {
  const edge = await getAgentEdge();
  const project = await edge.createProject({
    title: `lm firm coordinator ${firmId}`,
    model_alias: await agentModelAlias(),
  });
  return project.project_id;
}

export function firmCoordinatorProject(firmId: string): Promise<string> {
  const cached = coordinatorProjects.get(firmId);
  if (cached) return cached;
  const pending = resolveCoordinatorProject(firmId).catch((error: unknown) => {
    coordinatorProjects.delete(firmId);
    throw error;
  });
  coordinatorProjects.set(firmId, pending);
  return pending;
}

/** Drops the per-id caches (tests, or a credential change mid-lifetime). */
export function resetCaseProjectCaches(): void {
  caseProjects.clear();
  coordinatorProjects.clear();
}
