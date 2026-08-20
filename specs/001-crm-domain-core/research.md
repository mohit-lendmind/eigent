# Phase 0 Research — crm-domain-core

**Feature**: F01 `crm-domain-core` · **Branch**: `lendmind-crm` · **Date**: 2026-08-20

**Status**: All Technical Context fields in `plan.md` are resolved; **no `NEEDS CLARIFICATION` remain**. This document records the four load-bearing decisions where the design space had genuine optionality, each with the decision, its rationale, and the alternatives considered.

The remaining Technical Context fields (language/version, primary deps, testing framework, target platform, project type) were determined by inspecting the existing repo (`package.json`, `src/store/spaceStore.ts`, `test/setup.ts`) rather than by open research — they are not decisions this feature makes.

---

## Decision 1 — Money representation

**Decision**: Store money as branded `Pence = number & { readonly __pence: unique symbol }`, integer pence. Provide `formatGbp(pence, {compact?}): string` and `parseGbp(input: string): Pence | null` beside the type in `src/crm/domain/money.ts`. Money is a first-class variant `{t:'money', v: Pence}` in the `FactFindField` discriminated union (spec FR-004). No display strings and no `bigint` ever persist.

**Rationale**:
1. `JSON.stringify` throws on `bigint`, and the whole persistence + export/import contract depends on JSON round-tripping (spec SC-003 asserts byte-equal round-trip). `aionUsageStore` uses `bigint` for micro-USD but *never persists it*; the CRM stores must persist money, so `number` pence is the only compatible choice.
2. UK mortgage figures fit in `Number.MAX_SAFE_INTEGER` with 6+ orders of magnitude of headroom (the largest realistic value — £10M loan — is 1,000,000,000 pence; `MAX_SAFE_INTEGER` is ~9 × 10¹⁵).
3. A branded type gives compile-time protection against `£38,500` (a string) or `385.00` (pounds as float) accidentally becoming a `Pence` value. This is trade-off #1 in the spec, resolved.
4. Format/parse living beside the type keeps F02's inline editor a strongly-typed switch — no round-trip through display strings.

**Alternatives considered**:
- **`bigint` pence** — Rejected: not JSON-serialisable, would break every persist envelope, every export, and every fixture round-trip test. Would force a canonicalization pass everywhere money crosses the wire.
- **`{ pounds: number, pence: number }` pair** — Rejected: doubles the field count on every money value, complicates arithmetic (carries), and breaks the discriminated-union symmetry with the other field variants.
- **Store display strings, parse on read** — Rejected: makes `JSON.stringify` byte-equality tests (SC-003) require a canonicalization pre-pass; also makes selector-level arithmetic (e.g. `selectCaseCompleteness`, LTV/LTI computation for fixture-integrity tests) require constant re-parsing.

---

## Decision 2 — Cross-store integration style

**Decision**: One-directional cross-store reads via `.getState()` at call sites. Import graph: `documents → cases → clients`, `workstream → all three`. No zustand subscriptions across stores; no event bus. Enforced by ESLint `no-restricted-imports` (and by the FR-014 cross-store-imports test).

**Rationale**:
1. Mirrors the existing repo idiom exactly — `projectStore.ts` and `spaceStore.ts` read each other via `.getState()` and never subscribe cross-store. Deviating would introduce a foreign pattern in the same directory that F02+ authors are expected to follow.
2. Guards (e.g. `removeClient` refusing while referenced, spec FR-016) need a synchronous read at action time, not a subscription. `getState()` returns exactly that.
3. A subscription topology (event bus, cross-store `subscribe`) creates ordering hazards during hydration — the microtask integrity repair (spec FR-036) exists precisely because half-hydrated siblings must not react to each other's mid-flight state.

**Alternatives considered**:
- **Event bus / pub-sub between stores** — Rejected: introduces hydration ordering hazards; no other slice in the repo uses this pattern; makes the audit trail non-deterministic.
- **Merge into one mega-store** — Rejected: violates the FR-012 four-envelope split (each envelope migrates and persists independently, so store-level partitioning is a persistence requirement, not just an organisational one); loses independent-migration granularity; makes `partialize` allowlists brittle.
- **RxJS observables** — Rejected: new dependency; violates the "no new deps" constraint (spec FR-047 / plan Technical Context).

---

## Decision 3 — Stream-cap enforcement point

**Decision**: Enforce `STREAM_ENTRIES_PER_CASE_CAP = 200` **at write time** inside `pushStreamEntry`, with a filter that makes entries of kind `conflict` or `approval` ineligible for eviction while their linked worklist item is `status:'open'`. When any entry is evicted, insert a synthetic `{kind:'done', title:'Older activity truncated', truncatedBefore, truncatedCount}` marker at the eviction point so the visible history reports the cap. FCA-load-bearing records (`FieldChangeEvent`, `ConflictRecord`) live in different arrays and are exempt from the cap.

**Rationale**:
1. This is trade-off #2 in the spec, resolved. The design tension: Head of Sales wants append-only for the FCA archive; the Principal Architect flagged localStorage quota (~5 MB browser default) as a real ceiling on unbounded stream growth; UX asked for visible truncation; PM required "never quietly evict unresolved".
2. Write-time enforcement makes the cap deterministic and testable — a `partialize`-time cap (only trims on persist) leaves in-memory state unbounded between persists and makes the cap invisible until a browser reload.
3. The FCA-defensible substrate lives in `FieldChangeEvent`s (workstream store, spec FR-034) and `ConflictRecord`s (cases store, spec FR-033) — neither is a stream entry, so neither is subject to the cap. The stream is a demo/working surface; the export is the archive (spec § Trade-off Resolutions #2).
4. The truncation marker + unresolved-ineligibility rule together satisfy every persona's non-negotiable without inventing a new audit surface.

**Alternatives considered**:
- **No cap (unbounded stream)** — Rejected: hits localStorage quota once real-world usage accumulates; violates persist envelope size assumption (<200 KB with fixtures).
- **Cap enforced only in `partialize`** — Rejected: allows unbounded in-memory growth between persist calls (partialize runs on write to localStorage, not per action); makes the cap invisible in dev until a browser restart; makes assertion timing fragile in vitest.
- **Silent tail-drop (no marker, no unresolved rule)** — Rejected: violates the "unresolved *needs you* entries never quietly evicted" product commitment (spec § Summary bullet 3); violates PM's non-negotiable.
- **Move the cap into the export instead** — Rejected: the export must be complete (per spec FR-040); capping there would defeat its purpose as the FCA archive.

---

## Decision 4 — Fixture location: `src/crm/fixtures/` vs `test/fixtures/`

**Decision**: Golden-path fixtures live under `src/crm/fixtures/`, not `test/fixtures/`. `seedCrmGoldenPath()` in `src/crm/seed.ts` imports from that path.

**Rationale**:
1. F02–F05 UI features consume `seedCrmGoldenPath()` at runtime (dev-only) to render the design reference screens against real domain data. Their dev entry points cannot import from `test/`.
2. The repo's `tsconfig.json` `rootDir` excludes `test/` from the app compilation graph; keeping fixtures inside `src/` avoids a config change (which would itself require justification).
3. Fixtures are already required to comply with the design-token gate (spec FR-045) since the gate scans all of `src/`; locating them at `src/crm/fixtures/` makes that requirement structural, not incidental.
4. Test suites can still import from `src/crm/fixtures/` freely — the import direction is `test/ → src/`, never the reverse.

**Alternatives considered**:
- **Fixtures under `test/fixtures/crm/`** — Rejected: cannot be imported by F02+ dev seed entry points; would require duplication.
- **Fixtures under a new `packages/lendmind-fixtures/`** — Rejected: would require monorepo tooling not yet in place; premature restructuring.
- **Inline fixtures in each test file** — Rejected: violates DRY across 6+ integration tests; makes fixture-integrity assertions (LTV = 85%, LTI = 2.95×) hard to keep in one place.

---

## Non-decisions (resolved by inspection, not research)

The following were determined by reading the repo, not by weighing alternatives:

- **Language/framework versions** — from `package.json` (TypeScript 5.4, zustand 5.0.4, date-fns 3.6.0, vitest 2.1.5, Electron 33, React 18).
- **Persist envelope shape** — from `src/store/spaceStore.ts:764-801` (version + shape-repair `migrate` + allowlist `partialize` + `storageEnvironmentKey`).
- **Store hook / accessor pattern** — from `getSpaceStore()` / `useSpaceStore` idiom.
- **Post-hydration repair timing** — from the existing `queueMicrotask` post-rehydration pattern in `spaceStore.ts`.
- **Reset idiom for tests** — from `spaceStore.test.ts` (`beforeEach` full `setState`; `test/setup.ts` clears localStorage globally).
- **License header block** — from the top of `src/store/spaceStore.ts` (repo convention).

None of the above have alternatives worth documenting; they are conformance to house convention.

---

## Outcome

Every Technical Context slot in `plan.md` is filled with a concrete value; every decision documented above is reflected in the corresponding FR in the spec. Phase 0 exits clean — proceed to Phase 1.
