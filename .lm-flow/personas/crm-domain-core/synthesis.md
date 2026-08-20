# Synthesis: crm-domain-core

## Unanimous requirements
- Money as integer pence (`number`) with `formatGbp` beside the type; never bigint in persisted state (all five).
- Tone keys, never hex, in stage/kind catalogs — the design-token gate scans all of `src/` (all five).
- det/syn provenance on every fact-find field; `ReasoningTrace` (claim/working/evidence/alternatives/confidence/calibration) in domain types from day one (all five).
- Environment-scoped persistence (`getAuthEnvironmentKey()`), two-version idiom (persist envelope + per-record `schemaVersion`), migration + JSON round-trip tests per store via `persist.getOptions()` (all five).
- **Worklist items are retained on resolution with `{status, resolvedAt, actor}` — never deleted** (UX, PM, Sales all independently; settles the architecture's open question).
- **Typed field-change audit**: every fact-find mutation emits a persisted `FieldChangeEvent { caseId, clientId, section, fieldKey, prior: {value, src}, next: {value, src}, actor: 'adviser'|'agent', at }` — serves UX undo, PM/FCA audit, Sales compliance story in one shape (UX, PM, Sales).
- Golden-path fixtures split into per-domain modules re-exported from `goldenPath.ts`; fixture-parity tests pin the design's headline numbers (85% LTV, 2.95× LTI, £242,250, £38,500 vs £37,300) via shared named constants (SE, PM, Sales).
- Seed is an explicit, idempotent, dev-only action; double-invocation adds no duplicates (UX, PM, SE).
- Exhaustive per-section fact-find field-key enumeration IN THE SPEC (design ref §3.4), `assertNever` on all union switches (SE).
- `confirmSynthesizedField` records `confirmedAt`/`confirmedBy` (UX, PM).
- Optional `origin?: { artifactId, runId }` on agent-producible entities — pre-cuts the F07 ingest seam without a v2 migration (PA, PM concur via frozen-surface goal).
- Structured prune/repair observability: shared warn helper with store name, ids, reason; non-persisted `lastRepairSummary` surfaced in state (PA, UX).
- `clearAllCrmState()` clearing all four keys, tested (PA, Sales GDPR).
- Case-file JSON export: one function serializing a case across all four stores, round-trip tested with traces intact (Sales; PA supports as data-lifecycle).

## Tradeoffs to be resolved in spec
1. **`FactFindField.v` typing** (SE top stall risk): design shows display strings (`'£42,000'`, `'2 yr 4 mo'`); toggles are boolean; architecture mandates pence. SE wants a discriminated value type keyed on `t`; fixtures are blocked until decided. Spec must pick one concrete rule (proposal on the table: `v: string | number | boolean` narrowed by `t`, money fields hold `Pence` with display formatting left to UI, free-text estimates stay strings).
2. **Stream cap vs append-only compliance record**: Sales insists stream/worklist/activity are append-only FCA records ("3-year retention" pitch) and any cap is a documented demo-only constant; PA insists the cap applies at `pushStreamEntry` (not silently in `partialize`) so memory and persisted state agree; UX wants a visible `truncatedCount` marker; PM adds pruning must never drop unresolved NEEDS-YOU/approval entries. Spec must define one cap mechanism satisfying materiality of all four positions.
3. **Ownership fields now vs minimal frozen surface**: Sales wants `adviserId`/`firmId`/`networkId` on Client/Case now (brutal to retrofit into persisted stores); PM wants the smallest surface that F02–F17 never patch. Spec decides whether ownership lands as required fields, optional fields, or a single `ownership` object with defaults from a fixture adviser (Eleanor Vance).
4. **`removeClient` guard vs erasure**: architecture says refuse while cases reference; SE says the guard as specified inverts store dependency direction (implement in facade/call-site, not clientsStore importing casesStore); Sales says refusal blocks GDPR right-to-erasure and wants anonymise-or-cascade defined. Spec must define the erasure semantics and where the guard lives.
5. **Cross-store integrity**: PA conditions the 4-store split on a single ordered `crmIntegrityRepair()` running after all four hydrate (not per-store microtasks racing half-hydrated siblings) + a named `MISSING_CLIENT` placeholder shape. Spec adopts or justifies otherwise.
6. **Conflict shape**: UX requires conflicts to carry both competing values with sources and timestamps (not boolean flags) on both `FactFindField` and `DocInsight`; SE requires `resolveConflict` addressed by composite path (caseId, clientId, section, fieldKey). PM requires resolution to update field, doc insight, worklist, stream atomically. Spec defines the conflict record and the atomic resolution action.

## Acceptance criteria (union)
- `pnpm type-check && pnpm lint && pnpm test` green; ≥60 new passing tests; vitest baseline untouched; license header on every new file; no `/camel/i` matches; no dead-brain identifier names; no hex anywhere including fixtures.
- From seeded state, selectors return the design's Today counts (6 needs-you, 4 activity, 4 retention) and c417/c392 headline numbers; §3.20 compliance record reproduced including pending gift letter.
- Per-store: JSON round-trip of partialized state; `migrate(fixture, 0)` drives shape repair; environment-switch clears all four keys.
- Every fact-find mutation emits a `FieldChangeEvent`; conflict resolution is atomic across field/doc/worklist/stream; resolveConflict on a non-conflicted field is a no-op.
- `computeSectionCompleteness` defined for 0-field sections (no NaN); £0 (det) distinct from missing; toggle `false` distinct from absent; retention at exactly 90 days deterministic.
- Export of CASE_417 round-trips through JSON with every trace intact.
- Seed idempotent; `clearAllCrmState()` wipes all four keys.
- Frozen surface: F02–F05 consume types without modifying them (tracked as the feature's success metric).

## Out of scope (explicit)
- Any UI, routes, components (F02+).
- Any network/edge calls, the artifact-ingest implementation (F07) — only the `origin?` seam lands now.
- Server-side persistence/encryption (localStorage is the documented demo substrate; a written GDPR/SAR position note lands in the spec's docs, actual server persistence deferred).
- Cross-tab localStorage sync (documented known limitation).
- Multi-firm data partitioning beyond ownership fields.

## User Journeys (required output for downstream validation)

Note: F01 is UI-less; journeys are verified headlessly (vitest + a scripted console harness), not by browser. F02 inherits these journeys with UI.

### Journey 1 — Seed and read the golden path
**As a** downstream feature developer (F02–F05) **I want to** seed the golden path and read every Today-screen figure from selectors **so that** UI features build against real, design-faithful data.

**Steps:**
1. Call `seedCrmGoldenPath()` on empty stores.
2. Read `selectNeedsYou`, pipeline counts, activity, retention selectors.
3. Call `seedCrmGoldenPath()` again.

**Success criteria:**
- Selectors return 6 needs-you items, 4 activity rows, 4 retention entries, 8 pipeline rows with design stages.
- c417 shows loan £242,250, LTV 85%, LTI 2.95×, completeness 0.9; Daniel's salary conflict present.
- Second seed call adds zero duplicates.

### Journey 2 — Resolve the salary conflict with full audit
**As an** adviser (via the future F04/F06 UI, exercised at store level today) **I want to** resolve Daniel's £38,500 vs £37,300 conflict **so that** one decision updates every surface and leaves an audit trail.

**Steps:**
1. From seeded state, call the atomic `resolveConflict` action choosing the contract value £38,500.
2. Inspect field, document insight, worklist item, stream entry, and audit log.

**Success criteria:**
- Field shows £38,500, `src:'det'`, conflict cleared with retained conflict record; doc insight conflict cleared; worklist item w1 status `resolved` with timestamp+actor (not deleted); stream conflict entry closed.
- A `FieldChangeEvent` exists with prior/next values and actor.

### Journey 3 — Export and wipe (compliance lifecycle)
**As a** compliance officer **I want to** export a complete case file and erase local data **so that** FCA record-keeping and GDPR requests are answerable.

**Steps:**
1. Export CASE_417 via the case-file serializer.
2. Parse the JSON; verify traces and compliance record.
3. Call `clearAllCrmState()`.

**Success criteria:**
- Export contains applicants, full fact-find with provenance, documents+insights, stream with reasoning traces, criteria, products, compliance record incl. pending gift letter.
- Export JSON round-trips (parse → deep-equal on re-serialize).
- After clear, all four `crm-*-store` keys are empty and stores return initial state.

## Brief for /speckit-specify
We are building `crm-domain-core`, the foundation feature of Lendmind Advisor — an AI-native UK mortgage broker CRM being built inside the Eternyl Electron/React desktop app (see `.lm-flow/architecture/crm-domain-core.md`, which this spec must follow for component layout, and `.lm-flow/recon/lendmind-advisor-design-reference.md` §3 for the canonical domain data). This feature is a pure, UI-less typed domain layer under a new `src/crm/`: entity types for Client, Case, Applicant (join), fact-find fields with deterministic-vs-synthesized provenance, an 8-stage pipeline catalog using semantic tone keys (never hex — a lint gate scans all source for colors), documents with typed insights and confidence, checklists, a worklist of adviser decisions, stream entries carrying full reasoning traces (claim, numbered working, cited evidence with verbatim quotes, alternatives, calibrated confidence), criteria checks, sourcing products, and retention entries. Four persisted zustand stores (clients, cases, documents, workstream) follow the house persistence idiom exactly: localStorage persist envelopes versioned separately from per-record schema versions, shape-repair migrations, explicit partialize allowlists, environment-scoped tenancy that clears on auth-environment mismatch, and a single ordered cross-store integrity repair after hydration. Money is integer pence with a GBP formatter; timestamps are epoch milliseconds; ids compose the repo's `generateUniqueId()`.

Non-negotiable requirements assembled from five stakeholder reviews: a typed, persisted `FieldChangeEvent` audit record emitted by every fact-find mutation (FCA/Consumer Duty substrate — the costliest thing to retrofit); worklist items retained with resolution status/timestamp/actor, never deleted; conflicts modeled as records carrying both competing values with sources (not boolean flags), resolved by one atomic action that updates field, document insight, worklist and stream together; `confirmSynthesizedField` recording confirmedAt/confirmedBy; an optional `origin` (artifactId, runId) field on agent-producible entities to pre-cut the later agent-ingest seam; a named placeholder mechanism for dangling cross-store references; structured, surfaceable repair/prune reporting; `clearAllCrmState()`; and a one-function case-file JSON export that round-trips with all reasoning traces intact. The spec must enumerate every fact-find field key per section exactly as the design reference §3.4 lists them (personal/contact/address/employment/income/expenditure/credit for both golden-path applicants) — "see design reference" is not acceptable; implementers stall without the enumeration.

Six trade-offs were deliberately left open by the stakeholder synthesis and must be resolved by this spec: (1) the exact typing of fact-find field values across text/select/date/number/toggle given money-as-pence vs the design's display strings; (2) the stream-entry cap mechanism reconciling an append-only compliance record with a bounded demo persistence (cap applied at write time, visible truncation marker, never dropping unresolved needs-you entries); (3) whether adviser/firm/network ownership fields land required, optional, or as one ownership object defaulted from the fixture adviser Eleanor Vance; (4) client-erasure semantics (refuse-while-referenced vs anonymise-or-cascade) and where the guard lives given one-directional store imports; (5) adopting the single ordered `crmIntegrityRepair()`; (6) the conflict record shape and composite addressing (caseId, clientId, section, fieldKey). Record each resolution explicitly.

Deliverables: the domain layer (Phase 1: types, stage catalog, money/ids, four stores with persistence+migrations, pure completeness math, audit events; Phase 2: selectors, per-domain golden-path fixture modules faithfully transcribing case c417 (Aisha Okafor + Daniel Reyes, incl. Daniel's probation flags and the £38,500-contract vs £37,300-payslip salary conflict), case c392 (Tom Hargreaves, self-employed, 79-day retention), 8 pipeline rows, 6 documents with insights, 6 worklist items, 10 criteria checks with per-lender impacts, the 2-year and 5-year solver product universes with rejection cites, stream entries with complete reasoning traces, and the compliance record; a dev-gated idempotent seed; the export serializer; integrity repair). Quality gates: type-check, eslint, design-token scan (no hex anywhere, fixtures included), no-legacy-backend (never write the word for the case-convention that contains "camel" followed by a space and "case" — write it only as one token, camelCase), i18n parity (no new locale keys), vitest baseline (≥60 new passing tests, no baselined file touched), license headers on all new files. Success metric: features F02–F05 consume this layer with zero type changes.

The spec MUST include a "## User Journeys" section containing the three journeys above (or refined versions): seed-and-read golden path, atomic conflict resolution with audit, and export-and-wipe compliance lifecycle — noting they verify headlessly for this UI-less feature. This is a hard requirement; post-merge validation depends on it.
