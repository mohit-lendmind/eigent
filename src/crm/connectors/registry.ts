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

// M4 (FR-001) — the adapter registry. An adapter MODULE exports a
// SourcingAdapterDefinition with NO `verified` field to lie in; the registry is
// the ONE place `verified` is set, and it DERIVES it from the definition's
// VerificationRef (deriveVerified) rather than trusting anything. A scaffold
// that ships without full evidence is therefore verified:false by construction —
// there is no code path that flips it true without a fixture hash, a
// rates-as-at, a raw-evidence pointer, AND a passing canary.

import type { FirmConfig } from '../agentContracts';
import { deriveVerified } from './assertClaimable';
import type {
  SourcingAdapter,
  SourcingAdapterDefinition,
} from './SourcingAdapter';

const definitions = new Map<string, SourcingAdapterDefinition>();

/**
 * Register an adapter definition. Idempotent by id — re-registering the same id
 * replaces the definition (a test double swaps the real MSE adapter this way).
 * The definition carries no `verified` field; the registry owns that.
 */
export function registerSourcingAdapter(
  definition: SourcingAdapterDefinition
): void {
  definitions.set(definition.id, definition);
}

/** The adapter ids registered so far (stable order of first registration). */
export function registeredSourcingAdapterIds(): string[] {
  return [...definitions.keys()];
}

/** Drop all registrations. Test-only — keeps one test's doubles out of another. */
export function resetSourcingRegistry(): void {
  definitions.clear();
}

/**
 * Build a SourcingAdapter from a registered definition, attaching the DERIVED
 * `verified` flag. This is the honesty spine's registration end: `verified` is
 * computed here from the definition's `verification` ref and nowhere else.
 */
function realize(definition: SourcingAdapterDefinition): SourcingAdapter {
  const verified = deriveVerified(definition.verification);
  return {
    id: definition.id,
    verified,
    sessionMode: definition.sessionMode,
    buildQuery: (caseFacts) => definition.buildQuery(caseFacts),
    extract: (recordedResult) => definition.extract(recordedResult),
    coverage: () => definition.coverage(),
  };
}

/** Resolve an adapter by id, or undefined if none is registered under it. */
export function getSourcingAdapter(id: string): SourcingAdapter | undefined {
  const definition = definitions.get(id);
  return definition ? realize(definition) : undefined;
}

/**
 * Resolve the adapter a firm's config selects (firmConfig.adapters.sourcing).
 * Throws if the configured adapter is not registered — a misconfigured firm must
 * fail visibly, never silently source against the wrong (or no) panel.
 */
export function resolveSourcingAdapter(config: FirmConfig): SourcingAdapter {
  const id = config.adapters.sourcing;
  const adapter = getSourcingAdapter(id);
  if (!adapter) {
    throw new Error(
      `no sourcing adapter registered for id '${id}' (firm ${config.firmId}); ` +
        `registered: [${registeredSourcingAdapterIds().join(', ')}]`
    );
  }
  return adapter;
}
