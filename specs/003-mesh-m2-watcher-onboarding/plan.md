# Implementation Plan: mesh-m2-watcher-onboarding

**Branch**: `lendmind-crm` (impl on `feature/mesh-m2-watcher-onboarding`) | **Date**: 2026-08-22 | **Spec**: [spec.md](spec.md)

**Input**: spec.md; authoritative architecture `.lm-flow/architecture/mesh-m2-watcher-onboarding.md` (transcribe + elaborate, don't re-derive). Builds on merged M1.

## Summary
Two agents + the first UI. Three strands: (1) invocation plumbing in `src/crm/agents/` (dispatch as an artifact-carried directive, case/coordinator project binding, static-stamped FX budget + breaker, direct skill deploy, and a proven edge-reads-index path); (2) A1 onboarding + A2 watcher (firm coordinator project + ~5-min schedule, desktop-published per-case pointer index, pre-LLM fast path, dispatch-ready propose-only decisions, ≥2 real triggers); (3) the `/crm` thin surface (Today needs-you queue, fold-sourced with one live gate subscription, bespoke GateCard from GATE_REGISTRY, CRM tones, crm i18n, storybook). No new deps; `src/api/aion/v1/**` and M1 frozen contracts stay frozen.

## Technical Context
**Language**: TypeScript 5.x (tsconfig.build gate). **Deps**: none added — zustand v5, WebCrypto, the aion v1 client (read-only), M1 `src/crm/{agentContracts,fold}`, the HomeHub kit, ProjectPageSidebar/NavTab, ApprovalCard, Tag/Button/card primitives, sonner, react-i18next. **Storage**: reuse M1 `eventLogStore`; new firm-index + coordinator-project ids in firm config artifact. **Testing**: vitest (jsdom); colocated + `test/unit/crm/`; storybook a11y; `e2e/*.eval.ts` for the two skills. **Platform**: Electron renderer + web. **Perf**: watcher fast-path skips unchanged; queue renders from persisted selectors (no socket-per-case). **Constraints**: attachments no Idempotency-Key (CAS dedupe); schedule create needs Idempotency-Key; cron 5-field; skill PUT If-Match; i18n parity 11 locales; vitest baseline unmoved.

## Constitution Check
`.specify/memory/constitution.md` is the unfilled template — no ratified constitution. Gates applied: no-new-deps ✓ · aion-client + M1 contracts frozen ✓ · store-layering lint (agents/ui downstream) ✓ · design-token + i18n-parity + baseline ✓. No violations; Complexity Tracking empty.

## Project Structure
```
src/crm/agents/       dispatch.ts · caseProject.ts · budget.ts · skillDeploy.ts · onboarding.ts · watcher.ts · firmIndex.ts
src/crm/ui/           CrmLayout.tsx · TacticalRail.tsx · TodayQueue.tsx · GateCard.tsx · queueModel.ts · tones.ts · primitives/*
resources/lm-skills/  lm-onboarding/SKILL.md · lm-watcher/SKILL.md (+ reference bodies)
src/routers/index.tsx (MODIFIED: /crm route) · src/i18n/locales/*/crm.json (11) + index (MODIFIED)
src/crm/agentContracts/ (MODIFIED barrel only — new firmIndex + watcher-decision-payload types live here, additive)
test/unit/crm/        dispatch · budget · firmIndex · watcherPass · onboarding · queueModel · gateCard · convergence-with-agents
e2e/                  lm-onboarding.eval.ts · lm-watcher.eval.ts
scripts/demo-mesh-m2.mjs · docs/compliance-one-pager.md
specs/003-*/contracts/*.d.ts (frozen)
```
**Structure Decision**: single-project renderer; agents + UI under `src/crm/`; skills under `resources/lm-skills/`; invariant tests under `test/unit/crm/`.

## Phase ordering (from architecture, elaborated)
- **P1 Invocation plumbing** (FR-001..006): dispatch, caseProject, budget/FX, skillDeploy, firmIndex publish + the proven edge-read-index path. No UI, no agent logic. Gate: a fixture directive round-trips to a folded `lm/case` entry; edge-reads-index proven.
- **P2 Agents** (FR-007..014): A1 onboarding (+G1), A2 watcher (schedule + fast path + dispatch-ready decisions + 2 triggers + supervision). Gate: US1 + US2 scenarios; kill-the-laptop still converges with agent writes.
- **P3 Thin surface** (FR-015..020): /crm route + shell + rail + Today queue (fold-sourced, one live sub) + GateCard + tones + i18n + stories. Gate: US3 scenarios; design-token/i18n/a11y green.
- **P4 Polish** (FR-021..023): freeze .d.ts, demo case + compliance one-pager + metrics, full gate run, PR.

## Complexity Tracking
None.
