---
description: "Tasks — mesh-m4-connectors (M4)"
---
# Tasks: mesh-m4-connectors
Additive under src/crm/connectors, src/crm/agents, src/crm/ui, resources/lm-skills/lm-sourcing, test/unit/crm, e2e; named mods: src/crm/agentContracts (additive sourcing payload types), the M2 thin surface for the results tab, FirmConfig.adapters (verified). aion client + M1/M2 contracts frozen. Branch feature/mesh-m4-connectors from lendmind-crm; PR to lendmind-crm. MSE verified for real; licensed=verified:false scaffold.

## P1 — framework + harness + guardrails
- [ ] T001 Baseline gates green (record)
- [ ] T002 SourcingAdapter interface + registry (carries derived `verified`) per contracts (FR-001)
- [ ] T003 Record/replay harness: capture tool_result SSE {tool,args,result}; pure extract() in vitest (FR-003)
- [ ] T004 Snapshot writer: folded-summary case-log entry + full-set attachment (never inline) (FR-004)
- [ ] T005 Dedicated sourcing-snapshot payload decoder (require coverage/ratesAsAt/products/verified) (FR-005)
- [ ] T006 Derived `verified` from VerificationRef + `assertClaimable(snapshot)` choke-point in the writer/fold (FR-006)
- [ ] T007 Coverage typed enum + wholeOfMarket bool + lint gate rejecting the literal phrase unless flag true (FR-008)
- [ ] T008 surfaceClass:"adviser-only" tag + CI test: no client-facing component can decode/embed a sourcing snapshot (FR-007)
- [ ] T009 Local sourcing serialized per desktop; stamp adviser id on every automated action (FR-010)
- [ ] T010 [P] Tests: payload decoder rejects missing fields; assertClaimable blocks unverified/evidence-less; coverage lint gate; no-client-embed

## P2 — MSE adapter (verified)
- [ ] T011 adapters/mse.ts: isolated, console-fetch JSON, buildQuery plan + pure extract; coverage "MSE Best Buys (Podium) — not whole of market" (FR-002)
- [ ] T012 e2e/connector-mse.eval.ts live canary (nightly) + recorded replay fixture (scrubbed) verifying extract in CI (FR-003)
- [ ] T013 [P] Tests: MSE replay green; verified derived true only with a passing canary+evidence

## P3 — Mortgage Brain scaffold (verified:false)
- [ ] T014 adapters/mortgageBrain.ts: logged-in DOM-scrape plan against fixture DOM; verified:false; coverage=firm-panel (FR-002/009)
- [ ] T015 Authored (red) replay eval + documented "add a real recorded session → green" path; per-portal ToS record placeholder (FR-003/010)
- [ ] T016 [P] Tests: scaffold runs on fixture; verified:false; assertClaimable blocks it from evidence + client surfaces

## P4 — results surface + G5 + evidence
- [ ] T017 sourcing.ts (A4): dispatched on income-det; runs the adapter plan; writes snapshot (FR-001/004)
- [ ] T018 SourcingResults.tsx: adviser-only ranked cards + collapsed why-not + pinned coverage line (info tone) on the M2 surface (FR-011)
- [ ] T019 Run ribbon (narrating) + always-hot non-modal take-control + "Running as you"; verified:false watermark + disabled export (FR-011)
- [ ] T020 G5: disabled until product pick + one-line rationale; staleness warning; choice + rejected-reasons fold (FR-012)
- [ ] T021 exportEvidenceOfResearch gated by assertClaimable (MCOB 4.7A spine) (FR-006)
- [ ] T022 [P] Tests: shortlist adviser-only; watermark+disabled export on scaffold; G5 gating; evidence export refuses non-claimable; dark-mode contrast
- [ ] T023 sourcingConverge.test.ts (kill-the-laptop with sourcing entries) + m4ContractFreeze.test.ts vs specs/005 (FR-014)
- [ ] T024 demo-mesh-m4.mjs (MSE source → snapshot → shortlist → G5) + full gate run + PR into lendmind-crm w/ per-FR checklist (SC-005)

## Deps
P1 blocks all (assertClaimable+decoder+surfaceClass are foundational). P2 after T002/T003/T004/T006. P3 after T002/T003. P4 after P2 (needs a verified adapter for the happy path). writeBack/DIP excluded (G8).
## MVP
P1+P2 (MSE verified, snapshot folds, assertClaimable enforced) = the live computer-use demo; scaffold + full surface follow.
