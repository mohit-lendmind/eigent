---
description: "Task list — mesh-m2-watcher-onboarding (M2)"
---

# Tasks: mesh-m2-watcher-onboarding

**Input**: specs/003-mesh-m2-watcher-onboarding/ (spec, plan, research, data-model, contracts, quickstart).

**Tests**: first-class — the three journeys + the M1-still-converges invariant are pinned by tests; the two skills get recorded evals.

**Organization**: P1 invocation plumbing (blocks all) → P2 agents → P3 thin surface → P4 polish. Additive under `src/crm/agents/`, `src/crm/ui/`, `resources/lm-skills/`, `test/unit/crm/`, plus named modifications (`src/routers/index.tsx`, `src/i18n/locales/*`, `src/crm/agentContracts/index.ts` barrel, `test/setup.ts` if needed, `.storybook/preview.tsx`). `src/api/aion/v1/**` and M1 frozen contracts stay frozen.

**Branch**: `feature/mesh-m2-watcher-onboarding` from `lendmind-crm`; PR back to `lendmind-crm`, never `main`.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup + baseline
- [ ] T001 Capture green baseline on lendmind-crm: `pnpm type-check && pnpm lint && pnpm check:i18n && pnpm check:vitest-baseline` — record for SC-006
- [ ] T002 [P] Create `src/crm/agents/` and `src/crm/ui/` trees + `resources/lm-skills/{lm-onboarding,lm-watcher}/` folders (empty, license-header ready)

## Phase 2: Invocation plumbing (P1 — blocks all stories)
- [ ] T003 Additive `FirmConfig` fields (`fxUsdPerGbpMicro?`, `fxEffectiveDate?`, `coordinatorProjectId?`) + defaults in agentContracts/firmConfig (additive optional; M1 frozen fields untouched); barrel export (FR-004)
- [ ] T004 Author `src/crm/agents/dispatch.ts` per contracts/dispatch.d.ts — publish envelope as application/json artifact (non-`aion-` name), submit referencing it, map command_id↔directiveIdentity; fire-and-forget (FR-001/002)
- [ ] T005 Author `src/crm/agents/caseProject.ts` — ensureCaseProject (writes aionProjectId via M1 outbox case-upsert), firmCoordinatorProject (FR-003)
- [ ] T006 Author `src/crm/agents/budget.ts` — static FX convert (bigint), stamp rate+effectiveDate per SpendRecord, breaker 12/case/hr, realistic pass default (FR-004)
- [ ] T007 Author `src/crm/agents/firmIndex.ts` per contracts/firmIndex.d.ts — publishCasePointer (per-case artifact), readFirmIndex (latest-per-caseId) (FR-010, T3)
- [ ] T008 Author `src/crm/agents/skillDeploy.ts` + `resources/lm-skills/lm-onboarding/SKILL.md` + `lm-watcher/SKILL.md` — deploy via putAionSkill (PascalCase doc) (FR-005)
- [ ] T009 **Proof gate:** `test/unit/crm/edgeReadsIndex.test.ts` — prove an edge run can fetch the firm index artifact + read a case log head (readAionArtifact is desktop-only, so the skill fetches via its own tool); if unprovable, record in blocked.md and stop P2 watcher (FR-006, engineer ship-blocker)
- [ ] T010 [P] Tests: `dispatch.test.ts` (round-trip: envelope→artifact→command→folded lm/case entry), `budget.test.ts` (FX bigint + stamp + breaker), `firmIndex.test.ts` (concurrent pointers don't lose a case)

## Phase 3: US1 — onboarding + G1 (P1 story)
- [ ] T011 [US1] Author `src/crm/agents/onboarding.ts` + the lm-onboarding skill body — build checklist per case type, draft welcome+doc-request with disclosure refs from firm config, write lm/case entries + lm.onboarding.request artifact (FR-007/009)
- [ ] T012 [US1] Wire G1 gate: approval_required on the send; mirror into fold/eventLogStore for the queue (FR-008)
- [ ] T013 [P] [US1] `test/unit/crm/onboarding.test.ts` — Journey 1: checklist built, draft has disclosure, G1 raised, approve logs manual send, fold ingests, chain verifies (SC-001)
- [ ] T014 [P] [US1] `e2e/lm-onboarding.eval.ts` — recorded eval: draft scored for disclosure present + no unapproved product claims

## Phase 4: US2 — watcher (P2 story)
- [ ] T015 [US2] Author `src/crm/agents/watcher.ts` + lm-watcher skill body — coordinator project + `*/5` schedule (Idempotency-Key on create); entry run reads firmIndex + log heads, pre-LLM fast-path skip unchanged (FR-010/011)
- [ ] T016 [US2] Watcher decisions: write dispatch-ready `lm.watcher.decision` (payload per contracts/watcher.d.ts) + worklist items + G7 proposals with passId; propose-only, no live dispatch (FR-012, SC-005 seam)
- [ ] T017 [US2] Real triggers: fixed-rate-end radar (propose remortgage) + stalled-case chase; supervision metrics + SpendRecord per pass (FR-013/014)
- [ ] T018 [P] [US2] `test/unit/crm/watcherPass.test.ts` — Journey 2: fast-path skips unchanged, ≥2 triggers fire, decisions dispatch-ready w/ passId, spend stamped, breaker respected (SC-002)
- [ ] T019 [P] [US2] `test/unit/crm/dispatchSeam.test.ts` — a spike consumes a decision.directive payload and would dispatch — proving M3 is additive (SC-005)
- [ ] T020 [P] [US2] `e2e/lm-watcher.eval.ts` — recorded pass over c417/c392 produces expected decisions

## Phase 5: US3 — thin surface (P2 story)
- [ ] T021 [US3] `src/routers/index.tsx` `/crm` route (sibling to Layout, inside ProtectedRoute) + `src/crm/ui/CrmLayout.tsx` + `TacticalRail.tsx` (from ProjectPageSidebar/NavTab) + a visible nav entry (FR-015)
- [ ] T022 [US3] `src/crm/ui/tones.ts` — CrmTone union + stage ramp (f02 recon), light+dark contrast verified; `primitives/` (PipelineBadge, StatusPill, CompletenessRing) + storybook stories; jetbrains-mono in `.storybook/preview.tsx` if mono used (FR-020)
- [ ] T023 [US3] `src/crm/ui/queueModel.ts` per contracts/queue.d.ts — selectTodayQueue (fold-sourced), gates pinned + SLA→tier→age sort, freshness badge, selectQueueDegraded; mirror approvals into fold (FR-016/017/018)
- [ ] T024 [US3] `src/crm/ui/GateCard.tsx` per contracts/queue.d.ts — render from GATE_REGISTRY (tier/SLA shown, batch inert); G1 card shows full draft + inline edit + provenance; subscribeOpenGate = the ONE live subscription (FR-019, FR-008)
- [ ] T025 [US3] `src/crm/ui/TodayQueue.tsx` — the screen: stat strip, queue rows, empty/loading/all-clear/first-run states, degraded banner, aria-live SLA timers (FR-016/017)
- [ ] T026 [US3] `crm` i18n namespace: `src/i18n/locales/*/crm.json` ×11 + register in each index.ts (FR-020, parity gate)
- [ ] T027 [P] [US3] `test/unit/crm/queueModel.test.ts` — Journey 3: two sources merged, gates pinned+SLA-sorted, one live sub, degraded banner on source fail, all empty states (SC-003)
- [ ] T028 [P] [US3] `test/unit/crm/gateCard.test.ts` — renders from registry alone; G1 shows draft+provenance; approve calls back with edited draft

## Phase 6: Polish
- [ ] T029 `test/unit/crm/convergenceWithAgents.test.ts` — kill-the-laptop converges byte-identical with agent-written entries; export v2 verifies (SC-004)
- [ ] T030 [P] Contract-freeze assignability test `test/unit/crm/m2ContractFreeze.test.ts` vs specs/003/contracts/*.d.ts (FR-021)
- [ ] T031 [P] `scripts/demo-mesh-m2.mjs` (seed→watcher pass→onboarding draft→G1 approve→logged) + `docs/compliance-one-pager.md` + wire leading metrics (FR-022, SC-007)
- [ ] T032 Full gate run: type-check, lint, check:i18n, check:design-tokens, check:vitest-baseline, electron-access, build; dark-mode contrast check; then PR into lendmind-crm with the per-FR checklist (FR-023, SC-006)

## Dependencies
- P1 (T003–T010) blocks all stories; T009 is a hard proof gate for the watcher (T015+).
- US1 (T011–T014) after T004+T005+T012-mirror. US2 (T015–T020) after T007+T009. US3 (T021–T028) after T003 (tones/queue can start early against seeded state; GateCard T024 after T012's mirror).
- US2 and US3 parallel after P1. Polish after all.

## Parallel opportunities
- T010 tests parallel; T013/T014, T018/T019/T020, T027/T028 parallel within their stories; US2 and US3 run in parallel.

## MVP
P1 + US1 + the queue (US3 core) = the installable "open the app, approve the onboarding message" demo. US2 (watcher) and full polish follow.
