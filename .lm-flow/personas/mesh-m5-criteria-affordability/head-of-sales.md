# Head of Sales perspective on mesh-m5-criteria-affordability

## What I support

This is the strongest demo we have. **The demo:** paste a case, watch the agent eliminate 10 of 15 panel lenders with a cited reason for each ("Lender X: refer — LTI 4.6 vs cap 4.5"), then hit "what if they put £10k more down" and watch lenders flip pass live. That is the wow moment M4 lacked; it closes design partners. **Bake-off:** Twenty7Tec/MB give a calculator and a sourcing grid but not a *why-not per excluded lender with cited criteria text* — that plus counterfactual side-by-side is our wedge. **Indicative + adviser-curated pack is a selling point:** "honesty is the moat" is a sales line, not a hedge — we never fake a lender decision, so the adviser trusts it and stays liable in the right place (G5). It answers "who's liable if criteria are wrong?" — the firm authored the pack, we show cited text + as-at, the human makes the recommendation.

## What I want changed (Dissent:)

Dissent: the persona's enterprise checklist is silently absent. Nowhere does M5 name **RBAC (adviser-only enforcement is real, but who can author/edit the pack?), audit log surfacing, retention, admin visibility, or SSO**. `assertIndicative` + G6 fold is great audit *plumbing*; I need a one-line "enterprise-readiness: SSO/RBAC via M2 surface, audit via fold, retention deferred to M#" so procurement isn't a surprise. Deferred is fine; silent is a lost deal.
Dissent: "adviser must provide their panel + criteria pack" is a **trial blocker** unless we make it a trial-day-1 ask. Ship a **pre-loaded synthetic 12-lender pack the prospect can demo on immediately**, plus a "import your top 5 lenders in 30 min" guided authoring flow. Do not let pack authoring gate the value moment inside a 14-day trial.

## What I would not ship without

- A scripted **5-minute demo path**: eliminate-with-reasons -> counterfactual -> side-by-side, on the synthetic pack, no setup.
- A **liability/positioning one-pager** answering "is this just a calculator?" (no — cited why-not + provenance + counterfactuals) and "who's liable?" (firm's pack, adviser's G5 call).
- The enterprise-readiness checklist above, explicit in the spec.
- Guardrail against overpromising: **never say "whole of market" or "eligible"** — copy must read "indicative match against your panel's cited criteria." Add a lint/copy gate.

## Acceptance criteria from my lens

- New rep demos the wow moment in <5 min with zero setup on the shipped synthetic pack.
- A prospect authors a 5-lender pack and sees a real assessment within trial day 1 (<30 min).
- Every excluded lender shows a reason + cited text + as-at; no output ever reads "eligible"/"guaranteed"/"whole of market."
- Counterfactual re-run shows lender pass/fail flips and the indicative-max delta side-by-side.

## Edge cases I want addressed

- Prospect's pack is thin/stale -> board shows staleness banner, not a confident-but-wrong verdict (protects the reference customer).
- All lenders `refer` because inputs are `syn` -> demo must still land value ("verify income to sharpen these"), not look broken.
- Client accidentally sees affordability -> the no-client-embed CI test is a *security-review selling point*; put it in the security answers.
- Adviser overrides then blames the tool -> G6 rationale + original-verdict fold is our defense; surface it in the liability one-pager.
