# Product Manager perspective on mesh-m5-criteria-affordability

## What I support
- **User is named:** the mortgage adviser at a design-partner firm, doing manual criteria research today (flicking between lender portals, Twenty7Tec/MB affordability calcs, and memory of policy). M5 replaces that. Adviser-only, indicative, human-owned recommendation (G5) is exactly right.
- **Honesty spine as product**, not a disclaimer. `assertIndicative` + `surfaceClass:'adviser-only'` + the no-client-embed CI test make "indicative" a structural fact, which is what protects us from mis-sold-advice liability (MCOB 11.6.2R): the number literally cannot reach a client pre-recommendation.
- **Why-not for every excluded lender** is the killer metric surface. Deterministic, pure calculators (no LLM on the number path) mean the output is defensible.
- Adviser-curated pack as an artifact (not a licensed feed) is the correct v1 cut — it de-risks a licensing dependency off the critical path.

## What I want changed (Dissent:)
- **Dissent: Phase 3 counterfactuals+scenarios should NOT be in the v1 ship.** The minimum shippable slice that moves a metric is Phase 1 + 2 + the board showing ONE base scenario. Counterfactuals are a v1.1. The architecture treats MVP and v2 as one build; cut the seam at Phase 2.
- **Dissent: no success metric is defined.** Spec §7 names adviser-minutes-saved / time-to-fact-find-complete but this arch cites none. I will not approve without a baseline.
- **Dissent: pack staleness is surfaced but not OWNED.** A staleness banner is not ownership. Name the accountable role (the firm's compliance lead) and a review cadence (asAt + firm-policy TTL, e.g. 30 days) written into FirmConfig.

## What I would not ship without
- A named success metric with a baseline-establishment plan (below).
- An explicit MVP cut that defers Phase 3.
- Design-partner blocker resolved: each firm must supply its 10-15 lender panel + curated criteria text. Time-box a pack-authoring session per firm; if a firm can't supply it, they can't be a Phase-1 partner. State this as a gating dependency, not a footnote.
- A defined **failure/rollback metric** (below) — not present in the arch.

## Acceptance criteria from my lens
- **Success (leading, measurable in 2 wks):** median adviser-minutes-saved on criteria+affordability research per case vs baseline (measure baseline in week 0 across the 5 firms); AND ≥95% of excluded panel lenders carry a usable why-not.
- **Failure/rollback:** any adviser-reported false pass/fail on a real case (deterministic engine must be trustworthy), or advisers bypassing the board back to portals in >30% of cases at 2 weeks.
- **Activation moment:** adviser runs one case and reads a why-not that saves a portal lookup.

## Edge cases I want addressed
- Pack disagrees with real lender outcome on a live case — capture as feedback loop; who corrects the pack?
- Panel lender with zero rules authored yet — must render `refer`, never silent pass.
- Firm with >15 lenders or shared panels across advisers.
- G6 override rate as a health signal: high override rate = stale/wrong pack, surface it to the compliance owner.
