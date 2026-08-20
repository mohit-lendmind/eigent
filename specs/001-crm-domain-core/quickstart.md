# Quickstart — Headless validation for crm-domain-core

**Feature**: F01 `crm-domain-core` · **Branch**: `lendmind-crm`

This feature ships **no UI**. All three user stories are verified headlessly by driving the domain layer directly from a vitest process — no browser, no screenshot capture. This document is the runnable validation guide the post-merge validator (`validate-feature`) executes.

For entity shapes and invariants, see [`data-model.md`](./data-model.md).
For public API signatures, see [`contracts/`](./contracts/).
For the full FR mapping, see [`spec.md`](./spec.md).

---

## Prerequisites

- Repo checked out on the `lendmind-crm` branch.
- Node + pnpm installed (versions per repo `package.json` and `.nvmrc`).
- Dependencies installed: `pnpm install`.
- `src/crm/` implementation and `test/unit/crm/` suite already merged.

## Setup (once per environment)

```bash
pnpm install
pnpm build            # verifies the whole app still builds (SC-004)
pnpm type-check
pnpm lint             # includes the design-token / no-legacy-backend / no-dead-brain gates
```

If any of the above fails, **stop** — the feature is not ready to validate.

## Run the full CRM test suite

```bash
pnpm test -- --run test/unit/crm src/crm
```

Expected: ≥60 new passing tests, zero baselined failures touched (spec SC-005).

---

## Journey A — Seed and read the golden path

**Verifies**: User Story 1 · Acceptance FR-046 · Success Criterion SC-001.

**File**: `test/unit/crm/seed.integration.test.ts`

**What it does**:
1. `beforeEach`: full `setState` reset on all four stores; `localStorage.clear()` (also handled globally by `test/setup.ts`).
2. Assert all four stores start empty.
3. `seedCrmGoldenPath()`.
4. Assert every store is populated in a single observable transition (subscribe with a spy before the call; expect exactly one non-empty snapshot).
5. Assert the four `localStorage` envelope keys (`crm-clients-store`, `crm-cases-store`, `crm-documents-store`, `crm-workstream-store`) exist with the current environment key.
6. Run `seedCrmGoldenPath()` a second time; assert **no additional persist writes** and **no duplicate records** (idempotence — spec acceptance #2).
7. Run selector assertions:
   - `selectNeedsYouCount() === 6`
   - `selectPipelineCounts()` totals 8 with `{LEAD:1, FACT_FIND:2, SOURCING:0, DIP:1, APPLICATION:1, VALUATION:1, OFFER:1, COMPLETION:1}`
   - `selectCaseCompleteness('c417')` ∈ `[0.895, 0.905]`
   - `selectNeedsYou()` returns exactly 6 items in the design-reference order (spec acceptance #4)
   - `selectCaseStreamSections('c417')` returns four sections `{live, needsYou, directives, activity}` with the live solver entry pinned first (spec acceptance #5)
   - `selectRetentionUrgency(entries, /* now */ Date.parse('2026-06-13'))` ranks Tom's c392 entry first with `daysLeft = 79`
8. Fixture-integrity assertions:
   - c417 LTV = 85% (± 0.01), LTI = 2.95× (± 0.01), loan = 24_225_000 pence, combined income = £82,100
   - Every c417 sourcing `pass` row carries non-empty `rationale` and `criteriaTrail`
   - Every c417 sourcing `fail` row carries `rejectReason`, `rejectCriterion` (e.g. `'Skipton § 3.1 Employment tenure'`), `failOn` (spec acceptance #6)

**Pass criterion**: all vitest assertions green.

---

## Journey B — Atomic conflict resolution with audit

**Verifies**: User Story 2 · Acceptance FR-020, FR-034 · Success Criterion SC-002.

**File**: `test/unit/crm/conflict.integration.test.ts`

**What it does**:
1. `seedCrmGoldenPath()`.
2. Capture the **initial state** of the four stores relevant to Daniel's £38,500 vs £37,300 salary conflict:
   - Fact-find field `('c417', danielId, 'income', 'basic')`: has `conflictId` set.
   - Document `d5` (Employment contract) has an insight `Salary` with `conflict: true`.
   - Worklist item `w1`: `status: 'open'`.
   - Case c417 stream length: N (record it).
   - `FieldChangeEvent` count for the field: 1 (the seed event).
3. Subscribe **once** to all four store hooks with a spy that records every emission across all stores in order.
4. Call `resolveConflict(w1LinkedConflictId, { chosenValue: { t:'money', v: 3_850_000 as Pence }, method: 'confirm-value', resolvedBy: 'EV', reasoning: 'Contract is the authoritative source' })`.
5. Assert **exactly one emission per affected store** — no partial-state observation (atomicity, FR-020).
6. Post-resolution assertions (all seven side-effects, spec User Story 2 acceptance #1):
   - (a) Field value now `{t:'money', v: 3_850_000}` with `src: 'det'`; `conflictId` cleared.
   - (b) `ConflictRecord.resolvedAt` and `.resolvedBy: 'EV'` set; `.resolution.method === 'confirm-value'`; `values[]` still contains BOTH original entries with their `source` provenance (spec acceptance #2).
   - (c) Document `d5` insight `Salary` now has `conflict: false`.
   - (d) Worklist `w1`: `status: 'resolved'`, `resolvedAt` set, `resolvedBy: 'EV'` — NOT deleted (spec acceptance #4).
   - (e) One new `StreamEntry` of kind `done` appended to c417 with a complete `ReasoningTrace` (claim, working showing competing values, evidence citing d5 and d2 with verbatim quotes, alternatives listing the not-chosen value, `confidence: 1.0`, calibration = adviser reasoning).
   - (f) Exactly one new `FieldChangeEvent` with `reason: 'conflict-resolution'`, both `priorValue` and `newValue` populated, `conflictId` reference set (spec acceptance #3).
   - (g) `computeSectionCompleteness` for c417 Daniel `income` section recomputed to reflect the now-deterministic field.
7. Idempotence check: call `resolveConflict` again with the same id and args. Assert **no additional stream entry**, **no additional `FieldChangeEvent`**, no exception (spec acceptance #5).
8. Round-trip check: export c417 with `exportCaseFile`, wipe with `clearAllCrmState`, import; assert the resolved `ConflictRecord` (with both original values), the `FieldChangeEvent`, and the `done`-kind stream entry all reappear identically (spec acceptance #6).

**Pass criterion**: all vitest assertions green.

---

## Journey C — Export and wipe compliance lifecycle

**Verifies**: User Story 3 · Acceptance FR-039, FR-040, FR-041 · Success Criterion SC-003.

**File**: `test/unit/crm/export.integration.test.ts`

**What it does**:
1. `seedCrmGoldenPath()`.
2. `const export1 = exportCaseFile('c417')`.
3. Assert `export1.envelope.exportVersion === 1`, `envelope.crmSchemaVersion === CRM_SCHEMA_VERSION`, `envelope.caseId === 'c417'`.
4. Assert record counts match the seeded state exactly (spec acceptance #1):
   - `applicants.length === 2`
   - `documents.length === 6`
   - `stream.length >= 7`
   - `conflicts.length >= 1`
5. `clearAllCrmState()`. Assert all four stores report empty and all four `localStorage` keys are absent (spec acceptance #2). Assert non-CRM `localStorage` keys are untouched (FR-039).
6. `importCaseFile(export1)`. Assert `{ ok: true, imported: {...} }`.
7. Re-run every selector from Journey A. Assert byte-equal output for both runs after canonical key-sort (spec acceptance #4).
8. `const export2 = exportCaseFile('c417')`.
9. Assert `JSON.stringify(canonicalise(export1)) === JSON.stringify(canonicalise(export2))` (SC-003 — byte-equal round-trip).
10. Negative case: `exportCaseFile('nonexistent')` returns `{ ok: false, reason: 'unknown_case' }`, **not a throw** (spec independent test).
11. If Journey B has run before this journey (test suite ordering), assert the resolved conflict, its `FieldChangeEvent`, and the done-kind stream entry all round-trip (spec acceptance #5).
12. Id-collision case: attempt `importCaseFile(export1)` a second time without wiping first. Assert `{ ok: false, reason: 'id_collision', ids: [...] }` (FR-041).

**Pass criterion**: all vitest assertions green.

---

## Supporting suites (also run as part of `pnpm test -- --run test/unit/crm src/crm`)

| Suite | Verifies |
|---|---|
| `test/unit/crm/integrity.test.ts` | Six pass conditions of `crmIntegrityRepair()`; placeholder client insertion for dangling `clientId`; `RepairReport` surfaced via `getLastRepairReport()`; `ActivityEvent` per state-mutating pass (SC-007). |
| `test/unit/crm/persist.roundtrip.test.ts` | `JSON.stringify` round-trip of each partialized state (no `bigint`, `Date`, function, `Symbol`, `undefined`); `persist.getOptions().migrate?.(fixture, 0)` shape-repair; env-mismatch → empty state. |
| `test/unit/crm/envMismatch.test.ts` | Envelope written under a different `getAuthEnvironmentKey()` yields empty state on rehydration, and the repair report notes `envMismatch: true`. |
| `src/crm/domain/money.test.ts` | `formatGbp(4_275_000) === '£42,750.00'`; `formatGbp(4_275_000, {compact:true}) === '£42.8k'`; `parseGbp('£38,500') === 3_850_000`; `parseGbp('nonsense') === null`. |
| `src/crm/domain/stages.test.ts` | Stage order, `stageIndex`, `nextStage`; every `tone` is a semantic key (no `#`, no rgb, no tailwind color class). |
| `src/crm/clientsStore.test.ts` | `upsertClients`, `removeClient` typed refusal, `noteClientCase` idempotent append, `ensureClient` placeholder fallback. |
| `src/crm/casesStore.test.ts` | `setFactFindField` atomic write + `FieldChangeEvent` + recompute; `confirmSynthesizedField` src flip + timestamps; `moveStage` validation + `ActivityEvent`; completeness math. |
| `src/crm/documentsStore.test.ts` | `addDocument` PROCESSING; `completeDocument` COMPLETED; `confirmAttribution` timestamp; `setChecklistStatus`; insight `conflict:true` does NOT auto-mutate fact-find (FR-026). |
| `src/crm/workstreamStore.test.ts` | Stream cap eviction rules (evict oldest eligible; never evict unresolved `conflict`/`approval`; truncation marker inserted); `resolveWorklistItem` retains (never deletes); `FieldChangeEvent` append + queries; `upsertRetention` key semantics; `noteActivity`. |
| `src/crm/selectors.test.ts` | Every selector returns `EMPTY_ARRAY`/`EMPTY_MAP` singletons on empty input (referential equality across two calls); every selector output matches fixture expectations after seed. |

---

## Post-merge validator hook

`validate-feature` locates the three journeys in `spec.md` under the `## User Journeys` heading and runs the following against the merged branch:

```bash
pnpm install
pnpm build && pnpm type-check && pnpm lint
pnpm test -- --run test/unit/crm src/crm
```

**Pass**: every gate above returns 0 AND the vitest exit code is 0 AND the count of new tests is ≥60.

**Fail**: any non-zero exit code, or a test count below the SC-005 minimum, or any baselined-failing file mutation detected in the diff.

The validator writes its report and evidence to `.lm-flow/runs/<slug>/evidence/` and notifies via WhatsApp with a pass/fail summary. Since there is no browser drive, no screenshots are captured — the evidence is the vitest reporter output and the four `localStorage` envelope JSON payloads captured after `seedCrmGoldenPath()`.
