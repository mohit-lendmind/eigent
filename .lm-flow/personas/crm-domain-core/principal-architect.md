# Principal Architect perspective on crm-domain-core

## What I support
- **Money as integer pence `number`.** Correct call: persisted stores JSON-serialize and `JSON.stringify` throws on bigint; pence values never approach 2^53. Mirroring `formatMicroUsd` keeps the formatter beside the type.
- **Environment scoping via `getAuthEnvironmentKey()`** with clear-on-mismatch — this is the tenancy story, and it reuses the proven spaceStore mechanism. Approved as "single-tenant per environment, enforced in migrate + microtask repair."
- **Sync-everywhere is load-bearing and right.** Zero network calls means no idempotency surface yet; `transport.ts` already owns `newIdempotencyKey()` for when F07 arrives.
- **Two-version idiom** (persist envelope version + per-record `schemaVersion`) plus `persist.getOptions().migrate` tests — this is a real migration path, not a hope.

## What I want changed (Dissent:)
- **Dissent: 4 stores creates 4 independently-versioned persistence units with cross-store invariants and no transaction boundary.** A case referencing a client lives in two localStorage keys that can migrate, clear, or corrupt independently. I'd accept 4 stores only with a named `crmIntegrityRepair()` that runs after all four hydrate (single microtask, ordered), pruning dangling refs in one pass — not per-store repair that can observe a half-hydrated sibling.
- **Dissent: "selectors tolerate missing refs" is a policy, not a mechanism.** Name the placeholder shape (`MISSING_CLIENT`) in types.ts so every consumer renders the same degraded state.
- **Dissent: the 200-entry stream cap prunes silently in `partialize`.** In-memory state then diverges from persisted state across reload — make the cap a named constant applied in `pushStreamEntry` too, so what you see is what survives.

## What I would not ship without
- Observability: every migrate/repair prune emits a structured `console.warn` with store name, record ids dropped, and reason — the doc says "describing what was pruned"; make the format a shared helper.
- A data-lifecycle note: `clearAllCrmState()` (all four keys) exists and is tested — GDPR-style deletion must not require dev tools.
- F07 seam pre-commitment: entity types keep an optional `origin?: { artifactId, runId }` field from day one, so agent-ingested records are distinguishable without a v2 migration.

## Acceptance criteria from my lens
- JSON round-trip test per store's partialized state.
- Migration test drives `migrate(fixture, 0)` for each store.
- Environment-switch test proves cross-tenant clear on all four keys.
- Integrity repair test: dangling `case.clientId` pruned/flagged deterministically.

## Edge cases I want addressed
- Two windows (Electron + web build) writing the same localStorage keys concurrently.
- Quota exceeded mid-write: partial envelope must fail closed to defaults, not crash hydrate.
- `removeClient` refusal path when cases reference it — surfaced how, with no UI?
