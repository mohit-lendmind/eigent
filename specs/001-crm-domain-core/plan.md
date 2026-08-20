# Implementation Plan: crm-domain-core

**Branch**: `lendmind-crm` (spec directory: `specs/001-crm-domain-core`) | **Date**: 2026-08-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-crm-domain-core/spec.md`

## Summary

`crm-domain-core` (F01) is the pure, UI-less typed domain layer for **Lendmind Advisor** — a UK mortgage broker CRM inside the Eternyl Electron/React desktop app. It introduces `src/crm/`: entity types, four persisted zustand stores (`clients`, `cases`, `documents`, `workstream`) mirroring `spaceStore.ts`'s persistence anatomy, pure derivation helpers (completeness math, semantic-tone stage catalog, pence money type), faithful golden-path fixtures (cases c417 & c392 per the design reference), a dev-gated `seedCrmGoldenPath()`, `exportCaseFile` / `importCaseFile` serializers, a single ordered `crmIntegrityRepair()` pass, and a ≥60-test vitest suite. No UI, no routes, no network. Every later feature (F02–F17) consumes this layer without needing to reach back into `src/crm/domain/`.

**Approach** (from architecture doc `.lm-flow/architecture/crm-domain-core.md`): additive-only TypeScript modules under a new `src/crm/` tree; each store copies `spaceStore.ts:764-801`'s persist envelope shape (version, `migrate` shape-repair, allowlist `partialize`, `storageEnvironmentKey`); cross-store integration is one-directional via `.getState()`; the integrity repair runs once in a post-hydration `queueMicrotask`; fixtures live in `src/crm/fixtures/` (not `test/`) because F02+ demos consume them at runtime.

## Technical Context

**Language/Version**: TypeScript 5.4 (ES2022 target, ESM), renderer-side only

**Primary Dependencies**: `zustand ^5.0.4` (already present) with `persist` middleware; `date-fns ^3.6.0` (already present) for retention-window math; consumes `generateUniqueId()` and `getAuthEnvironmentKey()` from the existing repo. **No new dependencies** — `package.json` diff target is zero.

**Storage**: Browser `localStorage` via zustand `persist`. Four envelope keys: `crm-clients-store`, `crm-cases-store`, `crm-documents-store`, `crm-workstream-store`. Each envelope is version-stamped (`CRM_<X>_PERSIST_VERSION = 1`) independently of per-record `schemaVersion` (`CRM_SCHEMA_VERSION = 1`). Envelopes are environment-scoped via `getAuthEnvironmentKey()`; mismatched envelopes yield empty state (no cross-tenant bleed). No SQL, no IndexedDB.

**Testing**: `vitest ^2.1.5`. Tests co-located at `src/crm/**/*.test.ts` for state-machine-heavy stores; broader integration and round-trip suites under `test/unit/crm/`. Reset idiom: `beforeEach` full `setState` on all four stores; `test/setup.ts` clears localStorage globally. Additive only against the vitest baseline (no baselined-failing file is touched).

**Target Platform**: Electron 33 renderer (Chromium). The layer itself is platform-agnostic ES modules — no `electron`, `node:*`, or DOM imports.

**Project Type**: Desktop app (Electron + React) — this feature contributes a **domain layer only** (no UI, no routes, no IPC).

**Performance Goals**: All CRM operations synchronous in-renderer. Seed hydration of the four stores completes in <50 ms on the golden-path fixture size. Integrity repair over an empty-or-clean state is a no-op that returns in <5 ms. Selectors return stable `EMPTY_ARRAY` / `EMPTY_MAP` constants so React consumers in F02+ do not re-render on empty-to-empty transitions. `resolveConflict()` completes as a single logical transaction observable to any zustand subscriber (no partial states between the seven side-effects).

**Constraints**:
- Zero UI, zero routes, zero network calls, zero new dependencies.
- Money persisted as integer pence (`number`, branded `Pence`); never `bigint` (unserialisable), never a display string.
- Per-case stream cap `STREAM_ENTRIES_PER_CASE_CAP = 200` enforced at write time; unresolved `conflict` / `approval` entries are ineligible for eviction; a truncation marker is inserted on eviction.
- Base branch is `lendmind-crm`; PR targets `lendmind-crm`, never `main`.
- Must pass repo gates: `pnpm type-check`, `pnpm lint`, `pnpm build`, design-token scan over all of `src/` (including fixtures — semantic tone keys only, no hex / `#` / rgb / direct Tailwind color classes), no-legacy-backend gate (`/camel/i` — the two-word form is forbidden anywhere in the diff, only `camelCase` as one token is exempt), no-dead-brain-identifier gate (no `fetchGet`, `uploadFile`, etc.), i18n parity (no locale keys added), vitest baseline additive-only.
- License header block required on every new `.ts` file, matching the top of `src/store/spaceStore.ts`.

**Scale/Scope**: ~15–20 new files under `src/crm/`; ~60–80 new passing vitest tests. Golden-path holds 2 cases, 3 clients, 6 documents, 8 pipeline rows, 6 worklist items, 10 criteria checks, ~14 products (5 in the 2-year primary + 9 across solver universes), ~10 stream entries with full reasoning traces, 4 retention entries. Persisted payload target <200 KB with fixtures loaded.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Result: N/A — constitution not ratified.** `.specify/memory/constitution.md` remains the unfilled template (placeholders like `[PRINCIPLE_1_NAME]` and `[GOVERNANCE_RULES]` are still in place; no numbered principles have been adopted). There are therefore no constitutional gates to evaluate for F01.

In lieu of a constitution, the project-level gates enumerated under **Constraints** (repo lint / type-check / design-token / no-legacy-backend / no-dead-brain / i18n / vitest baseline / license header) are treated as binding for this feature, and every acceptance criterion in the spec (§ SC-004) explicitly asserts they pass. This gate is re-evaluated after Phase 1 with the same result.

## Project Structure

### Documentation (this feature)

```text
specs/001-crm-domain-core/
├── plan.md              # This file (/speckit-plan output)
├── spec.md              # Multi-persona spec (already present)
├── research.md          # Phase 0 output — see below
├── data-model.md        # Phase 1 output — entity map + invariants
├── quickstart.md        # Phase 1 output — headless validation guide
├── contracts/           # Phase 1 output — TS contract signatures
│   ├── README.md
│   ├── stores.d.ts
│   ├── selectors.d.ts
│   ├── export.d.ts
│   └── integrity.d.ts
├── checklists/          # (pre-existing) spec-quality checklists
└── tasks.md             # /speckit-tasks output — NOT created here
```

### Source Code (repository root)

Single-project TypeScript source tree (Electron + React app). This feature is a **purely additive** subtree under `src/crm/`; no existing file outside that subtree is modified.

```text
src/
├── crm/                              # NEW — the entire feature
│   ├── domain/
│   │   ├── types.ts                  # Every entity + enum + ReasoningTrace shape; CRM_SCHEMA_VERSION
│   │   ├── stages.ts                 # 8-stage catalog with semantic tone keys; stageIndex, nextStage
│   │   ├── money.ts                  # Pence branded type; formatGbp, parseGbp
│   │   ├── ids.ts                    # newCrmId(prefix) on top of generateUniqueId()
│   │   └── factFindSchema.ts         # Field-key tuples per section per applicant category (as const)
│   ├── clientsStore.ts               # useCrmClientsStore + getCrmClientsStore
│   ├── casesStore.ts                 # useCrmCasesStore + fact-find actions + completeness math
│   ├── documentsStore.ts             # useCrmDocumentsStore + checklist actions
│   ├── workstreamStore.ts            # useCrmWorkstreamStore + stream cap + FieldChangeEvent log
│   ├── selectors.ts                  # Pure cross-store derivations (returns stable empty constants)
│   ├── integrity.ts                  # crmIntegrityRepair() + RepairReport surfacing
│   ├── caseFile.ts                   # exportCaseFile / importCaseFile / clearAllCrmState
│   ├── fixtures/
│   │   ├── clients.ts                # aisha, daniel, tom (+ adviser eleanor_vance)
│   │   ├── case417.ts                # LM-2026-0417 full profile incl. Daniel probation + salary conflict
│   │   ├── case392.ts                # LM-2026-0392 Tom self-employed remortgage + retention 79d
│   │   ├── pipeline.ts               # 8-row pipeline dataset
│   │   ├── documents.ts              # 6 documents + insights + joint bank statement 0.74 attribution
│   │   ├── checklists.ts             # per-owner checklist (aisha 4 / daniel 3 / joint 3)
│   │   ├── worklist.ts               # 6 worklist items in order
│   │   ├── stream417.ts              # 8 stream entries with full ReasoningTraces
│   │   ├── stream392.ts              # 2 stream entries
│   │   ├── criteria.ts               # 10 criteria checks with per-lender impacts
│   │   ├── products.ts               # 2-year primary + SOLVER_LENDERS + SOLVER_LENDERS_5YR
│   │   ├── compliance.ts             # c417 compliance record
│   │   ├── retention.ts              # 4-entry retention radar
│   │   └── goldenPath.ts             # Bundles all fixtures into one export
│   ├── seed.ts                       # seedCrmGoldenPath() — dev-gated, idempotent
│   └── index.ts                      # Public barrel (re-exports the public surface only)
└── store/spaceStore.ts               # UNCHANGED — read as a template for persist envelope shape

test/
└── unit/crm/                         # Broader integration + round-trip tests
    ├── seed.integration.test.ts      # Journey A — seed → selectors match §SC-001
    ├── conflict.integration.test.ts  # Journey B — resolveConflict → 7 side-effects + audit
    ├── export.integration.test.ts    # Journey C — seed → export → wipe → import → export2 byte-equal
    ├── integrity.test.ts             # Placeholder / prune / recompute passes + RepairReport surface
    ├── persist.roundtrip.test.ts     # JSON.stringify each partialized state; migrate(fixture, 0)
    └── envMismatch.test.ts           # storageEnvironmentKey mismatch clears state

# Co-located store-action tests:
# src/crm/clientsStore.test.ts
# src/crm/casesStore.test.ts
# src/crm/documentsStore.test.ts
# src/crm/workstreamStore.test.ts
# src/crm/selectors.test.ts
# src/crm/domain/money.test.ts
# src/crm/domain/stages.test.ts
# src/crm/caseFile.test.ts
```

**Structure Decision**: Single-project layout. The feature adds one new top-level subtree (`src/crm/`) plus one test subtree (`test/unit/crm/`). No existing source files are modified. This mirrors the house convention where each domain slice (space, project, aion*, workflow) owns a subtree and its store lives at the same depth as its consumers, and it keeps the additive-only invariant that lets F02–F17 land as pure consumers.

## Complexity Tracking

*Constitution Check yielded no violations to justify (no ratified principles).* Recording the non-obvious spec-level decisions here for the record, as they may look like added complexity without the spec context:

| Decision | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| First-class `ConflictRecord` + composite address `(caseId, clientId, section, fieldKey)` (spec FR-032, FR-033) | Both original competing values must persist for FCA defensibility; the composite address is the only key that survives export → wipe → import re-linking. | Boolean `conflict:true` on the field is cheaper but cannot render both sides in the UI and cannot round-trip the audit; adopting it now would force a schema migration in F02. |
| Single ordered `crmIntegrityRepair()` in `queueMicrotask` (spec FR-036) | Per-store repair sees half-hydrated siblings; a single ordered pass is deterministic, testable, and produces one `RepairReport`. | Ad-hoc per-store repair drifts and races; would require duplicated logic in each store's `onRehydrateStorage`. |
| Stream cap enforced at write time with truncation marker + unresolved-ineligibility rule (spec FR-030) | The localStorage envelope is bounded (~5 MB browser quota) but the FCA archive is the export, not the envelope; unresolved *needs you* items must never be silently dropped. | An unbounded stream eventually blows localStorage quota; a naive tail-drop violates the "never quietly evict unresolved" commitment (§ Summary bullet 3). |
| Fixtures live under `src/crm/fixtures/` (not `test/fixtures/`) | F02–F05 UI demos import the golden path at runtime via `seedCrmGoldenPath()`; this is the substrate every later feature renders against. | `test/fixtures/` cannot be imported from `src/` under the repo's tsconfig `rootDirs`. |

---

## Phase 0 — Research (see `research.md`)

All Technical Context fields above are resolved (no `NEEDS CLARIFICATION` remain). `research.md` records the decisions with rationale and rejected alternatives for the four load-bearing choices where the design space had real optionality: money representation, cross-store integration style, stream-cap enforcement point, and fixture location.

## Phase 1 — Design & Contracts (see `data-model.md`, `contracts/`, `quickstart.md`)

- `data-model.md` — every entity, its fields, its cross-store references, invariants (composite conflict address, `origin?` seam, `schemaVersion` stamping), state transitions (worklist `open → resolved`, document `PROCESSING → COMPLETED`, case stage progression, conflict `open → resolved`).
- `contracts/` — TypeScript declaration files documenting the public surface of each store, the pure selectors, the export/import serializers, and the integrity repair. These are contracts against which the implementation and the tests are both written; they are not the implementation.
- `quickstart.md` — a runnable, headless validation guide for User Stories 1, 2, and 3. Prerequisites, setup commands, `vitest` invocations, expected assertions. Links out to `contracts/` and `data-model.md` rather than duplicating field lists.

## Completion Report

- **Branch**: `lendmind-crm` (spec dir `specs/001-crm-domain-core`)
- **Plan**: `specs/001-crm-domain-core/plan.md`
- **Phase 0 artifact**: `specs/001-crm-domain-core/research.md`
- **Phase 1 artifacts**:
  - `specs/001-crm-domain-core/data-model.md`
  - `specs/001-crm-domain-core/quickstart.md`
  - `specs/001-crm-domain-core/contracts/README.md`
  - `specs/001-crm-domain-core/contracts/stores.d.ts`
  - `specs/001-crm-domain-core/contracts/selectors.d.ts`
  - `specs/001-crm-domain-core/contracts/export.d.ts`
  - `specs/001-crm-domain-core/contracts/integrity.d.ts`
- **Constitution Check**: N/A (template not ratified); project-level repo gates enumerated in Technical Context stand in.
- **Next step**: `/speckit-tasks` to generate `tasks.md`.
