---
description: "Tasks — mesh-m5-criteria-affordability (M5)"
---
# Tasks: mesh-m5-criteria-affordability

Additive under src/crm/criteria, src/crm/affordability, src/crm/agents, src/crm/ui, src/crm/fixtures, src/crm/agentContracts (additive decoders + FirmConfig fields), src/crm/fold (additive entry kinds), test/unit/crm, scripts, docs. M1-M4 contracts frozen. Branch feature/mesh-m5-criteria-affordability from lendmind-crm; PR to lendmind-crm. Number path PURE/deterministic, integer-pence. Depends on M3 + M4 merged. Synthetic data only.

## P1 — criteria pack + rule engine + provenance spine

- [ ] T001 Baseline gates green (record) — vitest baseline, lint, license, i18n ×11 (SC-005)
- [ ] T002 M5 contracts frozen under specs/006/contracts/*.d.ts (RuleKey/RuleOp enums, packRef pin, assertIndicative 5 reasons) + m5ContractFreeze.test.ts (FR-001, SC-005)
- [ ] T003 CriteriaPack model + decodeCriteriaPack (rejects unknown key/op, missing citedText/asAt) + FirmConfig additive criteriaPack/criteriaTtlDays/scenarioCap (FR-001)
- [ ] T004 [P] Synthetic 12-lender fixture pack (hand-tuned: ≥1 each pass/refer/fail incl. a syn-input-forced refer) (FR-016)
- [ ] T005 Pure assessCriteria: one result per FirmConfig.lenderPanel member; fail/refer carries ≥1 reason {ruleKey,citedText,inputValue,inputProvenance,delta}; syn/missing→refer(named); no-rules lender→refer/"not assessed" (FR-002/003)
- [ ] T006 Stale-rule degradation: rule asAt past criteriaTtlDays → verdict refer + reason.stale=true (FR-004)
- [ ] T007 decodeCriteriaAssessment invariant: exactly one result per panel member; fail/refer ⇒ ≥1 reason (FR-002)
- [ ] T008 assertIndicative choke-point (client-surface|not-indicative|g9-unverified|wrong-surface|stale-product) in the writer/fold; surfaceClass:'adviser-only' tag (FR-007/008)
- [ ] T009 no-client-embed CI test: no client-facing component decodes/embeds a criteria assessment (view + comms paths) (FR-008)
- [ ] T010 Copy/lint gate scripts/check-indicative-copy.mjs: reject "eligible"/"guaranteed"/"whole of market" in M5 surfaces (FR-015)
- [ ] T011 [P] Tests: assessCriteria golden vectors (each verdict + syn refer + stale refer + no-rules refer); decoder rejects malformed; assertIndicative per-branch; copy gate (SC-001/003)

## P2 — affordability & stress calculator (A6) — MVP seam ends here

- [ ] T012 Pure computeAffordability: integer-pence, no float; max-borrow + monthly at rate + at stress; documented rounding rule recorded in working[]; clamp ≥0 never NaN (FR-005)
- [ ] T013 AffordabilityAssessment writer: indicative:true, per-input provenance (det/syn + M3 quote-locator on det), full working; decodeAffordabilityAssessment (FR-005)
- [ ] T014 G9 income-verified precondition: block a run when income not det-verified; surface names blocking step + action; criteria grid still renders (FR-006)
- [ ] T015 assertIndicative extended for A6: refuse any client-view + client-comms artifact embed pre-G5; refuse stale-product (M4 snapshot failing assertClaimable) (FR-007)
- [ ] T016 [P] Tests: affordability golden vectors incl. rounding-boundary + cross-platform-identical; negative/zero delta clamped; G9 block; no-client-embed A6 (view + comms) (SC-002)

## P3 — counterfactuals + scenario runs

- [ ] T017 Pure applyDelta (deposit/LTV, term, income mix, rate, product; base not mutated) + diffScenarios (lender flips + max/monthly deltas) (FR-009)
- [ ] T018 scenarioDerivedId = pure fn of (packRef, caseFactsHash, deltaHash); packRef content-hash pin; assessment records exact pack version (FR-011)
- [ ] T019 4 additive fold entry kinds (criteria-assessment, affordability-assessment, scenario-run, criteria-override) with origin.artifactId in caseLogFold.ts (FR-012)
- [ ] T020 scenario.ts agent: dispatched via lm.directive/1 on G9-verified case; runs base + N counterfactuals (cap ≤ scenarioCap, enforced before write); writes lm.scenario.run/1 folded summary + full-working attachment (never inline); stamps adviser id (FR-010)
- [ ] T021 decodeScenarioRunPayload (require summary/attachment/surfaceClass; cap respected) (FR-010)
- [ ] T022 [P] Tests: counterfactual diff correctness; idempotent id (same inputs → same id + outputs); cap enforced; m5Converge.test.ts (kill-the-laptop with 4 new entry kinds, hash-chain intact) (SC-004/005)

## P4 — scenario surface + G6 override + G5 handoff

- [ ] T023 ScenarioBoard.tsx on the M2 surface: per-lender grid with INLINE why-not (rule+delta, keyboard-reachable) + cited text/as-at drawer; persistent indicative + adviser-only chrome band + pinned honesty line (FR-015)
- [ ] T024 Affordability panel: indicative max/monthly + full-working drawer; det/syn per-cell dot (quote-locator on det) + board-level "N inputs synthetic" summary (no word "provenance" in UI) (FR-015)
- [ ] T025 Side-by-side scenario comparison (≤4 visible) highlighting lender flips + max/monthly deltas; G9-blocked + stale-pack + no-sourcing states; "0 indicative passes" closest-miss-first (FR-015)
- [ ] T026 G6 criteria override: confirm step (shows original verdict) + forced one-line rationale + plain "raises a compliance flag" copy; raises G6; folds criteria-override (original verdict + adviser id + rationale + flag); stale-rule override notes staleness (FR-013)
- [ ] T027 Gated pack editor (minimal): pack authorship/edits gated + folded (who edited which rule, when); synthetic seed loads (FR-014)
- [ ] T028 [P] Tests: board adviser-only (no client render path); inline why-not keyboard-reachable; det/syn dots dark-mode contrast; G6 override folds original verdict; pack-edit folds authorship (SC-006)
- [ ] T029 docs/dpia-mesh-m5.md (A6/criteria inputs, retention SYSC 9/MCOB 4.7A.19R, adviser-only boundary, Art 35) (FR-016)
- [ ] T030 Eval corpus (synthetic known-answer): why-not completeness (every excluded lender has a reason) + indicative-label presence on every A6 output (FR-016, SC-001)
- [ ] T031 demo-mesh-m5.mjs (eliminate-with-reasons → counterfactual → side-by-side on the synthetic pack, <5 min zero-setup) + full gate run + PR into lendmind-crm w/ per-FR checklist (SC-005/007)

## Deps

P1 blocks all (contracts + assessCriteria + assertIndicative + surfaceClass are foundational). P2 after T002/T008 (needs contracts + the choke-point). P3 after T005/T012 (needs both engines) + T002. P4 after P3 (needs scenario runs for the board) + T012 (affordability panel). The MVP seam is end-of-P2 (criteria + affordability on a base scenario). Licensed criteria DB, client-facing affordability, DIP write-back excluded (out of scope / G8).

## MVP

P1+P2 (criteria why-not per excluded lender + indicative affordability with full working, adviser-only, assertIndicative enforced) = the metric-moving slice; counterfactuals/scenarios (P3) + the board/override (P4) complete the milestone.
