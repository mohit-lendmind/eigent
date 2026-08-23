# Software Engineer perspective on mesh-m5-criteria-affordability

## What I support

Pure/deterministic number path is the right call: `assessCriteria`, `computeAffordability`, `applyDelta`, `diffScenarios` as pure functions are trivially unit-testable with golden vectors — no mocks, no network, runs on a laptop with zero credentials. Reusing `det`/`syn` provenance from `docintel.d.ts` and the folded-summary+attachment lesson from M4 avoids reinventing. Single `assertIndicative()` choke-point in the writer/fold (not UI hiding) is the only defensible way to prove A6 can't leak. Additive-only artifact kinds + side-car pattern (mirroring `lm.docintel.extraction/1`) keeps M1–M4 contracts frozen.

## What I want changed (Dissent:)

- **Dissent:** "why-not for EVERY excluded lender" is asserted but the data shape doesn't force it. Make it structurally impossible to omit: `CriteriaAssessment.results` MUST contain one entry per `FirmConfig.lenderPanel` member, and a `fail`/`refer` verdict MUST carry >=1 reason. A decoder invariant + eval test, not a hope.
- **Dissent:** pence-exact is stated but no arithmetic contract. Pin it: all money is integer pence, no `float`; LTI/multiple math uses integer division with a documented rounding rule (round-half-to-even or floor — pick one) recorded in `working[]`. Stress-rate math must not reintroduce floats. Golden vectors must include a rounding-boundary case.
- **Dissent:** Open questions #1 (stress-rate source) and #2 (rule key/op vocabulary) are unresolved. I cannot build `assess.ts` without the closed `RuleKey`/`RuleOp` enum, and I can't build `calc.ts` without the default stress rate. These are Phase-1/2 blockers, not spec-phase niceties.

## What I would not ship without

- A `criteriaPack.synthetic.ts` fixture with a 12-lender panel, hand-tuned so the fixture case produces at least one of each verdict (pass/refer/fail) and at least one `syn`-input-forced `refer`.
- The no-client-embed CI test (mirror M4): a static/import test proving no component under a client-facing path imports the affordability decoder or `lm.affordability.assessment/1`.
- Golden-vector test file with committed expected pence outputs; convergence (re-fold) test extended to the 4 new entry kinds with hash-chain intact.
- `m5ContractFreeze.test.ts` against `specs/006-.../contracts/`.

## Acceptance criteria from my lens

- `vitest` baseline stays green; new suites cover assess/calc/counterfactual/decoder/assertIndicative.
- `assertIndicative` returns each typed reason (`client-surface`/`not-indicative`/`g9-unverified`/`wrong-surface`) with a test per branch.
- All new files: Apache license header; no `c-a-m-e-l` letter sequence; `ds-*` tokens only in `ScenarioBoard.tsx`; i18n keys across all 11 locales for every board string; no new deps.
- Decoder rejects malformed rules (unknown key/op, missing citedText/asAt, non-integer pence).

## Edge cases I want addressed

- Empty panel / pack pointer set but artifact missing → defined fallback, not crash.
- Rule input present but `syn` → `refer` + named missing input (never silent).
- Counterfactual cap (recommend firm-config <=8/run) enforced before write, tested.
- Stale pack (`asAt` past policy) → staleness surfaced, override still routes G6.
- Delta that produces negative/zero max-borrow → clamped and labelled, not NaN.
- Idempotent derived ids for scenario/assessment entries so re-run doesn't double-fold.
