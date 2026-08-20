---
description: "Task list for feature implementation — crm-domain-core (F01)"
---

# Tasks: crm-domain-core

**Input**: Design documents from `/specs/001-crm-domain-core/`

**Prerequisites**: plan.md (loaded), spec.md (loaded), research.md, data-model.md, contracts/, quickstart.md — all present.

**Tests**: Test tasks are INCLUDED. SC-005 mandates ≥60 new passing vitest tests; test tasks are first-class rather than optional.

**Organization**: Tasks are grouped by user story so each story can be implemented and tested independently. Every task path is absolute-from-repo-root; every file listed is either new (this feature is additive-only under `src/crm/` and `test/unit/crm/`) or explicitly called out as read-only reference.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Different file, no dependency on any incomplete task in this phase — safe to run in parallel.
- **[Story]**: `[US1]`, `[US2]`, `[US3]` — appears on user-story-phase tasks only.
- File paths in every task.

## Path Conventions

Single-project TypeScript app (Electron + React). New tree: `src/crm/`. Test subtree: `test/unit/crm/`. Nothing outside `src/crm/` is modified except the eslint config for the one-directional import lint rule (a single additive `no-restricted-imports` entry in `.eslintrc.cjs` / `eslint.config.*`).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the empty subtrees and register the cross-store import lint rule. No feature code yet.

- [x] T001 Create the directory tree `src/crm/{domain,fixtures}` and `test/unit/crm/` (empty directories, ready for feature files)
- [x] T002 [P] Capture the exact license header block from the top of `src/store/spaceStore.ts` into a scratch file `src/crm/.license-header.txt` for reuse by every new `.ts` file in this feature (tracked, not committed if the repo convention is inline — check the actual header form before deciding)
- [x] T003 Add the one-directional cross-store `no-restricted-imports` ESLint rule to the repo's existing eslint config (additive entry only; no other rules touched) forbidding: `src/crm/clientsStore.ts` from importing anything under `src/crm/{casesStore,documentsStore,workstreamStore}`; `src/crm/casesStore.ts` from importing `documentsStore`/`workstreamStore`; `src/crm/documentsStore.ts` from importing `workstreamStore` (spec FR-014)
- [x] T004 [P] Verify `pnpm type-check`, `pnpm lint`, `pnpm build`, and `pnpm test` are all green on the base branch before any feature file lands (baseline capture — used to prove SC-004 / SC-005 additivity)

**Checkpoint**: The empty subtree exists, the lint rule is armed, and the baseline is green. Foundational work can begin.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The typed domain primitives, four persisted store shells, empty-state constants, integrity repair scaffold, and public barrel that EVERY user story depends on. No user story work begins until this phase is complete.

**⚠️ CRITICAL**: The four stores' persist envelope shape (version, migrate, partialize allowlist, storageEnvironmentKey), the domain types, and the empty-constants module must exist before any action, fixture, selector, seed, or export code can be authored.

### Domain primitives

- [x] T005 [P] Author `src/crm/domain/types.ts` — every entity type per data-model §2 (Client, Case, Applicant, FactFindField, FactFindSection, CaseProperty, Deposit, Requirement, Affordability, CrmDocument, DocInsight, DocChecklistItem, WorklistItem, StreamEntry, ReasoningTrace, EvidenceCitation, ActivityEvent, CriterionCheck, Product, RetentionEntry, ConflictRecord, ConflictValue, FieldChangeEvent, RepairReport, CaseFileExport, ComplianceRecord), every enum (Stage, WorklistKind, StreamKind, DocumentStatus, ChecklistStatus, CriterionStatus), the discriminated-union `FieldValue` keyed by `t` (spec FR-004), the `origin?: {artifactId, runId}` seam on every agent-producible entity (spec FR-002), and `export const CRM_SCHEMA_VERSION = 1` (spec FR-003). License header at top.
- [x] T006 [P] Author `src/crm/domain/money.ts` — branded `Pence = number & { readonly __brand: 'Pence' }`, `formatGbp(pence: Pence, opts?: {compact?: boolean}): string`, `parseGbp(input: string): Pence | null` (spec FR-010). License header at top.
- [x] T007 [P] Author `src/crm/domain/stages.ts` — the 8-stage catalog `{key, label, short, tone}` where `tone` is a semantic tone key string (never hex/rgb/tailwind color — spec FR-008), plus pure helpers `stageIndex(stage: Stage): number` and `nextStage(stage: Stage): Stage | null` (spec FR-009). License header at top.
- [x] T008 [P] Author `src/crm/domain/ids.ts` — `newCrmId(prefix: 'client'|'case'|'doc'|'insight'|'wl'|'stream'|'event'|'conflict'|'stream_trunc'): string` composed on top of the repo's existing `generateUniqueId()` helper (spec FR-011). License header at top.
- [x] T009 [P] Author `src/crm/domain/factFindSchema.ts` — required field-key tuples per section per applicant category (employed keys for Aisha/Daniel; self-employed keys for Tom), all `as const` so the union of legal keys is derivable at the type level (spec FR-006). License header at top.
- [x] T010 [P] Author `src/crm/domain/emptyConstants.ts` — export shared `EMPTY_ARRAY: readonly never[]` and `EMPTY_MAP: ReadonlyMap<never, never>` referentially-stable singletons for selectors to return on empty input (spec FR-043). License header at top.

### Store shells (persist envelope shape only — actions land in the user story phases)

- [x] T011 [P] Author `src/crm/clientsStore.ts` — `useCrmClientsStore` + `getCrmClientsStore()` with `persist({name: 'crm-clients-store', version: CRM_CLIENTS_PERSIST_VERSION, migrate, partialize (allowlist), storageEnvironmentKey: getAuthEnvironmentKey()})` per `spaceStore.ts:764-801` template; state shape only (`clients: Record<string, Client>`), empty action stubs for later phases (spec FR-012). License header at top.
- [x] T012 [P] Author `src/crm/casesStore.ts` — `useCrmCasesStore` + `getCrmCasesStore()` with `crm-cases-store` envelope; state shape `{cases: Record<string, Case>, conflicts: Record<string, ConflictRecord>, criteria: Record<string, CriterionCheck>, products: Record<string, Product>, compliance: Record<string, ComplianceRecord>}`; empty action stubs (spec FR-012).
- [x] T013 [P] Author `src/crm/documentsStore.ts` — `useCrmDocumentsStore` + `getCrmDocumentsStore()` with `crm-documents-store` envelope; state shape `{documents: Record<string, CrmDocument>, checklist: Record<string, DocChecklistItem>}`; empty action stubs (spec FR-012).
- [x] T014 [P] Author `src/crm/workstreamStore.ts` — `useCrmWorkstreamStore` + `getCrmWorkstreamStore()` with `crm-workstream-store` envelope; state shape `{worklist: Record<string, WorklistItem>, stream: Record<string /* caseId */, StreamEntry[]>, activity: Record<string /* caseId */, ActivityEvent[]>, retention: RetentionEntry[], fieldChangeEvents: FieldChangeEvent[], lastRepairReport: RepairReport | null}`; empty action stubs (spec FR-012).

### Integrity repair scaffold + public barrel

- [x] T015 Author `src/crm/integrity.ts` — export `crmIntegrityRepair(): RepairReport` skeleton with the six ordered passes stubbed (spec FR-036: placeholder clients, placeholder document owners, prune orphan worklist, prune orphan stream, prune orphan activity, recompute case completeness), plus `getLastRepairReport(): RepairReport | null` reading from `workstreamStore`, plus queueMicrotask post-hydration wiring hooked from each store's `onRehydrateStorage` (a barrier that fires the single pass once all four stores have hydrated). Implementations for each pass land in T085; this task lands the entry-point wiring only. Depends on T011–T014.
- [x] T016 Author `src/crm/index.ts` — public barrel that re-exports ONLY the public surface (all four `useCrm*Store` hooks + `getCrm*Store()` accessors, all types from `domain/types.ts`, `CRM_SCHEMA_VERSION`, `crmIntegrityRepair`, `getLastRepairReport`, `EMPTY_ARRAY`, `EMPTY_MAP`, `formatGbp`, `parseGbp`, stage catalog + helpers, `newCrmId`, factFindSchema tuples). Does NOT re-export anything under `src/crm/fixtures/` (fixtures are internal). Depends on T005–T015.

### Foundational tests

- [x] T017 [P] Test `src/crm/domain/money.test.ts` — asserts `formatGbp(4_275_000 as Pence) === '£42,750.00'`; compact form `'£42.8k'`; `parseGbp('£38,500') === 3_850_000`; `parseGbp('nonsense') === null`; branded-type prevents assigning raw number without cast (compile-time assertion via `// @ts-expect-error`). Depends on T006.
- [x] T018 [P] Test `src/crm/domain/stages.test.ts` — asserts the 8-stage order, `stageIndex` monotonic, `nextStage('COMPLETION') === null`, every `tone` value is a semantic token key (regex: no `#`, no `rgb(`, no direct tailwind color class like `bg-red-500`). Depends on T007.
- [x] T019 [P] Test `src/crm/domain/ids.test.ts` — asserts each supported prefix produces an id starting with `<prefix>_` and uniqueness across 1000 sequential calls. Depends on T008.

**Checkpoint**: Foundation ready — the four stores hydrate against empty state with correct envelope keys, domain primitives typecheck, integrity scaffold is wired. User story implementation can now begin.

---

## Phase 3: User Story 1 — Seed and read the golden path (Priority: P1) 🎯 MVP

**Goal**: Boot a fresh renderer (empty localStorage), invoke `seedCrmGoldenPath()`, and read the fully-populated Lendmind case book — cases c417 and c392, 8-row pipeline, 6 worklist items, 6 documents with insights, reasoning-traced stream entries, criteria checks, products universes, retention radar, compliance record — via pure selectors that match the design reference's headline numbers exactly (SC-001).

**Independent Test**: Boot clean vitest → `seedCrmGoldenPath()` → assert `selectNeedsYouCount()=6`, `selectPipelineCounts()` totals 8 with the §3.6 distribution, `selectCaseCompleteness('c417') ∈ [0.895, 0.905]`, `selectNeedsYou()` returns the 6 items in design order, `selectRetentionUrgency(now=2026-06-13)` ranks Tom's 79-day entry first.

### Store actions required by US1 (read + basic write path)

- [x] T020 [US1] Add action `upsertClients(clients: Client[])` to `src/crm/clientsStore.ts` — insert-or-update by id, stamps `schemaVersion`, dedupes; also add `noteClientCase(clientId, caseId)` (append if not present) and `ensureClient(id): Client | Placeholder` returning a `repaired:true` placeholder for missing ids (spec FR-015, FR-017, FR-038). Depends on T011.
- [x] T021 [US1] Add action `upsertCases(cases: Case[])` to `src/crm/casesStore.ts` — insert-or-update by id, stamps `schemaVersion`; add `upsertConflictRecords(records)`, `upsertCriteriaChecks(checks)`, `upsertProducts(products)`, `upsertCompliance(record)` for fixture load. Add pure `computeSectionCompleteness(section, requiredKeys)` and `computeCaseCompleteness(applicants[])` as module-level functions importable without instantiating a store (spec FR-007). Depends on T012, T005, T009.
- [x] T022 [US1] Add action `addDocument(doc)` (`PROCESSING` state if `attribution == null`), `completeDocument(id, {type, attribution, insights})`, `upsertDocuments(docs[])` (bulk load path for fixtures), and `setChecklistStatus(owner, itemKey, status, {note?})` to `src/crm/documentsStore.ts` (spec FR-023, FR-024, FR-025). Depends on T013.
- [x] T023 [US1] Add actions `pushStreamEntry(caseId, entry)` (stamps id/schemaVersion, preserves `trace` verbatim, cap enforcement lands in T072), `noteActivity(caseId, activity)`, `upsertWorklistItems(items[])`, `upsertRetention(entry)` (keyed by `clientId + endsAt`), and read helpers `getFieldChangeEventsForField(caseId, clientId, section, fieldKey)`, `getFieldChangeEventsForCase(caseId)` (ascending by `changedAt`) to `src/crm/workstreamStore.ts` (spec FR-028, FR-029, FR-031, FR-034). Depends on T014.

### Fixtures (faithful transcription of the design reference — one file per concern; all use only semantic tone keys per FR-045)

- [x] T024 [P] [US1] Author `src/crm/fixtures/clients.ts` — export `aishaOkafor`, `danielReyes`, `tomHargreaves`, and adviser fixture `adviserEleanorVance` (per design reference §3.1 and §3.4), with `tint`/`textCls` as semantic tone keys only. Depends on T005.
- [x] T025 [P] [US1] Author `src/crm/fixtures/case417.ts` — case `c417` (LM-2026-0417): FTB purchase, 8 Brookfield Avenue Didsbury £285,000, deposit £42,750 (15%) including £2,000 gift flag, £242,250 loan (24_225_000 pence), 85% LTV, 32-year term, C&I, 2-year fixed. Applicants: Aisha (primary) + Daniel (secondary). Fact-find sections populated for both applicants with every FR-006 employed field key at correct `src` and `hint`; Daniel's `employment` carries `inProbation:true`, `startDate:'2026-01-06'`, `yearsInRole:0.4`; Daniel's `income.basic` carries `conflictId` referencing the salary conflict fixture; `ownership: {adviserId:'adviser_eleanor_vance', firmId:'firm_meridian_mortgages', networkId:'network_stonebridge'}` (spec FR-022, FR-044). Depends on T005, T009, T024.
- [x] T026 [P] [US1] Author `src/crm/fixtures/case392.ts` — case `c392` (LM-2026-0392): Tom Hargreaves solo remortgage, 22 Royal York Crescent Clifton £520,000, equity deposit £208,000 (40%), £335,000 loan, 5-year fixed, `retention: {reason:'Fixed rate ends 31 Aug 2026', daysLeft:79}`. Fact-find sections populated with FR-006 self-employed keys. Ownership seeded to Eleanor Vance (spec FR-044). Depends on T005, T009, T024.
- [x] T027 [P] [US1] Author `src/crm/fixtures/pipeline.ts` — 8-row pipeline dataset per design reference §3.6, including cases `c417` and `c392` and 6 pipeline-only stubs achieving the stage distribution `{LEAD:1, FACT_FIND:2, SOURCING:0, DIP:1, APPLICATION:1, VALUATION:1, OFFER:1, COMPLETION:1}` (spec SC-001). Depends on T005.
- [x] T028 [P] [US1] Author `src/crm/fixtures/documents.ts` — 6 documents per design reference §3.7 with typed insights: joint bank statement `attribution: 0.74`; employment contract with `Salary` insight `conflict:true` (linked to the salary `ConflictRecord` in `conflicts.ts`); all others per reference. Every `iconTone` is a semantic token key (spec FR-044, FR-045). Depends on T005.
- [x] T029 [P] [US1] Author `src/crm/fixtures/checklists.ts` — per-owner checklist per §3.8: 4 aisha items, 3 daniel items, 3 joint items with correct statuses. Depends on T005.
- [x] T030 [P] [US1] Author `src/crm/fixtures/worklist.ts` — 6 worklist items in design-reference order (kinds `conflict, criteria, doc/auto, approval, doc/auto, retention`), each linked to real fixture entities: item `w1` links to the salary conflict, `w4` links to the compliance approval etc (spec FR-044 acceptance #4). Depends on T005, T028.
- [x] T031 [P] [US1] Author `src/crm/fixtures/conflicts.ts` — the c417 Daniel-income-basic `ConflictRecord` with both `ConflictValue`s populated: `{value: {t:'money', v:3_850_000}, source:{kind:'document', docId:'d5', insightLabel:'Salary', quote:'…'}}` and `{value: {t:'money', v:3_730_000}, source:{kind:'document', docId:'d2', insightLabel:'Annual income', quote:'…'}}`; composite address `(c417, danielId, 'income', 'basic')`; `detectedAt` set (spec FR-032). Depends on T005.
- [x] T032 [P] [US1] Author `src/crm/fixtures/stream417.ts` — 8 stream entries per §3.22 STREAM_417 with full `ReasoningTrace`s: claim, subject, numbered working, cited evidence with verbatim quotes and `source` refs (e.g. `'Halifax criteria · Section 4.2 v24.6'`, `'Page 1, line 18'`), alternatives where design specifies, calibrated confidences `.96, .78, .93, .85, .96, .95, .93, 1.0`; live solver entry pinned first (spec FR-044). Depends on T005.
- [x] T033 [P] [US1] Author `src/crm/fixtures/stream392.ts` — 2 stream entries per §3.22 STREAM_392 with full traces. Depends on T005.
- [x] T034 [P] [US1] Author `src/crm/fixtures/criteria.ts` — 10 criteria checks per §3.12, each with `group`, `status`, `reasoning`, `impacts[]` per-lender note as specified (spec FR-044). Depends on T005.
- [x] T035 [P] [US1] Author `src/crm/fixtures/products.ts` — primary 2-year universe `hx, nw, ac, sk, cov` (§3.13) with passes/fails preserved; every `pass` row carries non-empty `rationale` and `criteriaTrail`; every `fail` row carries `rejectReason`, `rejectCriterion` (e.g. `'Skipton § 3.1 Employment tenure'`), `failOn`. Export `SOLVER_LENDERS` (`tsb, barclays, santander, natwest`) and `SOLVER_LENDERS_5YR` (Halifax, Nationwide, Accord 5yr) as separate arrays (spec FR-044 acceptance #6). Depends on T005.
- [x] T036 [P] [US1] Author `src/crm/fixtures/compliance.ts` — c417 compliance record per §3.20: disclosures, ID&V, AML SmartSearch, vulnerability, Consumer Duty pillars, declaration, supervision items (including the pending gifted-deposit letter) (spec FR-044). Depends on T005.
- [x] T037 [P] [US1] Author `src/crm/fixtures/retention.ts` — 4-entry retention radar per §3.11: Tom's 79-day entry at top, plus three other clients' entries with correctly-computed `daysLeft` values relative to seed clock (spec FR-044). Depends on T005.
- [x] T038 [US1] Author `src/crm/fixtures/goldenPath.ts` — bundles all above fixtures into `{clients[], adviser, cases[], documents[], checklist[], worklist[], stream: {c417, c392}, activity[], criteria[], products[], compliance[], retention[], conflicts[]}` for the seed to iterate over once. Depends on T024–T037.

### Seed

- [x] T039 [US1] Author `src/crm/seed.ts` — `seedCrmGoldenPath()`: dev-gated (guarded by the same idiom as `INITIAL_BLANK_SPACE_CREATED_FROM` in `spaceStore.ts`; falls back to `import.meta.env.DEV`), idempotent (returns early with no writes if any of the four stores is non-empty). Writes fixtures to all four stores such that a zustand subscriber observes ONE non-empty transition per store (single `setState` per store — no per-record loops that would trigger intermediate emissions) (spec FR-046, User Story 1 acceptance #2). Emits `FieldChangeEvent`s with `reason: 'seed'` for the seeded fact-find fields (spec FR-034). Depends on T020–T023, T038.

### Selectors

- [x] T040 [US1] Author `src/crm/selectors.ts` — pure module-level selector functions each returning stable empty constants (`EMPTY_ARRAY` / `EMPTY_MAP`) on empty input (spec FR-042, FR-043):
  - `selectNeedsYou(worklist)` — items with `status: 'open'` ordered per design
  - `selectNeedsYouCount(worklist)`
  - `selectPipelineCounts(cases)` — record keyed by stage
  - `selectOpenConflicts(cases, conflicts)` — active `ConflictRecord`s
  - `selectRetentionUrgency(entries, now)` — sorted ascending `daysLeft`, `<90` = urgent
  - `selectCaseStreamSections(stream)` — returns ordered `{live[], needsYou[], directives[], activity[]}`
  - `selectDetSynCounts(applicant)` — `{det, syn, awaiting}`
  - `selectCaseCompleteness(caseId, casesState)`
  Depends on T005, T010, T012, T014.

### Co-located and integration tests for US1

- [x] T041 [P] [US1] Test `src/crm/clientsStore.test.ts` — `upsertClients` idempotence; `noteClientCase` append-if-absent; `ensureClient` returns `{repaired:true}` placeholder for missing id and never throws. Depends on T020.
- [x] T042 [P] [US1] Test `src/crm/casesStore.test.ts` (US1 subset) — `upsertCases` idempotence; `computeCaseCompleteness` pure math for the c417 fixture returns `[0.895, 0.905]`; `upsertConflictRecords` insert path; ownership object seeded correctly. (Conflict-resolution behavior tests live in T059.) Depends on T021, T025.
- [x] T043 [P] [US1] Test `src/crm/documentsStore.test.ts` (US1 subset) — `addDocument` sets `PROCESSING` if attribution null; `completeDocument` flips to `COMPLETED`; `confirmAttribution` timestamp; `setChecklistStatus` per owner; document-insight `conflict:true` does NOT auto-mutate any fact-find field (spec FR-026). Depends on T022.
- [x] T044 [P] [US1] Test `src/crm/workstreamStore.test.ts` (US1 subset) — `pushStreamEntry` preserves `trace` verbatim (deep-equal after append); `noteActivity` appends; `upsertRetention` keyed by `(clientId, endsAt)` — same key updates in place, different key appends. (Cap eviction, FieldChangeEvent queries, and resolveWorklistItem behavior live in later tasks.) Depends on T023.
- [x] T045 [P] [US1] Test `src/crm/selectors.test.ts` — every selector returns `EMPTY_ARRAY`/`EMPTY_MAP` singletons on empty input (`selector(empty) === selector(empty)` referential equality); every selector output matches fixture expectations after seed (asserted numbers: `selectNeedsYouCount === 6`, pipeline distribution, c417 completeness in range, retention ranking) (spec FR-042, FR-043, SC-001). Depends on T039, T040.
- [x] T046 [P] [US1] Test `src/crm/fixtures/goldenPath.test.ts` — fixture-integrity assertions independent of the stores: c417 LTV = 85% (±0.01) (computed `deposit / propertyPrice`), LTI = 2.95× (±0.01), loan = 24_225_000 pence, combined income = £82,100; Daniel's `income.basic` field carries the `conflictId` matching the ConflictRecord id; every c417 sourcing `pass` row has non-empty `rationale` and `criteriaTrail`; every `fail` row carries `rejectReason`, `rejectCriterion`, `failOn`; every fixture color reference is a semantic tone key (regex scan). Depends on T038.
- [x] T047 [US1] Integration test `test/unit/crm/seed.integration.test.ts` — the full Journey A per quickstart.md § Journey A: reset all four stores in `beforeEach`; assert stores start empty; subscribe with spies before `seedCrmGoldenPath()`; assert one non-empty transition per store; assert the four `localStorage` envelope keys exist under the current environment key; second call is a no-op (no additional persist writes, no duplicate records); run every SC-001 selector assertion (needsYouCount, pipelineCounts, c417 completeness, needsYou order, streamSections with live solver first, retentionUrgency ranking) (spec User Story 1 acceptance #1–#6). Depends on T039, T040.

**Checkpoint**: User Story 1 is fully functional and testable independently. `seedCrmGoldenPath()` populates the four stores with the golden path; selectors return the design-reference headline numbers. This is a shippable MVP for F02–F05 UI consumption.

---

## Phase 4: User Story 2 — Resolve a conflict atomically, with a persisted audit (Priority: P2)

**Goal**: `resolveConflict(conflictId, {chosenValue, method, resolvedBy, reasoning?})` performs in one call across three stores every side-effect required for FCA / Consumer Duty defensibility — field mutation with `FieldChangeEvent`, `ConflictRecord` resolution retaining both original values, document insight flip, worklist status change (never delete), stream entry with full `ReasoningTrace` — with no partial-state observability by any zustand subscriber.

**Independent Test**: Seed golden path → capture initial state → subscribe spies → call `resolveConflict(w1LinkedConflictId, {chosenValue:{t:'money', v:3_850_000}, method:'confirm-value', resolvedBy:'EV', reasoning:'…'})` → assert all seven side-effects (a)–(g) after exactly one emission per affected store → assert both original `ConflictValue`s still preserved → assert idempotent second call → assert round-trip through export/wipe/import preserves the resolved state.

### Actions

- [x] T048 [US2] Add `setFactFindField(caseId, clientId, section, fieldKey, newValue: FieldValue, {reason?: FieldChangeEvent['reason'], changedBy: string, src?: 'det'|'syn'})` to `src/crm/casesStore.ts` — one store update: write field value + `src` (defaults to `'det'`), emit a `FieldChangeEvent` to workstream store capturing `{priorValue, newValue, priorSrc, newSrc, changedAt: Date.now(), changedBy, reason: reason ?? 'edit'}`, recompute the affected section's completeness. Guards against writing money as a display string (type-level via `FieldValue.t`, runtime via a defensive check on `t:'money'` payloads) (spec FR-018). Depends on T021, T023.
- [x] T049 [US2] Add `confirmSynthesizedField(caseId, clientId, section, fieldKey, {confirmedBy})` to `src/crm/casesStore.ts` — flip `src: 'syn' → 'det'`, record `confirmedAt: Date.now()` and `confirmedBy` on the field, emit `FieldChangeEvent` with `reason: 'confirm-synthesized'` (spec FR-019). Depends on T048.
- [x] T050 [US2] Add `moveStage(caseId, nextStageKey: Stage)` to `src/crm/casesStore.ts` — validates `nextStageKey` via `stageIndex`/`nextStage` (does not skip stages silently — throws / returns typed refusal for a bad key), updates `Case.stage`, appends `ActivityEvent` via `workstreamStore.noteActivity` (spec FR-021). Depends on T021, T023, T007.
- [x] T051 [US2] Add `resolveWorklistItem(id, {resolution, resolvedBy})` to `src/crm/workstreamStore.ts` — sets `status: 'resolved'`, `resolvedAt: Date.now()`, `resolvedBy`, `resolution: {…}`; item is **retained** (never deleted); second call on an already-resolved item is a no-op (spec FR-027). Depends on T023.
- [x] T052 [US2] Add `resolveConflict(conflictId, {chosenValue: FieldValue, method: 'confirm-value'|'ask-client', resolvedBy: string, reasoning?: string})` to `src/crm/casesStore.ts` — the atomic orchestration (spec FR-020, User Story 2 acceptance #1). Sequence (all in one setState per store, in fixed order `cases → documents → workstream`, so no subscriber can observe partial state):
  - Idempotence guard: if `ConflictRecord.resolvedAt` already set, return with no side-effects.
  - Cases store setState: (a) `setFactFindField` semantics on the referenced field with `reason:'conflict-resolution'`, `src: 'det'`, `chosenValue`; (b) mark `ConflictRecord.resolvedAt`, `.resolvedBy`, `.resolution = {method, reasoning}` while PRESERVING both `values[]` entries.
  - Documents store setState: (c) flip corresponding document-insight (`d5` Salary) from `conflict:true` to `conflict:false`.
  - Workstream store setState: (d) `resolveWorklistItem(linkedWorklistItemId, {resolution:{method, reasoning}, resolvedBy})`; (e) `pushStreamEntry(caseId, {kind:'done', trace: {claim, working, evidence citing d5 and d2 verbatim, alternatives listing the not-chosen value, confidence:1.0, calibration: reasoning}})`; (f) `FieldChangeEvent` with `reason:'conflict-resolution'`, `conflictId` set (already emitted by the cases-side `setFactFindField` — assert one and only one such event fires).
  - Section-completeness recompute (g) is a side-effect of (a) — no explicit action needed.
  Depends on T048, T051.

### Tests for US2

- [x] T053 [P] [US2] Test `src/crm/casesStore.setFactFindField.test.ts` — asserts `setFactFindField` emits exactly one `FieldChangeEvent` with `{priorValue, newValue, priorSrc, newSrc, changedAt, changedBy, reason}` correctly populated; asserts section completeness recomputed; asserts writing a money field with `t:'money'` accepts `Pence` and (defensive) rejects a display string at runtime (spec FR-018, FR-034). Depends on T048.
- [x] T054 [P] [US2] Test `src/crm/casesStore.confirmSynthesizedField.test.ts` — asserts `src: 'syn' → 'det'`, `confirmedAt` and `confirmedBy` populated, `FieldChangeEvent` with `reason:'confirm-synthesized'` emitted (spec FR-019). Depends on T049.
- [x] T055 [P] [US2] Test `src/crm/casesStore.moveStage.test.ts` — asserts valid `nextStageKey` transitions succeed, appends ActivityEvent; asserts an invalid skip returns typed refusal / throws (per implementation choice) without mutating state (spec FR-021). Depends on T050.
- [x] T056 [P] [US2] Test `src/crm/workstreamStore.resolveWorklistItem.test.ts` — asserts item transitions `open → resolved`, is retained (still present in store), second call is no-op; asserts refusal to delete via a nonexistent action path (worklist has no `deleteWorklistItem`) (spec FR-027). Depends on T051.
- [x] T057 [P] [US2] Test `src/crm/workstreamStore.fieldChangeEvents.test.ts` — asserts `getFieldChangeEventsForField(caseId, clientId, section, fieldKey)` returns ascending by `changedAt`; asserts `getFieldChangeEventsForCase(caseId)` scoped correctly; asserts events are never mutated or deleted after append (spec FR-034). Depends on T023, T048.
- [x] T058 [US2] Integration test `test/unit/crm/conflict.integration.test.ts` — the full Journey B per quickstart.md § Journey B: seed → capture initial state (field `conflictId` set, `d5` Salary insight `conflict:true`, `w1` `open`, stream length N, `FieldChangeEvent` count = seed events) → subscribe spy across all four stores → single `resolveConflict` call → assert exactly one emission per affected store (atomicity) → assert all seven side-effects (a)–(g) → assert `ConflictRecord.values[]` still contains both `{v:3_850_000}` and `{v:3_730_000}` → assert idempotent second call (no additional stream entry, no additional FieldChangeEvent) → assert round-trip through export/wipe/import preserves resolved conflict + FieldChangeEvent + done-kind stream entry (spec User Story 2 acceptance #1–#6, SC-002). Depends on T052, T047. Requires T059, T060 (export/import) for the round-trip assertion.

**Checkpoint**: User Story 2 works independently. `resolveConflict` is atomic, produces the full FCA audit trail in one call, is idempotent, and round-trips through export/import.

---

## Phase 5: User Story 3 — Export and wipe for compliance lifecycle (Priority: P3)

**Goal**: `exportCaseFile(caseId): CaseFileExport | {ok:false, reason:'unknown_case'}` (pure, synchronous) produces a self-describing JSON snapshot that includes every record touching the case — case, applicants, referenced clients, documents attributed to either applicant, checklist, worklist, stream with full traces, activity, criteria, products (both universes), compliance, retention, ConflictRecords (open + resolved with both values), FieldChangeEvents. `clearAllCrmState()` empties all four stores and removes only the four CRM localStorage keys. `importCaseFile(export)` re-hydrates. Round-trip is byte-equal after canonicalisation.

**Independent Test**: Seed → `exportCaseFile('c417')` → assert record counts → `clearAllCrmState()` → assert stores empty and CRM keys removed (non-CRM keys untouched) → `importCaseFile(export)` → re-run every Journey A selector → assert byte-equal output → export again → assert `JSON.stringify(canonicalise(export1)) === JSON.stringify(canonicalise(export2))` → negative: `exportCaseFile('nonexistent')` returns `{ok:false, reason:'unknown_case'}` (no throw).

### Actions

- [x] T059 [US3] Author `src/crm/caseFile.ts` — `exportCaseFile(caseId): CaseFileExport | {ok:false, reason:'unknown_case'}` (spec FR-040):
  - Pure synchronous read across the four stores via `getCrm*Store().getState()`.
  - Return `{ok:false, reason:'unknown_case'}` (typed refusal, never a throw) if `caseId` is not present.
  - Build `{envelope: {exportVersion:1, exportedAt: Date.now(), crmSchemaVersion: CRM_SCHEMA_VERSION, caseId}, records: {case, clients (deep), applicants, documents attributed to either applicant, checklist, worklist scoped to case, stream[] with full trace preserved verbatim, activity, criteria, products (both 2yr and 5yr universes), compliance, retention for the referenced clients, conflicts (open + resolved with both `values[]`), fieldChangeEvents matching caseId}}`.
  Depends on T016, T020–T023.
- [x] T060 [US3] Add `importCaseFile(export: CaseFileExport): {ok:true, imported:{cases:number,clients:number,documents:number,workstream:number}} | {ok:false, reason:'id_collision', ids:string[]} | {ok:false, reason:'envelope_incompatible', got:number, expected:number}` to `src/crm/caseFile.ts` — envelope version check (exportVersion 1 only); id-collision check across all four stores BEFORE writing (rejects overwrite, callers wipe first); one-shot re-hydration per store via a single setState (spec FR-041, User Story 3 acceptance #3, id-collision case).
- [x] T061 [US3] Add `clearAllCrmState()` to `src/crm/caseFile.ts` (or `src/crm/reset.ts` if we prefer the same file to hold serializers only) — for each of the four stores: full `setState` to the empty initial-state object; `localStorage.removeItem('crm-clients-store' | 'crm-cases-store' | 'crm-documents-store' | 'crm-workstream-store')`. Does NOT touch any other `localStorage` key (spec FR-039).
- [x] T062 [US3] Add a `canonicalise(export: CaseFileExport): CaseFileExport` helper inside `src/crm/caseFile.ts` — deterministic recursive key-sort producing a canonical form for byte-equal round-trip assertions (spec SC-003). Kept as an implementation detail of the export module (not re-exported from `index.ts`; used by tests via `caseFile.test.ts`).

### Tests for US3

- [x] T063 [P] [US3] Test `src/crm/caseFile.test.ts` — `exportCaseFile('c417')` post-seed asserts record counts (`applicants.length === 2`, `documents.length === 6`, `stream.length >= 7`, `conflicts.length >= 1`); envelope has `exportVersion:1`, `crmSchemaVersion === CRM_SCHEMA_VERSION`, `caseId === 'c417'`; every stream entry retains its full `trace` (deep-equal against fixture); every `ConflictRecord` retains both `values[]`; `exportCaseFile('nonexistent')` returns `{ok:false, reason:'unknown_case'}` and does not throw (spec User Story 3 acceptance #1, negative case). Depends on T039, T059.
- [x] T064 [P] [US3] Test `src/crm/reset.test.ts` — `clearAllCrmState()` empties all four stores; removes exactly the four CRM `localStorage` keys; a synthetic non-CRM key `localStorage.setItem('unrelated', '1')` set beforehand is still present afterwards (spec FR-039, User Story 3 acceptance #2). Depends on T061.
- [x] T065 [US3] Integration test `test/unit/crm/export.integration.test.ts` — the full Journey C per quickstart.md § Journey C: seed → export1 → assert counts and envelope → `clearAllCrmState` → assert stores empty and CRM keys removed → `importCaseFile(export1)` → assert `{ok:true, imported:{...}}` → re-run every Journey A selector → assert byte-equal outputs across the two runs → export2 → assert `JSON.stringify(canonicalise(export1)) === JSON.stringify(canonicalise(export2))` → id-collision case: second import without wipe returns `{ok:false, reason:'id_collision', ids:[...]}` → if Journey B has run before, assert resolved `ConflictRecord`, `FieldChangeEvent`, and done-kind stream entry all round-trip (spec User Story 3 acceptance #1–#5, SC-003). Depends on T059–T062, T047.

**Checkpoint**: User Story 3 works independently. The domain layer round-trips byte-equal through export → wipe → import; the compliance lifecycle floor is in place.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Complete the integrity repair implementations, the stream cap, persist round-trip and envelope-mismatch tests, the cross-store import lint test, and the coverage floor. Everything here can start once US1, US2, US3 are green — most tasks are independent of each other and marked `[P]`.

### Integrity repair — full implementations of the six passes

- [x] T066 [P] Add `Placeholder clients` pass to `src/crm/integrity.ts` (pass #1 per spec FR-036) — for every case whose `Applicant.clientId` references a missing client, insert `{id, firstName:'Unknown', lastName:'(repaired)', tint:'placeholder', repaired:true, insertedAt}` into clientsStore; add ids to `RepairReport.placeholderClientsCreated[]`; case is preserved. Depends on T015, T020.
- [x] T067 [P] Add `Placeholder document owners` pass — for every document whose `owner` clientId is missing, retarget to a placeholder client (as pass #1); add ids to `RepairReport.retargetedDocuments[]`.
- [x] T068 [P] Add `Prune orphan worklist items` pass — remove worklist items whose `caseId` no longer exists; add ids to `RepairReport.prunedWorklist[]`.
- [x] T069 [P] Add `Prune orphan stream entries` pass — remove stream entries whose `caseId` no longer exists; add ids to `RepairReport.prunedStream[]`. Also prune orphan `ActivityEvent`s → `RepairReport.prunedActivity[]`.
- [x] T070 [P] Add `Recompute case completeness` pass — after prior passes, recompute `Case.completeness` and each `Applicant.completeness` for every case that was touched by any earlier pass; add ids to `RepairReport.recomputedCases[]`.
- [x] T071 Wire `RepairReport` surfacing: workstream store caches the last report via `setLastRepairReport(report)`; each state-mutating pass appends an `ActivityEvent` describing the repair; every replaced/pruned record is described with its id via `console.warn` so it appears in dev logs (spec FR-037). Depends on T066–T070.

### Stream cap enforcement

- [x] T072 Implement `STREAM_ENTRIES_PER_CASE_CAP = 200` enforcement in `src/crm/workstreamStore.ts` `pushStreamEntry` (spec FR-030):
  - On append, if adding would push the case above the cap, enumerate eviction-eligible entries: kinds `done`/`external`/`activity` whose linked worklist item (if any) has `status:'resolved'`.
  - Evict the oldest eligible entry.
  - Insert a synthetic marker `{kind:'done', id:'stream_trunc_<n>', title:'Older activity truncated', body:'<count> older entries evicted at cap.', truncatedBefore:<ts>, truncatedCount:<n>}` at the eviction point.
  - If no eligible entries exist (all unresolved), append the new entry and do NOT evict (soft ceiling — unresolved `conflict`/`approval` entries are NEVER evicted).
  Export the cap constant from `src/crm/index.ts`. Depends on T023, T051.

### Client-erasure refusal + activity log

- [x] T073 Add `removeClient(id): {ok:true} | {ok:false, reason:'referenced_by_case', caseIds:string[]}` to `src/crm/clientsStore.ts` — reads `casesStore.getState()` (legal one-directional read per spec FR-014), refuses if any case's applicants reference the client, returns typed refusal (never throws); on refusal, appends an `ActivityEvent` to workstream store recording the refusal (spec FR-016). Depends on T020, T023.

### Cross-cutting tests

- [x] T074 [P] Test `test/unit/crm/persist.roundtrip.test.ts` — for each of the four stores: `JSON.stringify(getCrm*Store().getState())` succeeds after seed (no `bigint`, no `Date` object, no function, no `Symbol`, no `undefined` in persisted values); `persist.getOptions().migrate?.(fixtureEnvelope, 0)` shape-repairs correctly; `partialize` output is exactly the allowlisted keys; envelope shape matches `{state, version, storageEnvironmentKey}` (spec FR-012, edge case "JSON serialization must succeed"). Depends on T011–T014, T039.
- [x] T075 [P] Test `test/unit/crm/envMismatch.test.ts` — write a fake envelope under a different `storageEnvironmentKey` to `localStorage`; force store rehydration; assert state is empty (no cross-tenant bleed); assert the subsequent `crmIntegrityRepair()` `RepairReport` notes `envMismatch: true` (spec edge case, FR-012). Depends on T011–T015, T071.
- [x] T076 [P] Test `test/unit/crm/integrity.test.ts` — six pass conditions of `crmIntegrityRepair()` (spec SC-007):
  - Pass #1: seed with a manually-broken applicant referencing missing `clientId`; assert placeholder client created with `repaired:true`; assert `RepairReport.placeholderClientsCreated` contains its id; assert `ActivityEvent` recorded.
  - Pass #2: document owner missing; assert retargeted.
  - Passes #3/#4: orphan worklist / stream / activity items pruned; report reflects.
  - Pass #5: touched cases recomputed.
  - Also assert `getLastRepairReport()` returns the same report; assert `console.warn` invoked for each pruned/replaced record (spy). Depends on T066–T071.
- [x] T077 [P] Test `src/crm/workstreamStore.streamCap.test.ts` — cap eviction rules (spec FR-030):
  - Populate a case's stream to exactly `STREAM_ENTRIES_PER_CASE_CAP` entries with mixed kinds.
  - Append one more `done`-kind entry; assert oldest eligible entry evicted, truncation marker inserted at the eviction point with correct `truncatedCount` and `truncatedBefore`.
  - Populate a case's stream with only `conflict` and `approval` kinds all linked to `open` worklist items; append one more; assert NO eviction occurred and the append proceeded (soft ceiling).
  - Populate with a mix where a `conflict` entry is linked to a `status:'resolved'` worklist item; assert it IS eligible for eviction (linked worklist item resolved).
  Depends on T072.
- [x] T078 [P] Test `test/unit/crm/crossStoreImports.test.ts` — parse each of the four store files (`clientsStore.ts`, `casesStore.ts`, `documentsStore.ts`, `workstreamStore.ts`) and assert that the direction-forbidden imports per spec FR-014 are absent (regex over the source text: `clientsStore` must not import any of the other three CRM stores; `casesStore` must not import `documentsStore` or `workstreamStore`; `documentsStore` must not import `workstreamStore`). Backs the eslint `no-restricted-imports` rule with an in-suite assertion. Depends on T003, T011–T014.
- [x] T079 [P] Test `src/crm/clientsStore.removeClient.test.ts` — refusal path: seed a case referencing a client; call `removeClient(id)`; assert `{ok:false, reason:'referenced_by_case', caseIds}`; assert client still present; assert an `ActivityEvent` describing the refusal appended to workstream store. Success path: unreferenced client removed cleanly (spec FR-016). Depends on T073.

### Documentation & coverage floor

- [x] T080 [P] Verify the coverage floor: run `pnpm test -- --run test/unit/crm src/crm` and confirm ≥60 new passing tests (spec SC-005). If under, add supplementary tests for the least-covered actions (typically: `noteActivity` shape, `upsertRetention` key semantics both branches, `setChecklistStatus` all four transitions).
- [x] T081 Run `pnpm build && pnpm type-check && pnpm lint && pnpm test` end-to-end; assert every gate green (design-token scan over all of `src/` including fixtures, no-legacy-backend gate for the two-word case-convention token, no-dead-brain-identifier gate, i18n parity, vitest baseline additive-only) — SC-004.
- [x] T082 Confirm `package.json` diff is exactly zero (no new dependencies added — spec constraint).

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: no dependencies — start immediately.
- **Foundational (Phase 2)**: depends on Setup. **BLOCKS** all user stories.
- **User Story 1 (Phase 3)**: depends on Foundational. No dependency on US2 or US3.
- **User Story 2 (Phase 4)**: depends on Foundational and on the US1 action scaffold (T020–T023 add store actions US2 also uses); the US2 integration test T058 also depends on the US3 export/import (T059, T060) for the round-trip assertion — if executing strictly sequentially, either run US3 before that specific assertion or split T058 into two files.
- **User Story 3 (Phase 5)**: depends on Foundational and on US1 (needs seeded state to export).
- **Polish (Phase 6)**: depends on all three user stories being green (integrity + persist tests exercise seeded state; cap enforcement is checked once actions exist).

### User story dependencies

- **US1 (P1)**: no dependencies beyond Foundational — independently deliverable as MVP.
- **US2 (P2)**: independent test path only requires US1 seeded state; the round-trip assertion (T058 step 8) requires US3's `exportCaseFile`/`importCaseFile` — this can be split off if strict independence is required.
- **US3 (P3)**: independent — exports data US1 produced; does not depend on US2.

### Within each user story

- Store actions before fixtures that consume them (T020–T023 → T024–T037).
- Fixtures before seed (T024–T037 → T038 → T039).
- Seed + selectors before integration test (T039, T040 → T047).
- For US2: `setFactFindField` before `resolveConflict` (T048 → T052).
- For US3: `exportCaseFile` before `importCaseFile` and before `canonicalise` (T059 → T060, T062).

### Parallel opportunities

- All Foundational domain-primitive tasks (T005–T010) are `[P]` — they touch different files with no cross-deps.
- All four store-shell tasks (T011–T014) are `[P]`.
- All fixture files (T024–T037) are `[P]` — one file each.
- All co-located US1 tests (T041–T046) are `[P]`.
- All US2 unit tests (T053–T057) are `[P]`.
- All US3 unit tests (T063–T064) are `[P]`.
- All integrity-repair pass implementations (T066–T070) are `[P]`.
- All cross-cutting tests in Polish (T074–T079) are `[P]`.

---

## Parallel Example: User Story 1 fixtures

```bash
# Launch all US1 fixture authors in parallel (each writes a distinct file):
Task: "Author src/crm/fixtures/clients.ts"
Task: "Author src/crm/fixtures/case417.ts"
Task: "Author src/crm/fixtures/case392.ts"
Task: "Author src/crm/fixtures/pipeline.ts"
Task: "Author src/crm/fixtures/documents.ts"
Task: "Author src/crm/fixtures/checklists.ts"
Task: "Author src/crm/fixtures/worklist.ts"
Task: "Author src/crm/fixtures/conflicts.ts"
Task: "Author src/crm/fixtures/stream417.ts"
Task: "Author src/crm/fixtures/stream392.ts"
Task: "Author src/crm/fixtures/criteria.ts"
Task: "Author src/crm/fixtures/products.ts"
Task: "Author src/crm/fixtures/compliance.ts"
Task: "Author src/crm/fixtures/retention.ts"

# Then T038 bundles them into goldenPath.ts, T039 wires the seed.
```

## Parallel Example: Foundational domain primitives

```bash
Task: "Author src/crm/domain/types.ts"
Task: "Author src/crm/domain/money.ts"
Task: "Author src/crm/domain/stages.ts"
Task: "Author src/crm/domain/ids.ts"
Task: "Author src/crm/domain/factFindSchema.ts"
Task: "Author src/crm/domain/emptyConstants.ts"
```

---

## Implementation Strategy

### MVP first (User Story 1 only)

1. Phase 1 — Setup (T001–T004)
2. Phase 2 — Foundational (T005–T019)
3. Phase 3 — User Story 1 (T020–T047)
4. **STOP + VALIDATE**: run `pnpm test -- --run test/unit/crm src/crm` and confirm Journey A green; run `pnpm build && pnpm type-check && pnpm lint`.
5. Ship as MVP for F02 consumption. F02 can start rendering the golden path against the domain layer even before US2 and US3 land.

### Incremental delivery

1. Setup + Foundational → foundation ready.
2. + US1 → Journey A green → F02–F05 can start UI work.
3. + US2 → Journey B green → the FCA-load-bearing action is available; F06 (approvals) can start.
4. + US3 → Journey C green → compliance lifecycle floor in place; the CRM can safely sit behind auth in a shared environment.
5. + Polish → integrity repair covers dangling-ref scenarios; cap enforcement covers demo long-tail runs.

### Parallel team strategy

- **Developer A**: Setup + Foundational (T001–T019), then US1 (T020–T047).
- **Developer B** (once T005–T014 land): US2 (T048–T058) in parallel with US1's fixture and selector work.
- **Developer C** (once US1 core actions land): US3 (T059–T065) in parallel with US2.
- Polish (T066–T082) fans out fully across the team.

---

## Notes

- `[P]` = different files, no dependency on incomplete tasks in the same phase.
- `[Story]` label maps a task to `[US1]`/`[US2]`/`[US3]` for traceability; setup/foundational/polish tasks have no story label.
- Every task lists an explicit file path; the LLM implementing a task should not need external context beyond the linked design docs.
- SC-005 minimum test count is enforced by T080 — do not skip it.
- Every new `.ts` file gets the license header from T002 pasted at the top.
- Commit after each task or logical group; on merge, `validate-feature` re-runs Journeys A/B/C headlessly (see quickstart.md § "Post-merge validator hook").
