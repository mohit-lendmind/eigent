# Feature Specification: mesh-m5-criteria-affordability

**Feature Branch**: `feature/mesh-m5-criteria-affordability` (from `lendmind-crm`) · **Created**: 2026-08-23 · **Status**: Ready for planning
**Input**: brief `.lm-flow/personas/mesh-m5-criteria-affordability/brief.txt`; architecture `.lm-flow/architecture/mesh-m5-criteria-affordability.md`; synthesis `.lm-flow/personas/mesh-m5-criteria-affordability/synthesis.md`; spec v2 §§0(inv 6),4-A5,4-A6,5(G5/G6/G9),8.6; roadmap line 148. Builds on **M3 merged** (det-verified fact-find income/affordability + G9) + **M4 merged** (`lm.sourcing.snapshot/1`, `assertClaimable`). Authored directly against `.specify/templates` (headless `/speckit-specify` unavailable — see `.lm-flow/personas/mesh-m5-criteria-affordability/speckit-specify-run.log`), as M1–M4 were.

M5 is the **reasoning core**: A5 criteria-pack matching + A6 affordability/stress + counterfactuals + scenario runs. It turns M3's det-verified facts and M4's sourcing snapshots into an **adviser-only, indicative** decision surface — per panel lender an indicative pass/refer/fail with a **why-not for every excluded lender**, plus an indicative affordability/stress result with **full working in an artifact**, then **counterfactuals** and **side-by-side scenarios**. Every number is computed by a **pure deterministic engine** (LLM-free). The **recommendation is never M5's** — it stays a human G5 act. **Honesty is the deliverable:** nothing is a lender decision or a guaranteed max; a single `assertIndicative()` choke-point keeps A6 off every client surface and comms artifact pre-recommendation.

## User Scenarios & Testing

### User Story 1 — Eliminate the panel, with a reason for each (P1)
**Why**: replaces the adviser's manual portal-by-portal criteria research — the metric-moving core; the "watch it eliminate 10 of 15 lenders with a cited reason each" demo.
**Independent test**: run criteria on a G9-verified fixture case against the synthetic 12-lender panel; observe a verdict for every lender + a why-not for every excluded lender + cited text in the drawer.
**Acceptance**:
1. Given a case with income det-verified (G9) and a firm criteria pack, When criteria matching is dispatched, Then a deterministic engine emits an `lm.criteria.assessment/1` with **exactly one result per `FirmConfig.lenderPanel` member**, each `pass | refer | fail`.
2. Given any `fail`/`refer` result, Then it carries ≥1 reason `{ ruleKey, citedText, inputValue, inputProvenance(det|syn), delta }` — a decoder invariant + eval make omission impossible; the why-not is inline (rule + numeric delta), keyboard-reachable, with cited text + as-at in the drawer.
3. Given a rule whose required input is `syn`/absent, Then the verdict is `refer` (input named) — never a silent `pass`/`fail`; a panel lender with no authored rules renders `refer`/"not assessed" (MCOB 4.4A.1R scope), never a silent exclusion.
4. Given a pack rule older than firm policy (`asAt` past TTL), Then the verdict degrades to `refer` **and** a staleness banner shows; the per-rule as-at is in the drawer.

### User Story 2 — Indicative affordability, adviser-only, full working (P1)
**Why**: gives borrowing headroom with a defensible working, without the number ever reaching the client pre-recommendation (MCOB 11.6.2R; spec §8.6).
**Independent test**: run affordability on a G9-verified case; confirm indicative max/monthly + full working + the structural client-surface refusal.
**Acceptance**:
1. Given a G9-verified case, When affordability is computed, Then an `lm.affordability.assessment/1` is written `indicative:true` with the max borrow + monthly at product rate and at stress, **full working** (every input, factor, step), and **per-input provenance** (det/syn, quote-locator on det).
2. Given income is not det-verified, Then the run is blocked by G9 and the surface names the blocking step + action ("Verify income on the fact-find to run affordability"); the criteria grid still renders (criteria does not need G9).
3. Given any A6 payload, Then `assertIndicative` refuses its embed into **any client view or client-comms artifact pre-G5** (typed reason `client-surface`), enforced in the writer/fold; a CI test proves no client-facing component can decode/embed `lm.affordability.assessment/1` (both view + comms paths).
4. All money is **integer pence, no float**; the rounding rule is documented and recorded in `working[]`; golden vectors are pence-exact and identical cross-platform; a negative/zero max-borrow is clamped + labelled, never NaN.

### User Story 3 — Counterfactuals & side-by-side scenarios (P2)
**Why**: the closing demo — "what if they put £10k more down / take a longer term" — computed, not guessed; the wedge over calculator-only tools.
**Independent test**: apply a delta to a base scenario; compare scenarios; confirm the diff, the id idempotency, and the fold shape.
**Acceptance**:
1. Given a base scenario, When a typed delta (deposit/LTV, term, income mix, rate, product) is applied, Then the engine re-runs criteria + affordability and returns a diff highlighting lender flips (pass↔fail) and indicative max/monthly deltas.
2. Given a scenario set, Then up to 4 scenarios compare side-by-side (firm-config cap ≤8/run, enforced before write); the set folds as an `lm.scenario.run/1` **summary** with the full working as a **referenced attachment** (never inline).
3. Given the same `(pack, caseFacts, delta)`, Then the artifact + fold-entry ids are **identical** (pure functions of `(packRef, caseFactsHash, deltaHash)`); re-dispatch does not double-write; re-fold yields byte-identical derived state.
4. Given a scenario product sourced from an M4 snapshot that no longer passes `assertClaimable`, Then `assertIndicative` refuses it (`stale-product`).

### User Story 4 — Criteria override, audited (P2)
**Why**: real firms have documented policy exceptions; an override must be auditable, not silent (G6).
**Independent test**: override a `refer→pass` verdict; confirm the gate, the confirm step, and the fold.
**Acceptance**:
1. Given an adviser overriding a per-lender verdict, When they commit, Then a confirm step shows the original verdict, forces a one-line rationale, and states in plain copy that this raises a compliance flag — before commit.
2. Given a committed override, Then it raises **G6** (adviser-only, compliance-flagged) and folds `criteria-override` with the original verdict + adviser id + rationale + flag; nothing auto-applies; a stale-rule override notes staleness.
3. Given pack authorship/edits, Then who edited which rule and when is itself gated + folded (provenance does not stop at `sourceRef`).

### Edge Cases
- Every panel lender fails/refers → the grid reads "0 indicative passes" with the closest-miss ranked first, never "no results".
- Two advisers assess the same case concurrently → first-wins on the derived id; no collision.
- Override then the underlying fact changes so the verdict would flip anyway → the G6 flag is surfaced (stays / re-raises), not silently dropped.
- SAR for one case's full working after the pack was superseded → the assessment's pinned `packRef` resolves to the exact as-at version.
- Adviser screenshots the board into an email → out of software scope; covered by firm export policy (the artifact can't follow); the no-client-embed control covers the software path.

## User Journeys
*(The three P1/P2 journeys, drivable by validate-feature. Journeys 1–2 run on a G9-verified fixture case + the synthetic 12-lender pack; Journey 3 runs on counterfactual deltas over that base.)*

### Journey 1 — Eliminate the panel, with a reason for each
**As an** adviser **I want to** run criteria matching on a fact-find-complete case **so that** I see, per panel lender, an indicative pass/refer/fail with a defensible why-not — replacing manual portal-by-portal research.
**Steps:** (1) open a G9-verified case on the M2 surface; (2) trigger the criteria assessment; (3) read the per-lender grid — verdict for every panel lender; (4) read the inline why-not per excluded lender (rule + numeric delta), open the drawer for cited text + as-at; (5) override a verdict via G6 where a policy exception applies.
**Success criteria:** every panel lender has a verdict; every excluded lender shows a keyboard-reachable why-not with cited text + as-at; a syn/missing or stale input yields `refer` (named/bannered), never a silent verdict; a G6 override folds the original verdict + adviser id + rationale + compliance flag.

### Journey 2 — Indicative affordability, adviser-only, full working
**As an** adviser **I want to** compute indicative affordability and stress **so that** I can gauge borrowing headroom with a defensible working — without the number reaching the client pre-recommendation.
**Steps:** (1) on a G9-verified case, run affordability; (2) read indicative max + monthly at rate and at stress under the persistent indicative treatment; (3) open the full-working drawer (inputs, det/syn dots, stress rate, steps); (4) attempt to surface it client-side → structurally refused.
**Success criteria:** output carries indicative label + full working + per-input provenance; pence-exact cross-platform; `assertIndicative` blocks on G9-unverified and on any client view/comms embed (CI-proven both paths); negative/zero max clamped, never NaN.

### Journey 3 — Counterfactuals & side-by-side scenarios
**As an** adviser **I want to** vary an input and compare scenarios side by side **so that** I can show the path to a better outcome — computed, not guessed.
**Steps:** (1) apply a typed delta to a base scenario; (2) the engine re-runs criteria + affordability (idempotent id from the delta hash); (3) compare up to 4 scenarios (cap ≤8/run) — the diff highlights lender flips + max/monthly deltas; (4) the set folds as a summary + referenced attachment.
**Success criteria:** a delta re-runs both engines and returns a correct diff; each scenario pins its own `packRef`; identical `(pack, caseFacts, delta)` → identical id + outputs; convergence holds with scenario entries; the set never exceeds the cap.

## Requirements

### Functional
- **FR-001**: A `CriteriaPack` MUST be modelled as an `lm.criteria.pack/1` artifact — per panel lender, typed rules `{ key, op, value, citedText, sourceRef, asAt }` — loaded via `FirmConfig.criteriaPack` (additive, optional; defaults to the synthetic fixture in dev). v1 rule vocabulary is a **closed `RuleKey` enum**: `maxLTV | minIncome | maxLTI | adverseCreditPolicy | employmentType | minTermYears | maxTermYears | propertyType`; a **closed `RuleOp` enum**: `lte | gte | eq | in | policy`. A licensed criteria DB is **out of scope**.
- **FR-002**: `assessCriteria(pack, caseFacts)` MUST be **pure/deterministic** (no browser/login/model) and emit `lm.criteria.assessment/1` whose `results` contain **exactly one entry per `FirmConfig.lenderPanel` member**; a `fail`/`refer` MUST carry ≥1 reason `{ ruleKey, citedText, inputValue, inputProvenance, delta }`. A decoder invariant + eval enforce completeness.
- **FR-003**: A rule whose required input is `syn`/absent MUST yield `refer` (input named), never a silent `pass`/`fail`. A panel lender with no authored rules MUST render `refer`/"not assessed" (MCOB 4.4A.1R), never a silent exclusion.
- **FR-004**: A rule with `asAt` older than the firm-config TTL MUST **degrade its verdict to `refer`** and surface a staleness banner; the per-rule as-at MUST be retained in the artifact.
- **FR-005**: `computeAffordability(inputs)` MUST be **pure/deterministic** and emit `lm.affordability.assessment/1` `indicative:true` with max-borrow + monthly at product rate and at stress, the **full working** (every input, factor, step), and **per-input provenance** (`det`/`syn`, quote-locator on det). **All money is integer pence, no float**; the rounding rule is documented and recorded in `working[]`.
- **FR-006**: **G9 income-verified MUST be a precondition** for any affordability run; when not met, the run is blocked and the surface names the blocking step + action; the criteria grid still renders.
- **FR-007**: A single **`assertIndicative(payload)`** choke-point MUST gate every criteria/affordability surface + export, returning a typed reason `client-surface | not-indicative | g9-unverified | wrong-surface | stale-product`. It MUST refuse embedding A6/criteria figures into **any client view OR client-comms artifact pre-G5** (spec §8.6 / invariant 6), and refuse an A6 payload whose product came from an M4 snapshot that no longer passes `assertClaimable`. Enforced in the writer/fold, not UI hiding; test-covered per branch.
- **FR-008**: A CI test MUST prove **no client-facing component can decode or embed `lm.affordability.assessment/1`** (both client-view and client-comms paths); every A6/criteria payload MUST carry `surfaceClass:'adviser-only'`.
- **FR-009**: `applyDelta(base, delta)` + `diffScenarios(a, b)` MUST be pure; a typed delta covers deposit/LTV, term, income mix, rate, product; the diff MUST report lender flips (pass↔fail) and indicative max/monthly deltas. The base MUST NOT be mutated.
- **FR-010**: The `scenario.ts` agent MUST be dispatched via `lm.directive/1`, run base + N counterfactuals (firm-config cap ≤8/run, enforced before write), write `lm.scenario.run/1` as a **folded summary** with the full working as a **referenced attachment** (never inline), and stamp the acting adviser id. Adviser-facing only.
- **FR-011**: Artifact + fold-entry **ids MUST be pure functions of `(packRef, caseFactsHash, deltaHash)`** (mirroring M3 `derivedId`); `packRef` MUST be a **content-hashed immutable pin**; an assessment MUST record the exact pack version (never "latest") and a superseded pack MUST still resolve for a SAR.
- **FR-012**: New **fold entry kinds** (`criteria-assessment`, `affordability-assessment`, `scenario-run`, `criteria-override`) MUST be added additively with `origin.artifactId`; the M1 **kill-the-laptop convergence + hash-chain MUST hold** over the new kinds (a convergence test is mandatory).
- **FR-013**: A **criteria override** MUST route **G6** (adviser-only, compliance-flagged): a confirm step showing the original verdict, a forced one-line rationale, plain "raises a compliance flag" copy before commit; it MUST fold the original verdict + adviser id + rationale + flag; a stale-rule override MUST note staleness. Nothing auto-applies. **The recommendation stays a human G5 act — M5 MUST NOT recommend.**
- **FR-014**: Pack authorship/edits MUST be gated + folded (who edited which rule, when); a minimal gated pack editor + the synthetic seed ship. A full authoring UI, SSO/RBAC, and retention UI are out of scope (enterprise-readiness rides the M2 surface + fold audit; retention posture documented per SYSC 9 / MCOB 4.7A.19R).
- **FR-015**: `ScenarioBoard.tsx` on the M2 surface MUST render: the per-lender criteria grid with **inline** why-not (never hover-only, keyboard-reachable; cited text + as-at in a drawer), the affordability indicative result + full-working drawer, det/syn as a **per-cell dot + a board-level "N inputs synthetic" summary** (the word "provenance" never in the UI), and **side-by-side scenarios** (≤4 visible) highlighting flips + deltas — under a **persistent** indicative + adviser-only treatment (pinned honesty line + non-dismissible chrome band). Copy MUST NOT read "eligible"/"guaranteed"/"whole of market" (a copy/lint gate).
- **FR-016**: Build + verify with **synthetic data only** — a 12-lender fixture pack hand-tuned to produce each verdict (incl. a syn-forced `refer`); a synthetic known-answer eval corpus (≈30% budget) asserting **why-not completeness** (every excluded panel lender has a reason) + **indicative-label presence** on every A6 output; contract freeze under `specs/006-mesh-m5-criteria-affordability/contracts/` with `m5ContractFreeze.test.ts`; a **DPIA** before ship (UK GDPR Art 35); all CI gates green; dark-mode contrast verified (det/syn dots + pass/refer/fail states).

### Key Entities
CriteriaPack (typed rules + citedText + sourceRef + asAt, content-hashed packRef), CriteriaAssessment (one result per panel lender; reasons with provenance), AffordabilityAssessment (indicative, full working, per-input provenance, integer pence), counterfactual delta + ScenarioDiff, ScenarioRun (folded summary + attachment), `assertIndicative` choke-point, G6 criteria override, ScenarioBoard (adviser-only).

## Success Criteria
- **SC-001**: A criteria run against the 12-lender panel yields a verdict for every lender and a why-not for **every** excluded lender (rule + delta + cited text + as-at) — structurally guaranteed by the decoder invariant + eval.
- **SC-002**: Affordability output is indicative, pence-exact (cross-platform golden vectors), carries full working + per-input provenance, and is blocked from every client view + client-comms artifact pre-G5 (CI, both paths) and when income is not det-verified (G9).
- **SC-003**: `assertIndicative` returns each typed reason with a test per branch (`client-surface | not-indicative | g9-unverified | wrong-surface | stale-product`).
- **SC-004**: A counterfactual re-runs both engines and returns a correct diff; identical `(pack, caseFacts, delta)` → identical id + outputs; scenario sets respect the cap and fold as summary + attachment.
- **SC-005**: Kill-the-laptop convergence + hash-chain hold with the four new fold entry kinds; the M5 contract-freeze test passes; every gate green; dark-mode verified.
- **SC-006**: A G6 override folds the original verdict + adviser id + rationale + compliance flag; pack edits are gated + folded; the recommendation remains a human G5 action.
- **SC-007** (product): median adviser-minutes-saved on criteria+affordability research per case vs a week-0 baseline across the 5 design-partner firms; ≥95% of excluded panel lenders carry a usable why-not. **Rollback signal**: any adviser-reported false pass/fail on a real case, or advisers bypassing the board back to portals in >30% of cases at 2 weeks.

## Assumptions
- Depends on **M3 + M4 merged** (roadmap line 148): M3 supplies det-verified income/affordability inputs + G9; M4 supplies sourcing snapshots (product terms, `assertClaimable`). M5 is usable before a sourcing run — scenarios accept manual product terms too.
- v1 criteria pack = **adviser-curated synthetic/pluggable** artifact; a licensed DB is later. Each design-partner firm supplies its 10–15 lender panel + curated criteria text (a time-boxed pack-authoring session, day-1 of trial); a pre-loaded synthetic pack lets a prospect demo with zero setup.
- Default stress rate is a firm-config value, overridable per scenario, recorded in the working (MCOB 11.6.18 context).
- Synthetic data only; real PII / real lender-criteria DB gated on founder input.
- Build on Opus 4.8; the pre-merge review runs on Fable 5 @ xhigh.

## Tradeoff Resolutions
MVP seam at Phase 2 (criteria + affordability on a base scenario) with counterfactuals/scenarios kept in-milestone per roadmap (PM vs Sales); stale pack degrades to `refer` **and** banners (Compliance vs UX); det/syn recorded fully in artifact but shown as a dot + board summary (Compliance/Architect vs UX); one persistent indicative treatment, not repeated micro-labels (UX vs Compliance); `assertIndicative` refuses client-comms artifacts + stale M4 products, not just client views (Compliance/Architect); ids pinned to `(packRef, caseFactsHash, deltaHash)` + integer-pence-only arithmetic (Architect/Engineer); closed RuleKey/RuleOp enum + firm-config default stress rate resolved now (Engineer blockers). (Dissent record below; source files: `.lm-flow/personas/mesh-m5-criteria-affordability/`.)

---

## Appendix: Persona dissent record

This spec was generated from a six-seat multi-persona synthesis. Disagreements the spec resolves are recorded here for review.

| # | Seat | Position (Dissent:) | Resolution |
|---|---|---|---|
| 1 | UX | "indicative" per-figure labels banner-blind advisers | FR-015 (one persistent treatment: pinned line + chrome band) |
| 2 | UX | per-input det/syn provenance clutters the grid | FR-015 (per-cell dot + board-level summary; "provenance" never in UI) |
| 3 | UX | why-not on hover fails keyboard/touch + is undiscoverable | FR-002/015 (inline visible why-not; cited text in drawer) |
| 4 | UX | G6 override "a button" is under-specified | FR-013 (confirm step + forced rationale + plain flag copy pre-commit) |
| 5 | Architect | derived ids not pinned → re-run double-writes | FR-011 (ids = pure fn of packRef, caseFactsHash, deltaHash) |
| 6 | Architect, Engineer | "pure" asserted not enforced; float drift | FR-005 (integer pence, no float; documented rounding in working[]) |
| 7 | Architect | M4 coupling "optional" but stale product leaks | FR-007 (assertIndicative stale-product reason) |
| 8 | Architect | pack must be a content-hashed immutable pin | FR-011 (packRef pinned; superseded resolves for SAR) |
| 9 | Architect | assertIndicative needs a typed failure enum | FR-007 (5 typed reasons, test per branch) |
| 10 | Engineer | "why-not for EVERY lender" not structurally forced | FR-002 (one result per panel member; ≥1 reason; decoder invariant + eval) |
| 11 | Engineer | RuleKey/RuleOp enum + default stress rate are build blockers | FR-001 (closed enums); Assumptions (firm-config stress rate) |
| 12 | Engineer | need a synthetic 12-lender fixture covering each verdict | FR-016 |
| 13 | PM | defer Phase 3 counterfactuals out of v1 | Tradeoff Resolutions (MVP seam at Phase 2; counterfactuals stay in-milestone per roadmap) |
| 14 | PM | no success metric / rollback signal | SC-007 |
| 15 | PM, Compliance | pack staleness surfaced but not owned | FR-004 (refer degradation); FR-014 (authorship gated); Assumptions (firm owner + TTL) |
| 16 | Sales | enterprise-readiness (SSO/RBAC/retention) silently absent | FR-014 (documented + deferred, not silent) |
| 17 | Sales | pack authoring is a trial blocker | FR-016 + Assumptions (pre-loaded synthetic seed; day-1 authoring) |
| 18 | Sales, Compliance | overclaim risk ("eligible"/"whole of market") | FR-015 (copy/lint gate); FR-003 (scope disclosure) |
| 19 | Compliance | assertIndicative must cover client-comms artifacts, not just views | FR-007/008 (both paths) |
| 20 | Compliance | stale pack must degrade to refer, not just banner | FR-004 |
| 21 | Compliance | pack authorship must be gated + folded | FR-014 |
| 22 | Compliance | no DPIA posture | FR-016 (DPIA before ship, Art 35); Assumptions |

Source files:
- Architecture: `.lm-flow/architecture/mesh-m5-criteria-affordability.md`
- Personas: `.lm-flow/personas/mesh-m5-criteria-affordability/*.md`
- Synthesis: `.lm-flow/personas/mesh-m5-criteria-affordability/synthesis.md`
- /speckit-specify log (deviation note): `.lm-flow/personas/mesh-m5-criteria-affordability/speckit-specify-run.log`
