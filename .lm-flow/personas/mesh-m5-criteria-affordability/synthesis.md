# Synthesis: mesh-m5-criteria-affordability

Six seats reviewed the architecture: ux-designer, principal-architect, software-engineer, product-manager, head-of-sales, compliance (the 6th seat added because the honesty spine is the milestone's load-bearing constraint, mirroring M4).

## Unanimous requirements
- **Deterministic, LLM-free number path** (assess/calc/counterfactual/diff as pure functions) — every seat treats this as the trust foundation.
- **`assertIndicative()` as a single enforced choke-point in the writer/fold, not UI hiding** — the only defensible way to prove A6 never reaches a client surface; covered by a no-client-embed CI test.
- **Indicative-only framing** — criteria = indicative match vs *cited* criteria text; affordability = indicative label (MCOB 11.6.2R); never a lender decision or a guaranteed max.
- **Why-not for every excluded panel lender**, with the failed rule + numeric delta + cited criteria text.
- **Adviser-only** everywhere; **recommendation stays a human G5 act**; **G9 income-verified is a hard precondition** for affordability.
- **Additive-only** side-car artifacts + fold entry kinds; M1–M4 contracts frozen; convergence (kill-the-laptop) + hash-chain hold with the new kinds; a contract-freeze test.
- **Per-input provenance** (det/syn, with the M3 quote-locator on det) recorded in every artifact so a suitability file / SAR reconstructs from artifacts alone.

## Tradeoffs to be resolved in spec
1. **MVP seam (PM vs Sales).** PM wants Phase 3 counterfactuals/scenarios deferred out of the v1 ship (MVP = Phase 1+2 + a single base scenario, so a metric moves fast). Sales says the **counterfactual side-by-side IS the closing demo** ("what if they put £10k more down") and must be in the milestone. *Resolution:* the roadmap (line 148) binds counterfactuals + scenario runs into M5, so they ship in the milestone — but Phase 1+2 is defined as a **self-contained, independently valuable slice** (criteria + affordability on a single base scenario). Phase 3 adds counterfactuals/scenarios on top without reworking 1+2. Both seats are satisfied: PM gets a clean early-value cut; Sales gets the demo in the same milestone.
2. **Stale pack: `refer` vs banner (Compliance vs UX).** Compliance wants a pack older than firm policy to **degrade the verdict to `refer`** (a stale "pass" is PRIN 2A foreseeable harm). UX wants a **staleness banner**. *Resolution:* **both** — structural degradation to `refer` AND a surfaced staleness banner; an override of a stale rule routes G6 and the flag notes staleness.
3. **Provenance display (UX vs Compliance/Architect).** Compliance/Architect require per-input det/syn recorded; UX warns per-input labels clutter and banner-blind. *Resolution:* recorded fully in the artifact (compliance need met); in the UI shown as a **det/syn dot per cell** (quote-locator on the det dot) + a **board-level "N inputs synthetic" summary** — the word "provenance" never appears in the UI.
4. **Indicative labelling (UX vs Compliance).** Compliance wants indicative unmissable; UX warns repeated micro-labels are ignored. *Resolution:* one **persistent surface-level treatment** (pinned honesty line + non-dismissible adviser-only chrome band, like M4) that every figure inherits — not 40 repeated tags.

## Acceptance criteria (union)
- `CriteriaAssessment.results` contains **exactly one entry per `FirmConfig.lenderPanel` member**; a `fail`/`refer` MUST carry ≥1 reason (decoder invariant + eval) — why-not is structurally impossible to omit.
- All money is **integer pence, no float**; LTI/multiple/stress math uses a **documented rounding rule** recorded in `working[]`; golden vectors include a rounding-boundary case and pass identically cross-platform.
- Artifact + fold-entry **ids are pure functions of `(packRef, caseFactsHash, deltaHash)`** — re-dispatch is idempotent; re-fold yields byte-identical derived state (convergence test over the 4 new kinds).
- **`packRef` is a content-hashed immutable pin**; an assessment records the exact pack version, never "latest"; a superseded pack still resolves for a SAR.
- `assertIndicative` returns a **typed reason** (`client-surface | not-indicative | g9-unverified | wrong-surface | stale-product`), one test per branch; it refuses A6/criteria export into **any client-comms artifact kind pre-G5**, not just client views; it refuses an A6 payload whose product came from a sourcing snapshot that no longer passes M4 `assertClaimable`.
- **No client-facing component can decode/embed `lm.affordability.assessment/1`** (CI test, both view and comms paths).
- A **synthetic 12-lender fixture pack** ships, hand-tuned to produce each verdict (pass/refer/fail) incl. a syn-input-forced `refer`; a new rep can demo eliminate-with-reasons → counterfactual → side-by-side in <5 min with zero setup.
- **G6 override**: confirm step showing original verdict, forced one-line rationale, plain "raises a compliance flag" copy before commit; folds original verdict + adviser id + rationale + compliance flag; a stale-rule override notes staleness.
- **G9-blocked state** names the blocking step and action ("Verify income on the fact-find to run affordability"); the criteria grid still renders (criteria does not need G9).
- Panel lender with **no rules authored** → `refer` ("not assessed"), never a silent pass/exclusion (MCOB 4.4A.1R scope disclosure); copy never reads "eligible"/"guaranteed"/"whole of market" (a copy/lint gate).
- New files carry the Apache license header; no `c-a-m-e-l` letter sequence; `ds-*` tokens only; i18n across 11 locales; vitest baseline green; no new deps; dark-mode contrast verified on det/syn dots + pass/refer/fail states.

## Out of scope (explicit)
- A **licensed criteria DB** (v1 = adviser-curated synthetic/pluggable pack, an artifact — spec §4-A5).
- **DIP/application write-back** (G8, M-late) and any client-facing affordability rendering (spec §8.6).
- **SSO/RBAC and retention UI** — enterprise-readiness is via the M2 surface + fold audit; retention posture is documented (SYSC 9 / MCOB 4.7A.19R) but its UI is deferred (state it, don't build it).
- A full pack-authoring UI beyond a minimal gated editor + the synthetic seed (guided "import top 5" is a fast-follow; the milestone ships the seed + the gate).

## User Journeys (required output for downstream validation)

### Journey 1 — Eliminate the panel, with a reason for each
**As an** adviser **I want to** run criteria matching on a fact-find-complete case **so that** I see, per panel lender, an indicative pass/refer/fail with a defensible why-not — replacing manual portal-by-portal criteria research.

**Steps:**
1. Open a case whose income is det-verified (G9 satisfied) on the M2 surface.
2. Trigger the criteria assessment (dispatched agent, deterministic engine).
3. Read the per-lender grid: pass/refer/fail for **every** panel lender.
4. For each excluded lender, read the inline why-not (failed rule + numeric delta, e.g. "LTI 4.6 vs cap 4.5"); open the drawer for the cited criteria text + as-at.
5. Where a policy exception applies, override a verdict via G6 (confirm + rationale; raises a compliance flag).

**Success criteria:**
- Every panel lender appears with a verdict; every excluded lender shows a machine-readable why-not (rule + delta), keyboard-reachable, with cited text + as-at in the drawer.
- A syn/missing input yields `refer` (named), never a silent pass/fail; a stale-pack rule degrades to `refer` + banner.
- A G6 override folds the original verdict + adviser id + rationale + compliance flag; nothing auto-applies.

### Journey 2 — Indicative affordability, adviser-only, full working
**As an** adviser **I want to** compute indicative affordability and stress for the case **so that** I can gauge borrowing headroom with a defensible full working — without any risk of the number reaching the client before I recommend.

**Steps:**
1. On a G9-verified case, run affordability (deterministic, pence-exact).
2. Read the indicative max borrow + monthly at product rate and at stress, under a persistent indicative treatment.
3. Open the full-working drawer: every input, its det/syn dot, the stress rate, and each computation step.
4. Confirm the output is adviser-only (chrome band); attempt to surface it in a client view/comms → structurally refused.

**Success criteria:**
- Affordability output carries the indicative label + full working + per-input provenance; golden vectors are pence-exact and cross-platform-identical.
- `assertIndicative` blocks the run when income is not det-verified (G9), and blocks any client-view/client-comms embed of the affordability artifact (CI-proven, both paths).
- A negative/zero max-borrow delta is clamped and labelled, never NaN.

### Journey 3 — Counterfactual and side-by-side scenarios
**As an** adviser **I want to** vary an input ("what if +£10k deposit / a longer term / a different income mix") and compare scenarios side by side **so that** I can show a client the path to a better outcome — computed, not guessed.

**Steps:**
1. From a base scenario, apply a typed delta (deposit/LTV, term, income mix, rate, or product).
2. The engine re-runs criteria + affordability on the counterfactual (idempotent id from the delta hash).
3. Compare up to 4 scenarios side by side (cap ≤8/run); the diff highlights lender flips (pass↔fail) and indicative max/monthly deltas.
4. The scenario set folds as a summary; the full working rides as a referenced attachment.

**Success criteria:**
- A delta re-runs both engines and returns a correct diff (which lenders flip, how the indicative max/monthly moves).
- Each scenario pins its own `packRef`; re-running the same `(pack, caseFacts, delta)` yields an identical artifact id and outputs; convergence holds with scenario entries.
- The scenario set never exceeds the firm-config cap; oversize working folds as a summary + attachment.

## Brief for /speckit-specify
Build **mesh-m5-criteria-affordability (M5)** — the reasoning core of the Lendmind mortgage-adviser agent mesh — atop merged M3 (det-verified fact-find income/affordability inputs; G9) and M4 (sourcing snapshots; `assertClaimable`). M5 has four capabilities from roadmap line 148: **A5 criteria-pack matching**, **A6 affordability & stress**, **counterfactuals**, and **scenario runs**. The architecture of record is `.lm-flow/architecture/mesh-m5-criteria-affordability.md`.

The number path is **pure and deterministic** (LLM-free), mirroring M3's `detectConflict`: `assessCriteria(pack, caseFacts)`, `computeAffordability(inputs)`, `applyDelta(base, delta)`, `diffScenarios(a, b)`. All money is **integer pence, no float**, with a **documented rounding rule** recorded in each output's `working[]` and pinned by cross-platform golden vectors (include a rounding-boundary case). A dispatched agent (`scenario.ts`, via `lm.directive/1`) orchestrates but never invents numbers; it writes new **side-car artifacts** (`lm.criteria.pack/1`, `lm.criteria.assessment/1`, `lm.affordability.assessment/1`, `lm.scenario.run/1`) with **decoders added additively** to `artifactKinds.ts`, and **new fold entry kinds** (`criteria-assessment`, `affordability-assessment`, `scenario-run`, `criteria-override`) each stamped with `origin.artifactId`. Artifact + fold-entry **ids are pure functions of `(packRef, caseFactsHash, deltaHash)`** so re-dispatch is idempotent and the kill-the-laptop convergence + hash-chain hold over the new kinds (a convergence test is mandatory). `packRef` is a **content-hashed immutable pin**; an assessment records the exact pack version and a superseded pack still resolves for a SAR.

The **honesty spine is the deliverable**. Criteria results are an *indicative match vs cited criteria text*, never a lender decision; affordability is *indicative* (MCOB 11.6.2R), never a guaranteed max. `CriteriaAssessment.results` MUST carry **exactly one entry per `FirmConfig.lenderPanel` member**, and any `fail`/`refer` MUST carry ≥1 reason (a decoder invariant + eval), so a **why-not for every excluded lender** is structurally guaranteed. A single **`assertIndicative()`** choke-point — in the writer/fold, not UI — returns a typed reason (`client-surface | not-indicative | g9-unverified | wrong-surface | stale-product`) and enforces: A6 (and criteria figures) may never reach **any client view or client-comms artifact pre-G5** (spec §8.6 / invariant 6; a no-client-embed CI test covers both paths); **G9 income-verified** is a precondition for affordability; a product sourced from a snapshot that no longer passes M4 `assertClaimable` is refused (`stale-product`). Per-input **provenance** (det/syn, quote-locator on det) is recorded in every artifact for suitability/SAR reconstruction. A pack rule older than firm policy **degrades its verdict to `refer`** (not just a banner). A panel lender with no authored rules renders **`refer`/"not assessed"**, never a silent pass or exclusion (MCOB 4.4A.1R scope disclosure). Copy may never read "eligible"/"guaranteed"/"whole of market" (a copy/lint gate). A **criteria override** routes **G6** (adviser-only, compliance-flagged): a confirm step showing the original verdict, a forced one-line rationale, plain "raises a compliance flag" copy, folding the original verdict + adviser id + rationale + flag; a stale-rule override notes staleness. The **recommendation stays a human G5 act** — M5 never recommends.

The adviser-only surface is `ScenarioBoard.tsx` on the M2 thin surface: a per-lender criteria grid with **inline** why-not (rule + numeric delta; cited text + as-at in a drawer — never hover-only, keyboard-reachable), the affordability indicative result with a **full-working drawer**, det/syn shown as a **per-cell dot + a board-level "N inputs synthetic" summary** (the word "provenance" never in the UI), and **side-by-side scenario comparison** (up to 4 visible, cap ≤8/run) highlighting lender flips and max/monthly deltas. A **persistent** indicative + adviser-only treatment (pinned honesty line + non-dismissible chrome band) replaces repeated micro-labels. The **G9-blocked state** names the blocking step and action while still rendering the criteria grid (criteria does not need G9). A **synthetic 12-lender fixture pack** ships, hand-tuned to produce each verdict incl. a syn-forced `refer`, so a rep can demo eliminate-with-reasons → counterfactual → side-by-side in <5 min with zero setup; a minimal **gated pack editor** (authorship folded: who edited which rule, when) ships, but a full authoring UI and SSO/RBAC/retention UI are out of scope (enterprise-readiness rides the M2 surface + fold audit; retention posture documented per SYSC 9 / MCOB 4.7A.19R). A **DPIA** covering A6/criteria inputs, retention, and the adviser-only boundary is required before ship (UK GDPR Art 35).

Constraints (binding): base `lendmind-crm`, feature branch `feature/mesh-m5-criteria-affordability`; **additive-only** to frozen M1–M4 contracts + existing `src/crm` exports; M5 freezes its own contracts under `specs/006-mesh-m5-criteria-affordability/contracts/` with a freeze test; no new deps; Apache license header on every file; no `c-a-m-e-l` letter sequence; `ds-*` design tokens only; i18n ×11 locales; vitest baseline green; dark-mode contrast verified; eval ≈30% of budget (a synthetic known-answer corpus asserting why-not completeness + indicative-label presence). Phasing: **Phase 1** criteria pack + rule engine + provenance spine + `assertIndicative` + no-client-embed test (self-contained value); **Phase 2** affordability & stress calculator + G9 precondition (the MVP seam ends here); **Phase 3** counterfactuals + scenario runs + the scenario agent; **Phase 4** the ScenarioBoard surface + G6 override + G5 handoff + demo + gates. Resolve the two open vocabulary items in the spec: the closed **`RuleKey`/`RuleOp` enum** for v1 (LTV/LTI/income/adverse/employment/term/property) and the **default stress rate** (firm-config default, overridable per scenario, recorded in the working) — both are Phase-1/2 build blockers, not niceties.

**You MUST include a `## User Journeys` section in the spec** carrying the three journeys above (or refined versions). This is a hard requirement — the downstream validate-feature step depends on it. Also carry the success metric (median adviser-minutes-saved on criteria+affordability research vs a week-0 baseline across the 5 design-partner firms; ≥95% of excluded panel lenders carry a usable why-not) and a failure/rollback signal (any adviser-reported false pass/fail on a real case; advisers bypassing the board back to portals in >30% of cases at 2 weeks).
