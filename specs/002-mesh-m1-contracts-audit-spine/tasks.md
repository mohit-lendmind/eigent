---
description: "Task list for feature implementation — mesh-m1-contracts-audit-spine (M1)"
---

# Tasks: mesh-m1-contracts-audit-spine

**Input**: Design documents from `/specs/002-mesh-m1-contracts-audit-spine/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (7 frozen .d.ts), quickstart.md — all present.

**Tests**: Test tasks are INCLUDED and first-class — the spec's SCs pin convergence/tamper/settle properties, FR-023 mandates regression tests per review finding, and the demo (FR-022) is itself a named deliverable.

**Organization**: Grouped by user story after a Setup gate (P0: fix-branch merge) and a Foundational phase (contracts package — blocks all stories). Every path is repo-root-relative; everything is additive under `src/crm/` and `test/unit/crm/` except the named modifications (`_bus.ts`, `caseFile.ts`, `domain/{ids,types}.ts`, `index.ts`, `eslint.config.js`, `test/setup.ts`).

**Branch**: implementation runs on `feature/mesh-m1-contracts-audit-spine` cut from `lendmind-crm`; PR back into `lendmind-crm`. NEVER `main`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different file, no dependency on any incomplete task in this phase — safe in parallel.
- **[Story]**: `[US1]` fold/converge · `[US2]` tamper-evident export · `[US3]` outbox round-trip.

---

## Phase 1: Setup — the P0 gate (FR-023)

**Purpose**: land the parked review fixes with proof, capture the baseline. Nothing else starts until this checkpoint is green.

- [x] T001 Merge branch `fix/crm-review-iter1` (one commit, rebased on lendmind-crm; worktree `/Users/singhvib/Documents/eigent-crm-domain-core`) into the feature branch; resolve nothing silently — the commit is a clean overlay; then run `npx vitest run src/crm test/unit/crm` and confirm 108/108
- [x] T002 Author `test/unit/crm/reviewRegression.integrity.test.ts` — regression tests for review findings 1/6 (integrity repair actually invoked after hydration via barrel import; c392 self-employed `categoryForApplicant` reuse; completeness recomputed before rollup)
- [x] T003 [P] Author `test/unit/crm/reviewRegression.atomicity.test.ts` — findings 2/10 (resolveConflict precompute-then-commit: inject a mid-operation failure, retry finishes side-effects instead of no-oping; upsert touches only upserted cases, one clientsStore setState)
- [x] T004 [P] Author `test/unit/crm/reviewRegression.stream.test.ts` — findings 4/5 (push 50 past cap → length == cap, one coalesced marker, truncatedCount accounts for all evictions; persist slice never drops unresolved conflict/approval/markers, over-cap persist when nothing evictable)
- [x] T005 [P] Author `test/unit/crm/reviewRegression.bus.test.ts` — finding 3 (unwired bus dispatch is loudly observable; removeClient fails closed when cases bus unwired) + finding 7/8 fixture assertions (d7 Trafford payslip owned by daniel cited by the £37,300 conflict evidence; `{t:'missing'}` FieldValue round-trips persist deep-equal)
- [x] T006 Verify the full pre-push gate set green and record baseline: `pnpm type-check && pnpm lint && pnpm check:i18n && pnpm check:vitest-baseline && bash scripts/check-electron-access.sh` (SC-008 baseline capture)

**Checkpoint**: fix branch merged, every review finding pinned by a regression test, gates green.

---

## Phase 2: Foundational — the contracts package (blocks ALL user stories)

**Purpose**: `src/crm/agentContracts/` + `hashChain.ts` + fixtures. The frozen surfaces in `specs/002-mesh-m1-contracts-audit-spine/contracts/*.d.ts` are normative — a type-assignability test pins runtime exports against them.

- [x] T007 [P] Author `src/crm/agentContracts/errors.ts` — `ContractDecodeError` (field, reason, value snippet ≤200 chars) per house `problems.ts` error style; license header
- [x] T008 [P] Author `src/crm/agentContracts/envelope.ts` — `DirectiveEnvelope` + `decodeDirectiveEnvelope`/`encodeDirectiveEnvelope`/`directiveIdentity` per contracts/envelope.d.ts; required-string imperative checks per `src/api/aion/v1/contracts.ts:76-104` pattern; open-set `AgentId`
- [x] T009 [P] Author `src/crm/agentContracts/caseLog.ts` — `CaseLogEntry` + event union (12 members + reserved `chain-anchor`) + `decodeCaseLogEntry`/`encodeCaseLogEntry` per contracts/caseLog.d.ts; unknown event `type` decodes (open set) for the fold to quarantine (FR-003)
- [x] T010 [P] Author `src/crm/agentContracts/artifactKinds.ts` — `classifyKind` + `KNOWN_MAJORS` + `FailureArtifact` decode + per-family payload decoders (A1–A8 minimal typed payloads per data-model) per contracts/artifactKinds.d.ts (FR-002)
- [x] T011 [P] Author `src/crm/agentContracts/gates.ts` — `GATE_REGISTRY` G1–G10 populated from spec-v2 §5 (approver/regulated/batchable/autoDisarmFlags/basis/tier/slaMinutes), `gateById`, `delegableGates` per contracts/gates.d.ts (FR-004)
- [x] T012 [P] Author `src/crm/agentContracts/firmConfig.ts` — `FirmConfig` decode + `FIRM_CONFIG_DEFAULTS` (breaker 12, budgets 20_000/15_000_000 microGBP) per contracts/firmConfig.d.ts (FR-005)
- [x] T013 [P] Author `src/crm/agentContracts/reasonCodes.ts` — the 6-code table with mono title formatter `[CODE] <caseId> <param>` + params types (T5, FR-014)
- [x] T014 Author `src/crm/hashChain.ts` — `sha256HexCanonical` (WebCrypto over `canonicalise`), `computeEntryHash` (entry − {hash}), `settleHashOf` (entry − {seq,prevHash,hash}), `verifyChain` per contracts/caseLog.d.ts declarations (FR-016/17); export `canonicalise` from `src/crm/index.ts` barrel
- [x] T015 Add WebCrypto canary to `test/setup.ts` — assert `crypto.subtle` exists and digests 32 bytes at suite setup (FR-016, engineer dissent 8)
- [x] T016 Author `src/crm/agentContracts/index.ts` package barrel + extend `src/crm/index.ts` with agentContracts + hashChain exports
- [x] T017 [P] Author golden fixture log `src/crm/fixtures/caselog/c417Log.ts` — ≥40 chained entries reconstructing the c417 golden path via every union member (field-change, worklist, conflict, checklist, stage-transition, upserts), writer-stamped seq/prevHash/hash computed at authoring time via a fixture-builder helper `src/crm/fixtures/caselog/buildChain.ts`; plus negatives module `src/crm/fixtures/caselog/negatives.ts` (out-of-order arrival, unknown-major kind, tampered-hash, oversize marker, duplicate-seq) and `manifest.ts` for manifest-driven iteration (house `aionReducer` harness pattern)
- [x] T018 [P] Author `src/crm/agentContracts/envelope.test.ts`, `caseLog.test.ts`, `artifactKinds.test.ts`, `gates.test.ts`, `firmConfig.test.ts` — decode/encode round-trips over the manifest fixtures; malformed → `ContractDecodeError` naming the field; unknown major → `quarantine: true` never throw (colocated per house convention)
- [x] T019 [P] Author `src/crm/hashChain.test.ts` — chain verify on golden log; tamper any byte → `brokenAtSeq` exact; settleHash equality between candidate and writer-stamped echo; canonicalisation key-order independence
- [x] T020 Author `test/unit/crm/contractFreeze.test.ts` — type-level assignability of runtime exports against `specs/002-mesh-m1-contracts-audit-spine/contracts/*.d.ts` (import both, `satisfies`/assignment assertions) (FR-006, SC-006)

**Checkpoint**: contracts package green, chain primitives proven, freeze pinned. US1/US2/US3 can start.

---

## Phase 3: User Story 1 — Kill the laptop, reopen, converge (P1) 🎯 MVP

**Goal**: the artifact-canonical fold — `lm/case/` entries apply to the four F01 stores strictly ordered, exactly once, loudly.

**Independent Test**: fold golden log → snapshot → wipe → refold → byte-identical (no network; fixtures stand in).

- [x] T021 [US1] Additive domain changes: `Case.aionProjectId?`, `ActivityEvent.origin?`, `WorklistItem.reasonCode?/reasonParams?` in `src/crm/domain/types.ts`; `'outbox' | 'quarantine'` in `src/crm/domain/ids.ts` (FR-024; no schema bump)
- [x] T022 [US1] Author `src/crm/fold/eventLogStore.ts` — fifth persisted store `crm-eventlog-store` v1 per data-model state shape (watermarks/pendingByCase[NOT persisted]/quarantine+tombstones+everCount/outbox/anomalies/freshness/haltedCases/contractsVersion); full house checklist (env key, migrate+shape repair, partialize allowlist, resetForTests); register key in `CRM_LS_KEYS` + `clearAllCrmState()` in `src/crm/caseFile.ts` (FR-011/12/13)
- [x] T023 [US1] Author `src/crm/fold/caseLogFold.ts` — per-case serialized drain (`browserDelegationExecutor` pattern); BigInt decimal-seq watermark, replay → same reference; buffer ahead-of-order; verify prevHash link per entry; apply = precompute fully then one setState per touched store; halt-per-case on CHAIN_BREAK/FOLD_GAP with deduplicated worklist upsert (`wl_fold_<caseId>_<code>_<seq>` via reasonCodes); quarantine unknown event members as pointer records + everCount + advance; anomaly counters for DUPLICATE_SEQ (first-wins) and ENTRY_TOO_LARGE (FR-007/08/09/10/14, T4 refold check on contractsVersion + quarantine presence)
- [ ] T024 [US1] Author `src/crm/fold/foldSource.ts` — `refreshCaseLog` (list artifacts paged, client-side `lm/case/` prefix filter, inline reads ≤1 MiB with `content_truncated` → ENTRY_TOO_LARGE), `attachCaseLogLiveSource`/detach via `subscribeAionArtifacts`; freshness updates (`never|live|stale|failed|no-project`) (FR-015, D9)
- [ ] T025 [US1] Extend `eslint.config.js` `no-restricted-imports` (stores may not import `./fold/*`) + extend `test/unit/crm/crossStoreImports.test.ts` to pin it (FR-018 seam guard)
- [ ] T026 [P] [US1] Author `test/unit/crm/convergence.test.ts` — batch ≡ incremental byte-identical (`JSON.stringify`); replay no-op pinned with `toBe`; race guard: interleave `refreshCaseLog` with a live-notification fold, assert single application (SC-001)
- [ ] T027 [P] [US1] Author `test/unit/crm/killTheLaptop.test.ts` — Journey 1 verbatim: fold → S1 → `clearAllCrmState` wipe → refold → S2 deep-equal; watermark == head; <500 ms on the 1,000-entry synthetic log (generated from buildChain); env-key change variant: derived wiped, refold converges (FR-013, SC-001)
- [ ] T028 [P] [US1] Author `test/unit/crm/foldLoudness.test.ts` — every negative fixture: gap → ONE deduplicated item + halt that case only (other cases fold on); unknown major → quarantine pointer + cumulative count + advance; duplicate seq → first-wins + counter + item; oversize → typed failure + item; quarantine refold-on-upgrade: bump contractsVersion, reopen case → quarantined entry reinserts (T4) (SC-003)
- [ ] T029 [US1] Extend `test/unit/crm/persist.roundtrip.test.ts` to the fifth store (quarantine pointers, tombstones, everCount, outbox survive JSON round-trip; pendingByCase does NOT persist)

**Checkpoint**: US1 fully functional — the fold converges, loudly. **M2 is unblocked at this checkpoint's merge (T2 resolution).**

---

## Phase 4: User Story 2 — Tamper-evident export (P2)

**Goal**: export v2 that proves its own integrity; dual-version import.

**Independent Test**: export folded golden case → verified; tamper one entry → refold → export names brokenAtSeq.

- [ ] T030 [US2] Extend `src/crm/caseFile.ts` — `CaseFileExportV2` per contracts/exportV2.d.ts: envelope (chainHead, chainVerified, artifactManifest, gatePolicySnapshot from GATE_REGISTRY + firm config delegationRoster, versionsStamp, contractsVersion, firmId) + records (caseLogEntries, outboxUnflushed, quarantine, quarantineTombstones); `importCaseFile` accepts v1 (chainVerified: null) and v2 (verify before trusting) (FR-021)
- [ ] T031 [P] [US2] Author `test/unit/crm/tamperExport.test.ts` — Journey 2 verbatim: clean export verifies; tampered refold → chainVerified false + brokenAtSeq named + CHAIN_BREAK item distinct from FOLD_GAP + halt that case only; property sweep: flipping ANY single entry's byte flips verification (SC-002)
- [ ] T032 [P] [US2] Author `test/unit/crm/export.dualVersion.test.ts` — v1 bundle imports with integrity null; v2 round-trips; extend existing `test/unit/crm/export.integration.test.ts` expectations if touched

**Checkpoint**: US1 + US2 independently green.

---

## Phase 5: User Story 3 — Outbox round-trip (P3)

**Goal**: adviser edits apply instantly, queue durably, settle exactly once.

**Independent Test**: edit → outbox 1 → restart survives → flush (mocked) → simulated echo folds → settled once, no state change.

- [ ] T033 [US3] Extend `src/crm/_bus.ts` with `EventLogSideBus` (`enqueueOutbox`) + register/get pair; loud unwired dispatch (throw dev / console.error + queue prod per FR-020); wire registration via barrel side-effect import in `src/crm/index.ts`
- [ ] T034 [US3] Author `src/crm/fold/outbox.ts` — `recordLocalEvent` (LWW kinds only per `OUTBOX_LWW_KINDS`; synchronous typed quota refusal + OUTBOX_QUOTA item; settleHash computed at enqueue), `flushOutbox` (serialized drain, `createAttachment` carrier, retry per problem retryable/5xx, no Idempotency-Key on this route — CAS dedupe), settle-by-hash on fold (exactly once; duplicate echo no-op; out-of-position non-LWW echo → one-time refold-from-zero backstop per T1) (FR-018/19)
- [ ] T035 [US3] Wire outbox enqueue into the three LWW store write paths (`setFactFindField`, `setChecklistStatus`, `resolveWorklistItem`) via the bus — no static store→fold imports (verified by T025's lint + invariant tests)
- [ ] T036 [P] [US3] Author `test/unit/crm/outboxSettle.test.ts` — Journey 3 verbatim: enqueue on edit; restart survival; env-key wipe survival (source vs derived split); flush with mocked transport; echo settles exactly once (no state change, `toBe` on second echo); quota refusal path; unwired-bus loudness (SC-004)
- [ ] T037 [P] [US3] Author `test/unit/crm/outboxRefoldBackstop.test.ts` — non-LWW echo out of position triggers exactly one refold and converges (T1 backstop)

**Checkpoint**: all three stories independently green.

---

## Phase 6: Polish & cross-cutting

- [ ] T038 [P] Author `scripts/demo-mesh-m1.mjs` — the scripted compliance demo per quickstart §3 (fold → wipe → converge → tamper → failed verify → quarantine; evidence JSON + transcript to `test-results/demo-mesh-m1/`); unattended, <5 min from clean checkout (FR-022, SC-007)
- [ ] T039 [P] Extend `src/crm/seed.ts` dev-gate path so `seedCrmGoldenPath` can optionally seed VIA the fold (`{throughFold: true}`) — proving seed and fold produce identical state (converge cross-check)
- [ ] T040 Run the M2 rendering-contract spike test `test/unit/crm/renderingContract.test.ts` — imports ONLY the public barrel, renders (headless object assertions) an approval-card model from `GATE_REGISTRY` alone and a case-health strip from the six selectors (SC-005)
- [ ] T041 Full gate run + baseline check: `pnpm type-check && pnpm lint && pnpm check:i18n && pnpm check:vitest-baseline && bash scripts/check-electron-access.sh` + `npx vitest run src/crm test/unit/crm` (all green, baseline unmoved) (FR-025, SC-008)
- [ ] T042 Update PR body: Gates section, per-FR checklist, review-fixes section listing each iteration-1 finding and its regression test, demo transcript excerpt

---

## Dependencies & Execution Order

- **Phase 1 (Setup/P0)**: T001 → {T002..T005 in parallel} → T006. BLOCKS EVERYTHING.
- **Phase 2 (Foundational)**: T007..T013 parallel after T006; T014 after T007 (errors) — uses canonicalise (already exported after T014's own barrel change); T015 parallel; T016 after T007–T014; T017 after T009+T014 (fixtures need decode + chain builder); T018 after T016+T017; T019 after T014+T017; T020 after T016. BLOCKS all stories.
- **US1 (Phase 3)**: T021 first; T022 after T021; T023 after T022+T013; T024 after T023; T025 parallel with T022; T026..T029 after T024.
- **US2 (Phase 4)**: T030 after T023 (chain status) + T011 (registry) + T022 (store records); T031/T032 after T030. Independent of US3.
- **US3 (Phase 5)**: T033 after T016; T034 after T033+T014+T022; T035 after T034; T036/T037 after T035. Independent of US2.
- **Polish (Phase 6)**: T038 after T031 (tamper demo path); T039 after T024; T040 after T024+T011; T041 after all; T042 last.

### Parallel opportunities
- Phase 2: T007–T013 are seven parallel authoring tasks; T018/T019 parallel.
- US2 and US3 phases can run in parallel after US1's T023.
- All regression-test tasks T003–T005 parallel.

## Implementation Strategy

MVP = Phase 1 + 2 + US1 (T001–T029): the fold converges and is loud — M2 unblocks here. Then US2 (compliance story), US3 (two-writer), Polish. Every checkpoint leaves the suite green and gates passing; commit per task or logical group with `[T0NN]` prefixes per F01 house style.
