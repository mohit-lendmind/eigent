# Architecture: mesh-m5-criteria-affordability

## TL;DR
- M5 is **the reasoning core** — A5 criteria-pack matching + A6 affordability/stress — turning M3's det-verified fact-find and M4's sourcing snapshots into an **adviser-only, indicative** decision surface. It computes, per panel lender, an indicative criteria pass/refer/fail with a **why-not for every excluded lender**, and an indicative affordability/stress result with **full working in an artifact**; then it runs **counterfactuals** ("what if term/deposit/income-mix changes") and **scenario sets** compared side by side.
- Everything is **deterministic and pure** where the number matters: the criteria rule engine and the affordability calculator are LLM-free (like M3's `detectConflict`). The agent (A5+A6) only orchestrates — it does not invent numbers. Rides M2 dispatch (`lm.directive/1`) + the M1 fold; writes new immutable side-car artifacts (`lm.criteria.assessment/1`, `lm.affordability.assessment/1`, `lm.scenario.run/1`) with folded summary entries.
- **Honesty spine is the product.** Criteria = "indicative match against *cited* criteria text", never a lender decision (MCOB doctrine). Affordability = **indicative label** (MCOB 11.6.2R), never a guaranteed maximum. Every output carries **input provenance** (which criteria source + as-at; det vs syn per affordability input). A single `assertIndicative()` choke-point enforces: **A6 output never reaches a client view pre-recommendation** (spec §8.6 / invariant 6), **G9 income-verified is a precondition**, and the **recommendation stays a human G5 action**. Criteria overrides go through **G6** (adviser + compliance-flag).
- **Synthetic/pluggable criteria pack only** — v1 is an **adviser-curated pack** for the firm's 10–15 lender panel; a licensed criteria DB is explicitly out of scope (spec §4-A5). The pack is data (an artifact), not a purchased feed.

## Inputs
- Recon: **none** (SKIPPED — M5 is internal financial logic, not a competitor-UI clone; recorded in the flow file). A trivial UX reference: side-by-side scenario comparison mirrors how sourcing tools (Twenty7Tec/MB) present affordability calculators — noted, not blocking.
- Brief: spec v2 §4-A5 (adviser-curated criteria pack; execution-time quote capture of cited criteria text; why-not per excluded lender; licensed DB later; G6 override adviser-only + compliance-flagged), §4-A6 (indicative labelling MCOB 11.6.2R; full working in artifact; §8.6 A6 never in client view pre-recommendation), §5 (G5 adviser monopoly; G6 criteria override; G9 income-verified veto-grade), §0 invariants (adviser-only reasoning, no overclaim), roadmap line 148 (`A5 criteria pack + A6 affordability; counterfactuals; scenario runs`; depends M3, M4).
- Constraints: base `lendmind-crm`; **depends on M3 merged** (det-verified income/affordability inputs via the fact-find + `DocintelExtraction`; G9) **and M4 merged** (`lm.sourcing.snapshot/1` products with rate/aprc/true-cost); develops against **frozen** M1/M2/M3/M4 contracts (`specs/002–005/contracts/*.d.ts`) + existing `src/crm` exports — **additive only**; no new deps; `src/api/aion/v1/**` frozen; CI gates green (license headers; no `c-a-m-e-l` letter sequence; `ds-*` tokens; dead-brain gate; i18n ×11; vitest baseline). M5 freezes its own contracts under `specs/006-mesh-m5-criteria-affordability/contracts/`.
- Coverage: **serial** (grounded by a direct read of `src/crm` — gates, fold, contracts, firmConfig, dispatch, M3/M4 arch + contracts — rather than parallel Explore agents; headless `claude -p` is org-auth-blocked, see flow record deviation).

## Components

### Criteria pack model + loader (A5 data plane)
- **Lives at:** `src/crm/criteria/pack.ts` + `src/crm/fixtures/criteriaPack.synthetic.ts`.
- **Mirrors:** M1 `firmConfig.ts` decoder pattern; M4 `Coverage` typed-enum discipline.
- **Does:** models an **adviser-curated criteria pack** — per panel lender, a set of typed rules (`maxLTV`, `minIncome`, `maxLTI`, `adverseCreditPolicy`, `employmentType`, `minTermYears`, `propertyType`…), each rule carrying the **cited criteria text**, a `sourceRef` (adviser/pack pointer, NOT a licensed DB), and an `asAt`. Loaded from a `lm.criteria.pack/1` artifact referenced by `FirmConfig.criteriaPack`. **Synthetic fixture pack** ships for dev; real packs are firm-authored through the gate-logged config surface (spec §8.3).
- **Surface:** `decodeCriteriaPack(v) → CriteriaPack`; `loadPackForFirm(firmId) → CriteriaPack`.

### Criteria rule engine (A5 assessment — pure)
- **Lives at:** `src/crm/criteria/assess.ts`.
- **Mirrors:** M3 `detectConflict` (deterministic, never LLM-emitted).
- **Does:** evaluates a case's **det-verified** fact-find facts against every panel lender's rules → per-lender `pass | refer | fail` with, for each rule, the **cited criteria text**, the input value used, and its **provenance (`det`/`syn`)**. Produces a **why-not for every excluded lender** (which rule failed, by how much). A rule whose required input is `syn`/absent yields `refer` (never a silent `fail`/`pass`) and marks the missing input. Emits `lm.criteria.assessment/1`.
- **Surface:** `assessCriteria(pack, caseFacts) → CriteriaAssessment` (pure).

### Affordability & stress calculator (A6 — pure)
- **Lives at:** `src/crm/affordability/calc.ts`.
- **Mirrors:** M3 pence-exact deterministic recompute; M4 `trueCostPence` normalization.
- **Does:** deterministic affordability + stress computation — income (multiples/LTI), committed expenditure, stress rate, resulting indicative max borrow + monthly at product rate and at stress. All pence-exact, LLM-free. Output carries **indicative labelling** (MCOB 11.6.2R), the **full working** (every input, factor, and step) in the artifact, and **per-input provenance** (`det`/`syn`, with the M3 quote-locator ref where `det`). Emits `lm.affordability.assessment/1`.
- **Surface:** `computeAffordability(inputs) → AffordabilityAssessment` (pure).

### Counterfactual engine
- **Lives at:** `src/crm/affordability/counterfactual.ts`.
- **Mirrors:** new ground (no existing analog) — thin, pure, sits on the two calculators above.
- **Does:** applies a typed **delta** to a base scenario (term, deposit/LTV, income mix, rate, product) and re-runs `assessCriteria` + `computeAffordability`, returning the **diff** ("what changes if X") — which lenders flip pass↔fail, how the indicative max/monthly moves. Never mutates the base; each counterfactual is a derived scenario.
- **Surface:** `applyDelta(base, delta) → ScenarioResult`; `diffScenarios(a, b) → ScenarioDiff` (pure).

### Scenario runner (A5+A6 agent)
- **Lives at:** `src/crm/agents/scenario.ts`.
- **Mirrors:** M4 `sourcing.ts` (dispatched agent that writes a folded summary + referenced attachment); M2 `dispatch.ts` seam.
- **Does:** dispatched via `lm.directive/1` when a case is **G9 income-verified** (precondition). Loads the pack + case facts + (optionally) the M4 sourcing snapshot's products, runs criteria + affordability across **N scenarios** (base + counterfactuals), writes an immutable `lm.scenario.run/1` artifact (full working rides as a **referenced attachment**; the case-log entry is a **folded summary** — the fold drops oversize, per M4's lesson), stamps the acting adviser id. **Adviser-facing only.**
- **Surface:** `runScenarios(caseId, scenarios) → ScenarioRunResult`.

### Honesty choke-point: `assertIndicative()`
- **Lives at:** `src/crm/criteria/assertIndicative.ts`.
- **Mirrors:** M4 `assertClaimable()` — a single enforced gate, in the writer/fold, not UI hiding.
- **Does:** THE choke-point every criteria/affordability surface + export MUST call. Refuses when: `surfaceClass !== 'adviser-only'` on any A6 payload reaching a client-facing path (spec §8.6); `!indicative` (an output presented as a guaranteed lender decision / max); `!g9IncomeVerified`; or a pre-recommendation client comms path attempts to embed A6. Returns typed `{ ok:false, reason:'client-surface'|'not-indicative'|'g9-unverified'|'wrong-surface' }`. Enforced in the artifact writer and covered by a CI test proving no client-facing component can decode/embed an affordability artifact.

### G6 criteria override
- **Lives at:** `src/crm/criteria/override.ts` (logic) + surfaced on the scenario board.
- **Mirrors:** M1 `GATE_REGISTRY` G6; M3 G2/G3 gate-raise pattern.
- **Does:** an adviser may override a per-lender criteria verdict (e.g. force `refer→pass` on a known policy exception). The override raises **G6** (adviser + **compliance flag**), is **adviser-only**, records a one-line rationale + the original verdict, and **folds** as an override entry. Never auto-applied; never delegable.

### Scenario surface + G5 handoff
- **Lives at:** `src/crm/ui/ScenarioBoard.tsx` on the M2 thin surface.
- **Mirrors:** M4 `SourcingResults.tsx` (adviser-only, pinned honesty line, G-gated action).
- **Does:** side-by-side **scenario comparison** — per scenario, the criteria pass/refer/fail grid with **why-not** per excluded lender + cited criteria text on hover, and the affordability **indicative** result with a **full-working drawer**. Every A6 figure carries the indicative label; provenance (det/syn) is shown per input. **Adviser-only** (A6 never in a client view). The **recommendation is a human G5 action**; G6 override is a button that raises the compliance-flagged gate. Clients never see this board.

## Data model changes
Additive only. New **artifact kinds** (decoders added to `src/crm/agentContracts/artifactKinds.ts`, side-car — never fold event kinds, mirroring M3's `lm.docintel.extraction/1`):
- `lm.criteria.pack/1` — `{ firmId, asAt, lenders:[{ lenderId, rules:[{ key, op, value, citedText, sourceRef, asAt }] }] }`.
- `lm.criteria.assessment/1` — `{ caseId, packRef, results:[{ lenderId, verdict, reasons:[{ ruleKey, citedText, inputValue, inputProvenance, delta }] }], surfaceClass:'adviser-only' }`.
- `lm.affordability.assessment/1` — `{ caseId, indicative:true, inputs:[{ key, value, provenance, sourceRef? }], working:[…], results:{ maxBorrowPence, monthlyAtRatePence, monthlyAtStressPence, stressRate }, surfaceClass:'adviser-only' }`.
- `lm.scenario.run/1` — folded summary `{ caseId, scenarioCount, baseRef, adviserId }` + full working as a **referenced attachment** (never inline).
- New **fold entry kinds** (added in `caseLogFold.ts`, additive to `field-change`/`conflict-upsert`): `criteria-assessment`, `affordability-assessment`, `scenario-run`, `criteria-override` — each with `origin` (artifactId) so the hash-chain + kill-the-laptop convergence still holds.
- `FirmConfig.criteriaPack?: string` (pointer to the pack artifact) — additive to `firmConfig.ts`, defaulting undefined (falls back to the synthetic fixture in dev). `FirmConfig.lenderPanel` already exists and drives which lenders are assessed.
No schema major bump; the generic M1 decoder validates the spine, dedicated decoders validate each payload.

## External integrations
| Provider | Access | M5 |
|---|---|---|
| (none — licensed criteria DB) | licensed feed | **explicitly out of scope** (spec §4-A5). v1 = adviser-curated synthetic/pluggable pack, an artifact, not a purchased feed. |
| M4 sourcing snapshot | in-repo artifact | consumed read-only for product rates/true-cost when scoring affordability against a real product; optional (scenarios run on manual product terms too). |
| M3 fact-find / DocintelExtraction | in-repo fold | consumed read-only for det-verified income/affordability inputs + G9 status. |

No network egress, no model call on the number path. This is a compute-only milestone.

## Failure modes & how we handle them
- **A6 leaking to a client view pre-recommendation** → structurally impossible: `surfaceClass:'adviser-only'` + `assertIndicative` in the writer/fold + a CI test proving no client component decodes an affordability artifact (spec §8.6 / invariant 6).
- **Criteria verdict presented as a lender decision** → forbidden; every result is "indicative vs *cited* criteria text"; `assertIndicative` blocks a non-indicative presentation; the cited text + as-at travel with every reason.
- **Affordability run before income is det-verified** → G9 precondition; the scenario runner refuses to dispatch; the board shows "income not yet verified" instead of a number.
- **A rule's input is `syn`/missing** → verdict is `refer`, never a silent pass/fail; the missing input is named; provenance is surfaced.
- **Stale pack** → each rule carries `asAt`; a pack older than firm policy surfaces a staleness banner (like M4 rates-as-at); an override still routes through G6.
- **Oversize scenario working** → folded summary + referenced attachment (the fold drops oversize inline — M4's lesson).
- **Adviser override abuse** → G6 is compliance-flagged, adviser-only, records the original verdict + rationale, and folds — auditable, never silent.
- **Non-determinism drift** → the calculators are pure and pence-exact; a golden-vector test pins outputs; convergence test proves re-fold yields identical state.

## Test strategy
- **Unit (pure):** criteria rule engine (pass/refer/fail + why-not for every excluded lender + provenance); affordability + stress golden vectors (pence-exact); counterfactual diffs; pack decoder rejects malformed rules.
- **Guardrail:** `assertIndicative` blocks client-surface / non-indicative / G9-unverified; **CI test: no client-facing component can decode/embed an `lm.affordability.assessment/1`** (mirrors M4's no-client-embed test); coverage of the surfaceClass tag.
- **Gate:** G9 precondition enforced before a scenario run; G6 override raises compliance flag + folds + records original verdict; G5 stays human (unchanged).
- **Convergence:** scenario/criteria/affordability/override entries fold; **kill-the-laptop still converges** with the new entry kinds; hash-chain intact.
- **Contract freeze:** `m5ContractFreeze.test.ts` vs `specs/006-mesh-m5-criteria-affordability/contracts/`.
- **Eval (≈30% budget, spec §7):** a synthetic case corpus with known-answer criteria/affordability outcomes; assert the why-not is complete (every excluded panel lender has a reason) and the indicative label is present on every A6 output.

## Phasing

### Phase 1 — Criteria pack + rule engine + provenance spine
- Goal: the `lm.criteria.pack/1` model + synthetic fixture pack + the pure `assessCriteria` engine (pass/refer/fail + why-not per excluded lender + cited text + det/syn provenance) + the `assertIndicative` choke-point + `surfaceClass:'adviser-only'` tagging + the no-client-embed CI test.
- Success criterion: a fixture case assessed against a 12-lender synthetic panel yields a per-lender verdict with a why-not for **every** excluded lender and cited criteria text; `assertIndicative` blocks a client-surface path; the criteria assessment folds and the hash-chain holds.

### Phase 2 — Affordability & stress calculator (A6)
- Goal: the pure `computeAffordability` (income multiples, expenditure, stress rate → indicative max/monthly), the `lm.affordability.assessment/1` artifact with full working + indicative label + per-input provenance, and the **G9 income-verified precondition**.
- Success criterion: golden-vector affordability + stress outputs are pence-exact and carry the indicative label + full working; an affordability run is blocked when income is not det-verified; the no-client-embed test proves A6 cannot reach a client view.

### Phase 3 — Counterfactuals + scenario runs
- Goal: the `applyDelta`/`diffScenarios` counterfactual engine + the `scenario.ts` agent that runs base + N counterfactuals, writes `lm.scenario.run/1` (folded summary + referenced attachment), stamps adviser id, and dispatches only when G9-verified.
- Success criterion: varying term/deposit/income-mix re-runs criteria + affordability and returns a correct diff (which lenders flip, how the indicative max moves); a scenario set of N scenarios folds as a summary with the full working as an attachment; convergence holds with scenario entries.

### Phase 4 — Scenario surface + G6 override + G5 handoff
- Goal: `ScenarioBoard.tsx` on the M2 surface (side-by-side scenarios, criteria grid + why-not + cited text, affordability indicative + full-working drawer, provenance per input, all adviser-only); the G6 compliance-flagged criteria override; the G5 recommendation stays a human action; demo + full gate run + PR into `lendmind-crm`.
- Success criterion: an adviser compares scenarios (adviser-only), overrides a criteria verdict via G6 (compliance-flagged, folds with the original verdict), and the recommendation remains a human G5 action; A6 never appears in any client view; all CI gates green; dark-mode contrast verified.

## Open questions for the spec phase
1. **Stress-rate source of truth** — firm-config value vs a per-product revert-rate + margin (MCOB 11.6.18). Recommend: firm-config default stress rate, overridable per scenario, recorded in the working. The spec should pin the default.
2. **Criteria rule vocabulary** — the closed set of rule `key`/`op` types for v1 (LTV/LTI/income/adverse/employment/term/property). Recommend a small typed enum now; extensible additively later. The spec should enumerate v1's set.
3. **How many counterfactuals per scenario run** — a bound to keep the artifact/fold sane. Recommend a firm-config cap (e.g. ≤8 scenarios/run) with the board comparing up to 4 side-by-side.
4. **Does M5 read the M4 sourcing snapshot directly, or does the adviser pick a product into a scenario** — recommend both: scenarios accept manual product terms *and* can pull a product from a sourcing snapshot; keep the coupling optional so M5 is usable before a sourcing run.

## Evidence
spec v2 §4-A5 (adviser-curated pack; why-not per excluded lender; cited text; licensed DB later; G6), §4-A6 + §8.6 (indicative MCOB 11.6.2R; full working; A6 never in client view pre-recommendation), §5 (G5 monopoly, G6 override, G9 veto-grade), line 148 (M5 scope + M3/M4 deps); `src/crm/agentContracts/gates.ts` (G5/G6/G9 real); `src/crm/agentContracts/firmConfig.ts` (`lenderPanel`, `adapters` — additive `criteriaPack`); `src/crm/fold/caseLogFold.ts` (fold entry kinds + `origin`; hash-chain); M3 `docintel.d.ts` (`det`/`syn` provenance, `detectConflict` determinism); M4 `sourcing.d.ts` (`Product`, `assertClaimable`, folded-summary+attachment lesson, no-client-embed test).
