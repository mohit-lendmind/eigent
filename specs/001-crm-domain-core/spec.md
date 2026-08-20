# Feature Specification: crm-domain-core

**Feature Branch**: `lendmind-crm` (spec directory: `specs/001-crm-domain-core`)

**Created**: 2026-08-20

**Status**: Draft

**Input**: See architecture `.lm-flow/architecture/crm-domain-core.md`, canonical domain reference `.lm-flow/recon/lendmind-advisor-design-reference.md` §3.

## Summary

`crm-domain-core` is F01, the foundation feature of **Lendmind Advisor** — an AI-native UK mortgage broker CRM being built inside the Eternyl Electron/React desktop app. It is a pure, UI-less typed domain layer under a new `src/crm/`: entity types, four persisted browser stores, pure derivation helpers, faithful golden-path fixture data, a dev-gated seed, a case-file export serializer, an ordered cross-store integrity repair, and a comprehensive unit-test suite. No UI, no routes, no network calls. Every later feature (F02–F17) consumes this layer.

The product commitments this layer must make possible — and must not accidentally undermine — are:

- **Epistemology on every value.** Each fact-find field records whether it was *deterministic* (verbatim from a document) or *synthesized* (AI-inferred, needs review).
- **Why? everywhere.** Every AI claim (recommendation, rejection, extraction) carries a full reasoning trace: claim, numbered working, cited evidence with verbatim quotes, alternatives considered, calibrated confidence.
- **Human-in-the-loop grammar.** Nothing that touches a client, a lender or the file goes out without an approval trail; suppressed low-confidence updates are counted, not dropped silently.
- **The stream replaces tabs.** A case is a chronological agent feed, with unresolved *needs you* items never quietly evicted.
- **Retention as revenue automation.** Fixed-rate end dates are first-class; <90 days = urgent.
- **FCA / Consumer Duty defensibility.** Every fact-find mutation is auditable back to who, when, from what, to what.

## User Scenarios & Testing *(mandatory)*

Because this feature ships **no UI**, all three user stories below are verified **headlessly** — through direct calls to the store actions, the seed, the export serializer, and pure selectors — inside the vitest suite. Post-merge validation runs the same three journeys as its acceptance script; the presence and passing of these three journeys is what the automated validator gates on.

### User Story 1 — Seed and read the golden path (Priority: P1)

An engineer or downstream feature-runner boots a fresh renderer (empty localStorage), invokes `seedCrmGoldenPath()` from a dev-only entry point, and immediately reads the fully populated Lendmind case book — Aisha & Daniel's first-time-buyer purchase (case c417), Tom Hargreaves' self-employed remortgage (case c392), the 8-row pipeline, worklist, documents with insights, reasoning-traced stream entries, criteria checks, sourcing products, the retention radar and the compliance record — via pure selectors. Selectors return exactly the numbers the design reference specifies (see `SC-001` … `SC-006`).

**Why this priority**: Without this working, no F02–F05 UI feature can render anything. It is the substrate.

**Independent Test**: Boot a clean vitest environment, call `seedCrmGoldenPath()`, then assert on `selectNeedsYouCount()`, `selectPipelineCounts()`, `selectCaseCompleteness('c417')`, `selectRetentionUrgency(now = 2026-06-13)` — expected values come from the design reference verbatim (6 needs-you items; the pipeline stage counts from §3.6; c417 completeness 0.90; Tom's 79-day retention entry ranked first).

**Acceptance Scenarios**:

1. **Given** a fresh renderer with empty `localStorage`, **When** `seedCrmGoldenPath()` runs, **Then** all four stores hydrate with the golden-path fixtures and the four persist envelopes are written to `localStorage` under the environment-scoped keys.
2. **Given** the seed has run once, **When** `seedCrmGoldenPath()` runs a second time, **Then** the operation is a no-op (idempotent) — no duplicate records, no additional persist writes, no thrown errors.
3. **Given** the golden path is seeded, **When** `selectCaseCompleteness('c417')` is called, **Then** it returns `0.90 ± 0.005` — matching the design reference's headline number.
4. **Given** the golden path is seeded, **When** `selectNeedsYou()` is called, **Then** it returns exactly the six worklist items listed in the design reference §3.9, in the same order.
5. **Given** the golden path is seeded, **When** `selectCaseStreamSections('c417')` is called, **Then** the four ordered sections (`LIVE`, `NEEDS_YOU`, `DIRECTIVES`, `ACTIVITY`) contain the entries of the corresponding kinds from §3.22 STREAM_417, with the live solver entry pinned first.
6. **Given** the golden path is seeded, **When** the c417 sourcing solver rows are inspected, **Then** each `pass` row carries a non-empty `rationale` and `criteriaTrail`, and each `fail` row carries `rejectReason`, `rejectCriterion` (e.g. `'Skipton § 3.1 Employment tenure'`) and `failOn`.

---

### User Story 2 — Resolve a conflict atomically, with a persisted audit (Priority: P2)

An adviser (in a later F02+ UI) — or, in this feature, a test — reads Daniel Reyes' salary conflict on case c417: the contract says £38,500, the payslip annualises to £37,300. They call one action, `resolveConflict(conflictId, { chosenValue: 3_850_000 /* pence */, method: 'confirm-value', reasoning: 'Contract is the authoritative source' })`. In a single atomic transaction the domain layer must: (a) write the chosen value onto the fact-find field with `src: 'det'`, (b) clear the `conflictId` reference, (c) mark the `ConflictRecord` resolved with actor + timestamp + both original competing values retained, (d) flip the corresponding `d5` document insight from `conflict:true` to `conflict:false`, (e) resolve the worklist item `w1` with status/timestamp/actor (not delete it), (f) append a new `StreamEntry` of kind `done` carrying the full resolution trace (claim, working showing which values competed, evidence citing both sources, alternatives, adviser reasoning as the calibration), (g) emit a `FieldChangeEvent` audit record capturing `{caseId, clientId, section, fieldKey, priorValue, newValue, priorSrc, newSrc, changedBy, changedAt, reason: 'conflict-resolution', conflictId}`.

**Why this priority**: This is the single most FCA-load-bearing action in the whole product. Every other conflict flow (documents, sourcing overrides, retention decisions) will follow the same pattern. Getting the audit substrate right here is what makes the CRM Consumer-Duty defensible; retrofitting it later is the costliest thing we could push.

**Independent Test**: Seed the golden path; assert the initial state (field `conflictId` set, insight `conflict:true`, worklist `status:'open'`, stream length N); call `resolveConflict()`; assert every one of (a)–(g) held after a single call, in a single store update per store (no partial states observable if a subscriber were watching). Assert that the `FieldChangeEvent` is included in the case-file export.

**Acceptance Scenarios**:

1. **Given** the golden path is seeded, **When** `resolveConflict(conflict417DanielIncomeBasic, { chosenValue: 3_850_000, method: 'confirm-value', resolvedBy: 'EV', reasoning: '...' })` runs, **Then** all seven side-effects (a)–(g) are visible in one poll of all four stores.
2. **Given** the same starting state, **When** the resolution runs, **Then** the `ConflictRecord.values` array still contains both `{value: 3_850_000, source: {docId:'d5', insightLabel:'Salary'}}` and `{value: 3_730_000, source: {docId:'d2', insightLabel:'Annual income'}}` after resolution — historic competing values are never destroyed.
3. **Given** the same starting state, **When** the resolution runs, **Then** `getFieldChangeEventsForField(caseId, clientId, 'income', 'basic')` returns at least one event with `reason: 'conflict-resolution'` and both `priorValue` and `newValue` populated.
4. **Given** a conflict has been resolved, **When** the worklist is inspected, **Then** `w1` is present with `status: 'resolved'`, `resolvedAt` set, `resolvedBy: 'EV'` — the item is not deleted.
5. **Given** a conflict has been resolved, **When** `resolveConflict()` is called again on the same conflict id, **Then** the call is a no-op (idempotent — recorded resolution wins) and no duplicate stream entry or audit event is created.
6. **Given** a fresh renderer boot, **When** the case-file export from journey 3 is imported back, **Then** the resolved conflict record — including both competing values, the resolution and the audit event — round-trips intact.

---

### User Story 3 — Export and wipe for compliance lifecycle (Priority: P3)

A compliance officer (in a later feature, or a test here) needs a portable, self-describing JSON snapshot of a case file that can be filed for the 3-year FCA retention window and later loaded back into a fresh environment to reproduce the state at recommendation. The domain layer exposes `exportCaseFile(caseId): CaseFileExport` (pure, synchronous) and `clearAllCrmState()` (empties all four stores and their `localStorage` envelopes). The export contains every record touching the case: the case, both applicants, both client identities, all documents attributed to either applicant, the checklist, all worklist items scoped to the case, every stream entry with its full reasoning trace, every criteria check, every product in the sourcing universes considered, the compliance record, retention entries, and — critically — every `FieldChangeEvent` and every `ConflictRecord` (resolved or open). The export is envelope-versioned. `importCaseFile(export)` re-hydrates the same case into an empty store set with byte-equal round-trip on `JSON.stringify(canonicalise(x))`.

**Why this priority**: This is the compliance floor — once we can export and wipe, we can safely put the CRM behind auth in a shared environment. It is also the lowest-risk of the three journeys because it is pure serialization over data the other two journeys already produced.

**Independent Test**: Seed golden path → export c417 → wipe all state → import the export → re-read via selectors → assert identical output. Cover the negative case: exporting a nonexistent case id returns `{ok:false, reason:'unknown_case'}`, not a throw.

**Acceptance Scenarios**:

1. **Given** the golden path is seeded, **When** `exportCaseFile('c417')` runs, **Then** it returns a `CaseFileExport` whose declared record counts match the seeded state exactly (2 applicants, 6 documents, ≥7 stream entries, ≥1 conflict record, ≥1 field-change event once journey 2 has run).
2. **Given** an exported case-file, **When** `clearAllCrmState()` is called, **Then** all four `useCrm*Store` slices report empty and the four `localStorage` keys are removed.
3. **Given** an emptied store set, **When** `importCaseFile(export)` is called, **Then** all records present in the export re-appear in the correct stores under their original ids.
4. **Given** the golden path is seeded, then exported, then wiped, then re-imported, **When** the same selectors are re-run, **Then** they return byte-equal output on both runs (compared via `JSON.stringify` after a canonical key-sort).
5. **Given** journey 2 has been executed before the export, **When** the export is imported into a clean store, **Then** the resolved conflict, the `FieldChangeEvent` and the corresponding done-kind stream entry with reasoning trace all reappear.

---

### Edge Cases

- **Cross-store dangling references.** A case references a `clientId` that no longer exists (persist corruption, or a bad import). The `crmIntegrityRepair()` pass replaces the missing client with a named placeholder `{id, firstName:'Unknown', lastName:'(repaired)', tint:'placeholder', repaired:true}`, and emits a repair-report entry — the case is not deleted.
- **Removing a still-referenced client.** `removeClient(id)` refuses if any case's applicants array references it. Returns `{ok:false, reason:'referenced_by_case', caseIds:[…]}`; caller must close/cascade cases first. GDPR-erasure (`anonymiseClient`) is deferred to a later compliance feature (out of scope here); the *refuse* semantics are what this layer commits to.
- **Persisted-state schema drift.** The persist envelope version is bumped independently of the per-record `schemaVersion`; the `migrate` function is a shape-repair — unknown fields are preserved when possible, unknown record shapes are dropped with a `console.warn` and counted in the repair report.
- **Auth environment switch.** If the persisted envelope was written under a different `getAuthEnvironmentKey()` than the current one, `migrate` returns empty state (no cross-tenant bleed) and the repair report notes `envMismatch:true`.
- **Stream entry cap reached.** When `pushStreamEntry(caseId, entry)` would push the case above `STREAM_ENTRIES_PER_CASE_CAP` (see FR-030), unresolved *needs you* entries (kinds `conflict`, `approval` where the associated worklist item is `status:'open'`) are **never** evicted; the oldest `done`/`external`/`activity` entry is evicted first, and a synthetic marker entry `{kind:'done', title:'Older activity truncated', truncatedBefore, truncatedCount}` is inserted so the visible history shows the cap took effect.
- **Money precision.** All monetary values are stored as integer pence (`Pence = number` branded type). Any input path that receives a display string (e.g. `'£38,500'`) must be parsed by `parseGbp()` before it touches a field value; there is no code path that persists a string amount.
- **Idempotent seed and idempotent conflict resolution.** Both operations detect the "already applied" state and return without side-effects, so tests, HMR reloads, and duplicate user clicks are safe.
- **Empty selector inputs.** Selectors called before hydration or after `clearAllCrmState()` return stable empty constants (`EMPTY_ARRAY`, `EMPTY_MAP`) and never throw.
- **JSON serialization must succeed.** No `bigint`, no `Date` objects, no functions, no `Symbol`s, no `undefined` in values persisted or exported — enforced by a unit test that round-trips each store's partialized state through `JSON.stringify`.

## Requirements *(mandatory)*

### Functional Requirements

**Entity model**

- **FR-001**: The system MUST expose typed entities for `Client`, `Case`, `Applicant` (case↔client join carrying `role`, `profile`, `completeness`), `FactFindField`, `FactFindSection`, `CaseProperty`, `Deposit` (with per-source breakdown and flags), `Requirement`, `Affordability`, `CrmDocument`, `DocInsight`, `DocChecklistItem`, `WorklistItem`, `StreamEntry`, `ReasoningTrace`, `EvidenceCitation`, `ActivityEvent`, `CriterionCheck`, `Product` (with solver extensions), `RetentionEntry`, `ConflictRecord`, `FieldChangeEvent`, `RepairReport`, `CaseFileExport`, plus the enums `Stage`, `WorklistKind`, `StreamKind`, `DocumentStatus`, `ChecklistStatus`, `CriterionStatus`.
- **FR-002**: Every entity that could plausibly be produced by an agent pipeline (later F07 ingest) MUST carry an optional `origin?: { artifactId: string, runId: string }` field, present on `FactFindField`, `DocInsight`, `WorklistItem`, `StreamEntry`, `ConflictRecord`, `ProductRow`, `CriterionCheck`. This pre-cuts the agent-ingest seam so F07 lands as a data plumbing change, not a type-shape migration.
- **FR-003**: Each stored record MUST carry a `schemaVersion: number` field stamped `CRM_SCHEMA_VERSION` (initial value `1`), independent of the four store persist-envelope versions.

**Fact-find field value typing (trade-off #1 — resolved)**

- **FR-004**: `FactFindField` MUST use a discriminated-union `value` shape keyed by `t`: the union members are `{t:'text', v:string}`, `{t:'select', v:string, options?:string[]}`, `{t:'date', v:string /* ISO YYYY-MM-DD */}`, `{t:'number', v:number}`, `{t:'money', v: Pence}`, `{t:'toggle', v:boolean}`. Money is its own variant; display strings such as `'£38,500'` NEVER round-trip to storage. Formatting for the UI is the job of `formatGbp(pence, {compact?})`; parsing user input is the job of `parseGbp(input): Pence | null`.
- **FR-005**: Every `FactFindField` MUST carry `src: 'det' | 'syn'` (the epistemology token), an optional `hint?: string` (provenance shown on hover in the UI layer — e.g. `'Passport'`, `'P60'`, `'Basic + 50% OT'`, `'Same as applicant 1'`), an optional `flag?: true` (amber — needs attention), and an optional `conflictId?: string` referencing a `ConflictRecord`.
- **FR-006**: The system MUST enumerate the following field keys per section, per applicant category. Implementers MUST work from this list — "see design reference" is not acceptable:

  **Employed applicant (Aisha, Daniel — case c417)**
  - `personal`: `title, firstName, lastName, dob, maritalStatus, ni, citizenship, permanentUkResidency, dependants`
  - `contact`: `email, mobile`
  - `address`: `line1, city, postcode, timeAtAddress, residentialStatus`
  - `employment`: `type, employer, jobTitle, startDate, yearsInRole, inProbation`
  - `income`: `basic, overtimeAvg, bonus, incomeConsidered`
  - `expenditure`: `councilTax, utilities, travel, livingCosts`
  - `credit`: `adverseCredit, monthlyCommitments, creditScore`

  **Self-employed applicant (Tom — case c392)** — same `personal`, `contact`, `address` keys; `employment`, `income`, `credit` differ:
  - `employment`: `type, business, yearsTrading, shareholding`
  - `income`: `directorSalary, dividendsAvg, netProfitY1, netProfitY2`
  - `credit`: `adverseCredit, adverseCreditDetail`

  Both keysets are declared in `src/crm/domain/factFindSchema.ts` as constant tuples with `as const` so the union of legal keys is derivable at the type level.

- **FR-007**: Each `FactFindSection` MUST carry a `completeness: number` in `[0, 1]`; `computeSectionCompleteness(section, requiredKeys)` and `computeCaseCompleteness(applicants[])` MUST be pure module-level functions (importable without instantiating a store).

**Stage catalog and semantic tone**

- **FR-008**: The 8 pipeline stages `LEAD, FACT_FIND, SOURCING, DIP, APPLICATION, VALUATION, OFFER, COMPLETION` MUST be declared in `src/crm/domain/stages.ts` as `{key, label, short, tone}` where `tone` is a **semantic token name string** (e.g. `'status-pending'`, `'brand'`, `'status-success'`, `'status-warning'`). No hex value, no rgb value, and no direct Tailwind color class may appear anywhere in `src/crm/` — the design-token lint gate scans all of `src/` including this feature and including fixtures.
- **FR-009**: Helpers `stageIndex(stage)` and `nextStage(stage)` MUST be pure functions returning stable results.

**Money and ids**

- **FR-010**: `Pence` MUST be a branded number type; `formatGbp(pence, {compact?}): string` MUST format `4275000` as `'£42,750.00'` (or `'£42.8k'` when `compact:true`); `parseGbp(input): Pence | null` MUST accept the inverse; both live in `src/crm/domain/money.ts` beside the type. Money MUST NEVER be represented as `bigint` in persisted state (bigint is not JSON-serialisable and would break persist/import).
- **FR-011**: The system MUST use `newCrmId(prefix)` (composed on top of the repo's `generateUniqueId()`) to mint `client_…`, `case_…`, `doc_…`, `insight_…`, `wl_…`, `stream_…`, `event_…`, `conflict_…` prefixed ids. Timestamps MUST be epoch milliseconds (`number`).

**The four persisted stores**

- **FR-012**: The system MUST expose exactly four persisted zustand stores in `src/crm/`: `useCrmClientsStore` (`crm-clients-store` envelope), `useCrmCasesStore` (`crm-cases-store`), `useCrmDocumentsStore` (`crm-documents-store`), `useCrmWorkstreamStore` (`crm-workstream-store`). Each store mirrors `spaceStore.ts` persistence anatomy exactly: `version` starts at `1` and is named `CRM_<X>_PERSIST_VERSION`; `migrate` is a shape-repair function that drops unknown record shapes and preserves-with-defaults known ones; `partialize` is an explicit **allowlist** (never a denylist) of persisted keys; `storageEnvironmentKey` is set from `getAuthEnvironmentKey()` and re-checked inside `migrate` — mismatched envelopes yield empty state.
- **FR-013**: Each store MUST expose a `getCrmXStore()` non-hook accessor for cross-store integration and testing, matching the `getSpaceStore()` idiom.
- **FR-014**: Cross-store imports MUST be one-directional: `casesStore` may read `clientsStore` via `.getState()`; `documentsStore` may read `clientsStore` and `casesStore`; `workstreamStore` may read all three. No reverse direction is permitted. Enforced by lint (import graph) and by test.

**Actions — clients**

- **FR-015**: `upsertClients(clients[])` MUST insert-or-update by id and stamp `schemaVersion`.
- **FR-016**: `removeClient(id)` MUST refuse if any case references the client (see edge case, trade-off #4). It returns a typed result `{ok: true} | {ok:false, reason:'referenced_by_case', caseIds: string[]}`; it does not throw. If refused, an `ActivityEvent` MUST be appended to the workstream store recording the refusal.
- **FR-017**: `noteClientCase(clientId, caseId)` MUST append the case id to the client's `cases[]` back-reference if not already present.

**Actions — cases**

- **FR-018**: `setFactFindField(caseId, clientId, section, fieldKey, newValue, {reason?, changedBy})` MUST perform in one store update: (a) write the field's new value + `src` (defaults to `'det'` if omitted; a caller can pass `src: 'syn'` for AI-produced values), (b) emit a `FieldChangeEvent` to the workstream store capturing `{caseId, clientId, section, fieldKey, priorValue, newValue, priorSrc, newSrc, changedAt, changedBy, reason}`, (c) recompute the affected section's completeness.
- **FR-019**: `confirmSynthesizedField(caseId, clientId, section, fieldKey, {confirmedBy})` MUST flip `src: 'syn' → 'det'` on the field, record `confirmedAt: number, confirmedBy: string` on the field itself, and emit a `FieldChangeEvent` with `reason: 'confirm-synthesized'`.
- **FR-020**: `resolveConflict(conflictId, {chosenValue, method: 'confirm-value'|'ask-client', resolvedBy, reasoning?})` MUST perform in one store update across all three affected stores (see trade-off #6): (a) update the referenced field via `setFactFindField` semantics with `reason:'conflict-resolution'`, (b) mark the `ConflictRecord.resolvedAt` and `.resolvedBy` and `.resolution`, preserving both original `values`, (c) flip the corresponding document insight from `conflict:true` to `conflict:false`, (d) call `resolveWorklistItem` for the linked worklist item (never delete), (e) append a `StreamEntry` of kind `done` carrying a `ReasoningTrace` — claim, working showing the competing values, evidence citing both source documents with verbatim quotes, alternatives (the not-chosen values), the adviser reasoning as the calibration sentence, confidence `1.0` (adviser judgement).
- **FR-021**: `moveStage(caseId, nextStageKey)` MUST update the case stage and append an `ActivityEvent`. It MUST NOT skip stages silently: callers pass the exact next stage key; validation is a stage-map lookup.
- **FR-022**: `ownership?: {adviserId, firmId, networkId}` MUST be an **optional** object on `Case` (trade-off #3). At seed time the golden-path cases MUST have `ownership: {adviserId:'adviser_eleanor_vance', firmId:'firm_meridian_mortgages', networkId:'network_stonebridge'}` populated from the fixture adviser Eleanor Vance. Absent ownership is legal and represents an unassigned case.

**Actions — documents**

- **FR-023**: `addDocument(doc)` MUST insert the document with `status:'PROCESSING'` if `attribution == null`; `completeDocument(id, {type, attribution, insights})` MUST flip it to `status:'COMPLETED'` and populate typed insights with per-insight `conf: number`, `good?: true`, `flag?: true`, `conflict?: true`.
- **FR-024**: `confirmAttribution(id, {confirmedBy})` MUST record the confirmation timestamp on the document.
- **FR-025**: `setChecklistStatus(clientOrJoint, itemKey, status: 'received'|'pending'|'partial'|'requested', {note?})` MUST update the per-owner checklist.
- **FR-026**: Document insights MUST NOT auto-mutate fact-find fields. Cross-entity propagation is a selector concern in this feature; the real ingest pipeline is deferred to F07.

**Actions — workstream (worklist + stream + activity + retention)**

- **FR-027**: `resolveWorklistItem(id, {resolution, resolvedBy})` MUST set `status: 'resolved'`, `resolvedAt: number`, `resolvedBy: string`, `resolution: {…}` — the item is **retained**, never deleted (trade-off — this makes worklist an audit surface).
- **FR-028**: `pushStreamEntry(caseId, entry)` MUST append a `StreamEntry`, enforce the per-case cap (FR-030), stamp `schemaVersion` and `id` if omitted, and preserve the full `trace` verbatim.
- **FR-029**: `noteActivity(caseId, activity)` MUST append an `ActivityEvent` to the case's activity log (passive log; distinct from stream entries).
- **FR-030**: The workstream store MUST enforce `STREAM_ENTRIES_PER_CASE_CAP = 200` at write time (trade-off #2): when appending would exceed the cap, the oldest entry whose kind is `done`, `external`, or `activity` — AND whose associated worklist item, if any, has `status:'resolved'` — is evicted first. Entries of kind `conflict` or `approval` whose linked worklist item is `status:'open'` are NEVER evicted. When any entry is evicted, a synthetic marker `{kind:'done', id:'stream_trunc_<n>', title:'Older activity truncated', body:'<count> older entries evicted at cap.', truncatedBefore: <ts>, truncatedCount: <n>}` is inserted at the eviction point so the visible history reports the cap.
- **FR-031**: `upsertRetention(entry)` MUST insert-or-update by client id + fixed-rate end date.

**Conflict records (trade-off #6 — resolved)**

- **FR-032**: `ConflictRecord` MUST have the shape `{id, caseId, clientId, section, fieldKey, values: ConflictValue[], detectedAt, detectedBy?, resolvedAt?, resolvedBy?, resolution?, origin?}` where `ConflictValue = {value: FieldValue, source: {kind:'document'|'manual'|'insight', docId?, insightLabel?, quote?}, confidence?}`. The composite address is `(caseId, clientId, section, fieldKey)` — one conflict per address at a time.
- **FR-033**: `FactFindField.conflictId?: string` references the record; the field is never simultaneously marked `conflict:true` in a boolean form. Both original values MUST be preserved on the record for the life of the case (never truncated by the stream cap; ConflictRecords live in the cases store, not the workstream store).

**Field-change audit (FCA / Consumer Duty substrate)**

- **FR-034**: The system MUST persist a `FieldChangeEvent` for EVERY fact-find field mutation with the shape `{id, caseId, clientId, section, fieldKey, priorValue, newValue, priorSrc, newSrc, changedAt, changedBy, reason: 'edit'|'confirm-synthesized'|'conflict-resolution'|'seed'|'import', conflictId?, origin?}`. Events are appended, never mutated or deleted. `getFieldChangeEventsForField(caseId, clientId, section, fieldKey)` and `getFieldChangeEventsForCase(caseId)` MUST return them in ascending `changedAt` order.
- **FR-035**: `FieldChangeEvent`s live in the workstream store (partialized and persisted) and are included in the case-file export in full.

**Integrity repair (trade-off #5 — adopted)**

- **FR-036**: A single ordered function `crmIntegrityRepair(): RepairReport` MUST live in `src/crm/integrity.ts` and MUST be invoked once, in a `queueMicrotask` after all four stores have hydrated. Passes run in this order and each returns a section of the report:
  1. **Placeholder clients**: for every case whose applicants reference a missing `clientId`, insert a placeholder client `{id, firstName:'Unknown', lastName:'(repaired)', tint:'placeholder', repaired:true, insertedAt}` — the case is preserved.
  2. **Placeholder document owners**: for every document whose `owner` clientId is missing, retarget to a placeholder client as above.
  3. **Prune orphan worklist items**: worklist items whose `caseId` no longer exists are pruned (recorded in the report as `prunedWorklist: [...ids]`).
  4. **Prune orphan stream entries and activity events**: same treatment; recorded as `prunedStream: [...ids]`, `prunedActivity: [...ids]`.
  5. **Recompute case completeness**: after repairs, recompute completeness for every touched case.
- **FR-037**: `RepairReport` MUST be surfaceable — the workstream store exposes `getLastRepairReport(): RepairReport | null` and appends an `ActivityEvent` per repair that mutated state; `console.warn` describes each pruned/replaced record with its id so it appears in dev logs.

**Placeholder mechanism**

- **FR-038**: Placeholder clients created by the repair pass MUST be flagged `repaired: true` so downstream selectors (F02+ UI) can render them distinctly and refuse to bill against them. `ensureClient(id): Client | Placeholder` returns a placeholder if the id is missing, so pure selectors never throw on dangling references.

**Global operations**

- **FR-039**: `clearAllCrmState()` MUST empty all four stores in memory AND remove the four `crm-*-store` `localStorage` keys. It MUST NOT touch non-CRM keys.
- **FR-040**: `exportCaseFile(caseId): CaseFileExport | {ok:false, reason:'unknown_case'}` MUST serialize every record touching the case — case, applicants, referenced clients (deep), all documents attributed to either applicant, the checklist, worklist items for the case, all stream entries for the case with full traces preserved verbatim, ActivityEvents, criteria checks, sourcing products (both 2yr and 5yr universes as they were), the compliance record for the case, retention entries for the referenced clients, ConflictRecords for the case, and every FieldChangeEvent for the case. The export MUST include an envelope `{exportVersion: 1, exportedAt, crmSchemaVersion, caseId}`.
- **FR-041**: `importCaseFile(export): {ok:true, imported:{cases,clients,documents,workstream}} | {ok:false, reason}` MUST re-hydrate the export into the current store set. Duplicate ids MUST be handled by the export version: exportVersion 1 refuses to overwrite existing records, returning `{ok:false, reason:'id_collision', ids:[…]}`; callers wipe first (`clearAllCrmState()`) then import.

**Selectors**

- **FR-042**: Pure selectors in `src/crm/selectors.ts` MUST include at minimum: `selectNeedsYou(worklist)`, `selectNeedsYouCount(worklist)`, `selectPipelineCounts(cases)`, `selectOpenConflicts(cases)`, `selectRetentionUrgency(entries, now)` (<90 days = urgent), `selectCaseStreamSections(entries)` returning the ordered tuple `{live[], needsYou[], directives[], activity[]}`, `selectDetSynCounts(applicant)` returning `{det, syn, awaiting}`, `selectCaseCompleteness(caseId, state)`.
- **FR-043**: Selectors MUST return stable empty constants (`EMPTY_ARRAY`, `EMPTY_MAP`) rather than new instances, so React consumers in F02+ do not re-render on empty-to-empty transitions.

**Golden-path fixtures**

- **FR-044**: Fixture modules under `src/crm/fixtures/` MUST faithfully transcribe:
  - Case `c417` (`LM-2026-0417`): first-time-buyer purchase, Aisha Okafor + Daniel Reyes, 8 Brookfield Avenue Didsbury £285,000, deposit £42,750 (15%) including £2,000 gift from Aisha's mother (flag), loan £242,250, 85% LTV, 32-year term, C&I, 2-year fixed. Aisha and Daniel profiles per §3.4 with every listed field key populated at the appropriate `src` (det vs syn) and `hint`; Daniel's employment carries the probation flags (`inProbation:true`, `startDate:'2026-01-06'`, `yearsInRole:0.4`); Daniel's income has a `conflictId` referencing a real `ConflictRecord` with the £38,500 contract value vs £37,300 payslip value both populated.
  - Case `c392` (`LM-2026-0392`): remortgage, Tom Hargreaves solo, 22 Royal York Crescent Clifton £520,000, equity deposit £208,000 (40%), £335,000 loan, 5-year fixed, `retention: {reason:'Fixed rate ends 31 Aug 2026', daysLeft:79}`.
  - The 8-row pipeline dataset per §3.6.
  - The 6 documents per §3.7 with typed insights, plus the joint bank statement's `attribution:0.74` and the contract's `conflict:true` insight on Salary.
  - The per-owner checklist per §3.8 (aisha 4 items, daniel 3, joint 3).
  - The 6 worklist items per §3.9 in the same order with the same `kind`s (conflict, criteria, doc/auto, approval, doc/auto, retention) — each linked to real entities.
  - The 10 criteria checks per §3.12, each with per-lender impacts as specified.
  - The 2-year products (`hx`, `nw`, `ac`, `sk`, `cov`) per §3.13 with the passes/fails preserved, PLUS the solver universe additions (`SOLVER_LENDERS` extras `tsb`, `barclays`, `santander`, `natwest`) and `SOLVER_LENDERS_5YR` (Halifax/Nationwide/Accord 5-year fixes) per §3.13. Every fail row MUST carry `rejectReason`, `rejectCriterion` (e.g. `'Skipton § 3.1 Employment tenure'`), and `failOn`.
  - The 8 stream entries for c417 per §3.22 with full reasoning traces — claim, subject, numbered working, cited evidence with verbatim quotes and source refs (`'Halifax criteria · Section 4.2 v24.6'`, `'Page 1, line 18'`), alternatives (where design specifies), calibrated confidence (`.96`, `.78`, `.93`, `.85`, `.96`, `.95`, `.93`, `1.0` respectively). Plus stream entries for c392 (§3.22 STREAM_392, 2 entries).
  - The compliance record for c417 per §3.20 (disclosures, ID&V, AML SmartSearch, vulnerability, Consumer Duty pillars, declaration, supervision items with gifted-deposit letter pending).
  - The retention radar (4 entries) per §3.11.
  - The advisor fixture: Eleanor Vance per §3.1.
- **FR-045**: Fixture data MUST use only semantic tone keys (no hex, no `#`), so the design-token gate passes when scanning fixtures too.

**Seed**

- **FR-046**: `seedCrmGoldenPath()` MUST be idempotent (returns without side-effect if any of the four stores is non-empty), MUST be dev-gated (guarded by a dev flag equivalent to the `INITIAL_BLANK_SPACE_CREATED_FROM` idiom), and MUST write all fixture records to the four stores in one pass such that a subscriber sees only the fully-seeded state or the empty state.

**Non-goals (explicit)**

- **FR-047**: This feature MUST NOT ship any UI, any route, any network request, any dependency addition. `pnpm build` and the design-token / no-legacy-backend / dead-brain / vitest baseline gates MUST all pass.

### Key Entities

- **Client**: durable person identity across many cases. `{id, ref, firstName, lastName, initials, tint, textCls, role, email, phone, cases[], since, schemaVersion, repaired?, ownershipHint?}`. Not tied to any single case's ownership.
- **Case**: one advised transaction. `{id, ref, type, kind, label, stage, completeness, updated, applicants[], property, deposit, requirement, affordability, retention?, ownership?, schemaVersion, origin?}`.
- **Applicant** (join): `{clientId, role: 'primary'|'secondary'|'sole', profile: {[section]: FactFindSection}, completeness}`.
- **FactFindField**: `{k, label, value: FieldValue, src: 'det'|'syn', hint?, flag?, conflictId?, mono?, confirmedAt?, confirmedBy?, origin?}`.
- **CrmDocument**: `{id, owner: ClientId | 'joint', name, type, status, size, when, iconTone, attribution: number | null, joint?, confirmedAt?, insights: DocInsight[], schemaVersion, origin?}`.
- **DocInsight**: `{id, label, value, conf, good?, flag?, conflict?, sourceQuote?, origin?}`.
- **WorklistItem**: `{id, caseId, kind, title, detail, cta, tab, auto?, status: 'open'|'resolved', createdAt, resolvedAt?, resolvedBy?, resolution?, linkedConflictId?, linkedDocId?, origin?, schemaVersion}`.
- **StreamEntry**: `{id, caseId, kind, iconTone, when, title, body?, cta?, actions?, pulse?, pinned?, trace?: ReasoningTrace, schemaVersion, origin?}`.
- **ReasoningTrace**: `{claim, subject?, working: string[], evidence: EvidenceCitation[], alternatives?: {option, reason, rejected?}[], confidence: number, calibration?: string}`.
- **EvidenceCitation**: `{kind: 'criteria'|'field'|'document'|'policy'|'calc', label, value?, source?, quote?, note?}`.
- **CriterionCheck**: `{id, caseId, group: 'lending'|'affordability', cat, label, status: 'pass'|'warning'|'info', reasoning, impacts?: {lender, status, note}[], schemaVersion, origin?}`.
- **Product**: `{id, caseId, lender, product, rate, type, fee, monthly, ltv, total, status: 'pass'|'fail', recommended?, notes, apr, rationale?, criteriaTrail?: string[], rejectReason?, rejectCriterion?, failOn?, universe: '2yr'|'5yr', origin?, schemaVersion}`.
- **RetentionEntry**: `{clientId, ref, endsAt, daysLeft, lender, rate, status: 'case-open'|'due'|'horizon', schemaVersion}`.
- **ConflictRecord**: `{id, caseId, clientId, section, fieldKey, values: ConflictValue[], detectedAt, detectedBy?, resolvedAt?, resolvedBy?, resolution?, origin?, schemaVersion}`.
- **FieldChangeEvent**: `{id, caseId, clientId, section, fieldKey, priorValue, newValue, priorSrc, newSrc, changedAt, changedBy, reason: 'edit'|'confirm-synthesized'|'conflict-resolution'|'seed'|'import', conflictId?, origin?, schemaVersion}`.
- **RepairReport**: `{ranAt, envMismatch, placeholderClientsCreated, prunedWorklist, prunedStream, prunedActivity, retargetedDocuments, recomputedCases}`.
- **CaseFileExport**: `{envelope: {exportVersion:1, exportedAt, crmSchemaVersion, caseId}, records: {case, clients[], applicants[], documents[], checklist, worklist[], stream[], activity[], criteria[], products[], retention[], compliance, conflicts[], fieldChangeEvents[]}}`.

## Trade-off Resolutions

The stakeholder synthesis explicitly deferred six decisions to this spec. All six are resolved here, and the resolution is load-bearing on later features.

1. **Fact-find value typing.** Resolved (see FR-004): discriminated union keyed by `t`, with `money` as its own variant carrying `Pence`. Display strings never persist. This is the choice that lets F02's inline editor be a strongly typed switch statement, and lets the export/import round-trip pass a byte-equality test without a canonicalization pass over money formatting.
2. **Stream-entry cap.** Resolved (see FR-030): named constant `STREAM_ENTRIES_PER_CASE_CAP = 200`; cap enforced at *write* time (append-only in spirit but bounded in practice); visible truncation marker inserted at eviction; unresolved *needs you* entries are ineligible for eviction. Rationale: the FCA archive is the export, not the localStorage envelope — the store is a demo/working surface. `FieldChangeEvent`s and `ConflictRecord`s (the true compliance substrate) do not live in the stream and are not subject to the cap.
3. **Ownership fields.** Resolved (see FR-022): a single **optional** `ownership?: {adviserId, firmId, networkId}` object on `Case`, defaulted at seed time to Eleanor Vance / Meridian Mortgages / Stonebridge. Rationale: keeping it optional lets pre-adviser-assignment cases exist (matches the LEAD-stage semantics); a single object beats three top-level fields when we later add firm/network switching.
4. **Client-erasure semantics.** Resolved (see FR-016 + edge case): `removeClient` **refuses while referenced** and returns a typed refusal `{ok:false, reason:'referenced_by_case', caseIds}`. The guard lives in `clientsStore.removeClient`, which reads `casesStore.getState()` — this is legal under the one-directional import rule (FR-014) since the guard is a read, not a subscription. GDPR-erasure (`anonymiseClient`) is explicitly out of scope for F01 and will land as part of the compliance feature. Rationale: refusing is cheap, reversible, and does not commit us to an anonymisation shape before we know what the compliance UI demands.
5. **Single ordered `crmIntegrityRepair()`.** Resolved (see FR-036): adopted. One entry point, ordered passes, structured `RepairReport`, surfaceable via `getLastRepairReport()` and per-repair `ActivityEvent`s + `console.warn`. Rationale: microtask-after-hydration is the house idiom; a single ordered function is testable and reproducible; ad-hoc per-store repair drifts.
6. **Conflict record shape.** Resolved (see FR-032, FR-033): first-class `ConflictRecord` with composite address `(caseId, clientId, section, fieldKey)`, both original values retained on the record with `source` provenance, `FactFindField.conflictId` referencing it; boolean flags are replaced by the presence of a `conflictId`. Rationale: modelling as records — not booleans — is the only way FR-020's atomic resolution can also produce a defensible audit trail; the composite address is the only key that survives cross-store re-linking after import.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001** — *Golden path counts match the design reference exactly.* After `seedCrmGoldenPath()`, the following selectors return the design's canonical numbers: `selectNeedsYouCount() === 6`; `selectPipelineCounts()` totals 8 with the stage distribution from §3.6 (1 LEAD, 2 FACT_FIND, 1 DIP, 1 APPLICATION, 1 VALUATION, 1 OFFER, 1 COMPLETION); `selectCaseCompleteness('c417')` in `[0.895, 0.905]`; c417's LTV is 85% (± 0.01), LTI is 2.95× (± 0.01), loan is £242,250 (24_225_000 pence), and combined income is £82,100.
- **SC-002** — *Atomic conflict resolution completes in one call and produces every audit artifact.* `resolveConflict()` for the Daniel salary conflict produces, in a single call: one field mutation, one insight mutation, one worklist status change (not delete), one stream entry with a complete reasoning trace, and exactly one `FieldChangeEvent` with `reason:'conflict-resolution'`. Verified by a vitest that snapshots state before and after and asserts on the delta.
- **SC-003** — *Round-trip export/import is byte-equal.* After seed → export c417 → wipe → import → export c417 again, `JSON.stringify(canonicalise(export1)) === JSON.stringify(canonicalise(export2))`.
- **SC-004** — *Feature ships with zero UI, zero deps, zero routes, and zero network calls.* `pnpm build`, the design-token scan, the no-legacy-backend gate (never write the case-convention token as two words separated by a space), the dead-brain-identifiers gate, i18n parity, and the vitest baseline all pass. No `package.json` diff beyond what is strictly necessary (target: zero).
- **SC-005** — *Feature ships ≥ 60 new passing vitest tests.* No baselined failing file is touched. Coverage spans: every store action (upsert, remove, resolve, seed, confirm-synthesized, resolve-conflict, move-stage, complete-document, set-checklist-status, push-stream-entry, resolve-worklist, upsert-retention, note-activity), the completeness math, the stream cap eviction rules including the never-evict-unresolved invariant, persist migration + partialize round-trips via `persist.getOptions().migrate?.(fixture, 0)`, env-mismatch clearing, `JSON.stringify` round-trip of each partialized state, seed idempotence, integrity repair for each of the six pass conditions, fixture integrity (LTV/LTI/loan/completeness numbers), and full export→wipe→import round-trip.
- **SC-006** — *F02–F05 consume this layer with zero type changes.* When F02 (Today), F03 (Cases board/table), F04 (Case Stream + State Pane) and F05 (Fact Find) are subsequently built, no PR needs to reach back into `src/crm/domain/types.ts` to add or change a type to render the design reference's screens. Success is measured retroactively: at the point F05 merges, the count of type-shape edits to files under `src/crm/domain/` in commits with the F02–F05 milestones is zero.
- **SC-007** — *Repair passes surface, not swallow.* Any invocation of `crmIntegrityRepair()` that mutates state MUST both return a non-null `RepairReport` and be readable via `getLastRepairReport()`. A vitest simulates a persisted state with a dangling `clientId` and asserts the placeholder client is created, the report reflects it, and an `ActivityEvent` records it.

## Assumptions

- The Eternyl app already ships with `zustand`, `date-fns`, and the `generateUniqueId()` / `getAuthEnvironmentKey()` helpers. No new dependencies are required.
- The base branch is `lendmind-crm`; the PR for F01 targets `lendmind-crm`, never `main`. Downstream F02+ PRs target the same branch.
- The design reference document (`.lm-flow/recon/lendmind-advisor-design-reference.md`) is authoritative for domain data. Where the design reference is silent on a field's `src`, the default is `syn` if the value is a computed rollup (e.g. `incomeConsidered`) and `det` otherwise.
- The dev-gated seed's guard mechanism follows the same pattern as `INITIAL_BLANK_SPACE_CREATED_FROM` in `spaceStore.ts`. If a first-time flag is unavailable, the seed guard reads `import.meta.env.DEV`.
- Timestamps in fixtures use the design reference's stated dates converted to epoch-ms; where a fixture says `'6 min ago'` or `'Just now'`, the seed computes the timestamp against `Date.now()` at seed time.
- License headers on new `.ts` files follow the repo's existing header convention (matching the top of `src/store/spaceStore.ts`).
- The no-legacy-backend gate's word-forbidden rule is respected throughout this spec: the case-convention token that combines "camel" with "case" is written only as one token, camelCase.
- The design-token gate scans all of `src/`, including `src/crm/fixtures/`. Consequently, fixture data expresses colors only as semantic tone keys — never a hex value, an `rgb(...)` value, or a direct Tailwind color class.
- Post-merge headless validation will drive user stories 1, 2 and 3 directly by importing store hooks and helpers into a Node/vitest harness — no browser is required. The validator gates on the presence of the three journeys under `## User Journeys` in this spec; the section below aliases the User Scenarios section for the validator's benefit.

## User Journeys

*(Aliases the three prioritized user stories above so the post-merge headless validator can locate them by heading. Because F01 ships no UI, each journey is verified by direct calls to the domain layer inside vitest — no browser drive, no screenshot capture.)*

- **Journey A — Seed and read the golden path.** See User Story 1. Headless verification: `seedCrmGoldenPath()` → assert selector outputs match the design reference's headline numbers (SC-001).
- **Journey B — Atomic conflict resolution with audit.** See User Story 2. Headless verification: resolve Daniel's £38,500 vs £37,300 salary conflict via `resolveConflict()` → assert one call produces all seven required side-effects and one `FieldChangeEvent` (SC-002).
- **Journey C — Export and wipe compliance lifecycle.** See User Story 3. Headless verification: seed → export c417 → `clearAllCrmState()` → import → export again → assert byte-equal round-trip after canonicalisation (SC-003).

---

## Appendix: Persona dissent record

This spec was generated from a multi-persona synthesis. Disagreements the spec resolves:

| # | Dissent | Personas | Resolution in this spec |
|---|---|---|---|
| 1 | `FactFindField.v` typing (display strings vs typed values vs pence) | Software Engineer (top stall risk) | FR-004: discriminated union keyed on `t`; `money` variant carries `Pence`; display strings never persist |
| 2 | Stream cap contradicts append-only FCA record | Head of Sales (append-only) vs Principal Architect (cap at write) vs UX (visible marker) vs PM (never evict unresolved) | FR-030: cap at write time, named constant, truncation marker, unresolved entries ineligible; compliance substrate (FieldChangeEvents/ConflictRecords) exempt — the FCA archive is the export |
| 3 | Ownership fields now vs frozen minimal surface | Head of Sales (require adviser/firm/network) vs PM (smallest surface) | FR-022: single optional `ownership?` object, seeded to Eleanor Vance/Meridian/Stonebridge |
| 4 | `removeClient` guard direction + GDPR erasure | Software Engineer (dependency inversion) vs Sales (right-to-erasure) | FR-016: typed refusal while referenced; guard reads casesStore.getState() (read-only, legal); `anonymiseClient` explicitly deferred to the compliance feature |
| 5 | Per-store repair races half-hydrated siblings | Principal Architect | FR-036: single ordered `crmIntegrityRepair()` + RepairReport + getLastRepairReport() — adopted wholesale |
| 6 | Conflicts as boolean flags cannot render both sides | UX Designer, PM (atomicity), SE (composite address) | FR-032/033: first-class ConflictRecord with composite (caseId, clientId, section, fieldKey), both values + sources retained; `conflictId` replaces booleans |

Unanimous stakeholder requirements adopted without contest: typed persisted `FieldChangeEvent` on every fact-find mutation; worklist retain-with-status (never delete); `confirmSynthesizedField` recording confirmedAt/By; `origin?: {artifactId, runId}` seam for F07; per-domain fixture modules; case-file JSON export; `clearAllCrmState()`; structured repair observability.

Source files:
- Architecture: .lm-flow/architecture/crm-domain-core.md
- Personas: .lm-flow/personas/crm-domain-core/*.md
- Synthesis: .lm-flow/personas/crm-domain-core/synthesis.md
- /speckit-specify log: .lm-flow/personas/crm-domain-core/speckit-specify-run.log
