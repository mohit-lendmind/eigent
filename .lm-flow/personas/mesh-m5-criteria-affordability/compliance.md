# Compliance perspective on mesh-m5-criteria-affordability

## What I support
The honesty spine is correctly load-bearing. Criteria = "indicative match vs *cited* criteria text", affordability = indicative label per **MCOB 11.6.2R** — both framed as adviser inputs, never lender decisions or firm promises. `assertIndicative()` as a single enforced choke-point in the writer/fold (not UI hiding) is the right control shape; UI convention would not survive a **PRIN 2A (Consumer Duty)** consumer-understanding challenge. G9 income-verified precondition maps to **MCOB 11.6.8R** (verify, don't self-certify). G5 kept human honours **MCOB 4.7A.6R** (recommendation is a regulated advised act). G6 override adviser-only + compliance-flagged + original verdict retained is auditable. Per-input `det`/`syn` provenance with M3 quote-locator is exactly what a suitability file / SAR reconstruction needs.

## What I want changed (Dissent:)
Dissent: "indicative" as a data flag is necessary but not sufficient for **Consumer Duty consumer-understanding**. The *cited criteria text* is a lender's IP presented as-is — if an adviser copies an indicative pass into client comms as an assurance, the firm is on the hook. Require `assertIndicative` to also refuse export of A6/criteria figures into ANY client-comms artifact kind pre-G5, not just "client views".
Dissent: staleness surfaces a *banner* only. A criteria pack `asAt` older than firm policy must degrade the verdict to `refer` (like syn/missing), not merely warn — a stale-criteria "pass" is a **PRIN 2A** foreseeable-harm risk.
Dissent: "adviser-curated pack" means the firm authors the rules the whole recommendation rests on. Pack authorship must itself be gated + folded (who authored/edited which rule, when) — otherwise provenance stops at `sourceRef` and the SAR cannot show the rule was correct as-at.
Dissent: no DPIA posture is stated. A6 processes special-category-adjacent financial data + adverse-credit policy; a DPIA is required before processing.

## What I would not ship without
1. DPIA covering A6/criteria inputs, retention, and the adviser-only boundary (UK GDPR Art 35).
2. Record retention pinned to **SYSC 9 / MCOB 4.7A.19R** minimum (advised sale ≥ term of contract for suitability evidence); hash-chain + immutable artifacts + full working retained accordingly.
3. Stale-pack → `refer` degradation, not banner.
4. Pack-authorship gate + fold entry.
5. Export choke-point covering client-comms artifacts, not just views.

## Acceptance criteria from my lens
- Every A6 output carries indicative label + full working + per-input provenance; CI proves none is absent.
- No client-comms or client-view artifact can embed A6/criteria pre-G5 (CI, both paths).
- G6 override always folds original verdict + adviser id + rationale + compliance flag.
- Suitability file can be reconstructed from artifacts alone: packRef+asAt, det/syn per input, quote-locators.

## Edge cases I want addressed
- Adviser screenshots the board into an email → policy + export control, since the artifact can't follow.
- Panel lender not in pack → shown as "not assessed", never silent exclusion (whole-of-market overclaim: firm is panel/limited, must say so — **MCOB 4.4A.1R / disclosure of scope**).
- Override forces `refer→pass` on a stale rule → G6 flag must note staleness.
- SAR requests one case's full working after pack was superseded → assessment's pinned packRef must resolve to the exact as-at version.
