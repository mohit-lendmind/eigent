# DPIA — Criteria & Affordability (M5 `mesh-m5-criteria-affordability`)

_Data Protection Impact Assessment for the A5 criteria-matching + A6
affordability/stress reasoning core, its counterfactuals, and the adviser-only
scenario surface. Deliverable for FR-016 / SC-006 (UK GDPR Art 35). This artifact
MUST be checked in before any real client facts or real lender-criteria data are
switched on. Until the sign-offs below are recorded, the engines run on
**synthetic data only** — a hand-tuned 12-lender fixture pack + a synthetic
applicant — and every published claim is reproduced with
`node scripts/demo-mesh-m5.mjs`._

## 1. What the processing is

A UK mortgage adviser runs a client's **det-verified** fact-find (income,
deposit, term, employment, property — produced and G9-gated by M3) against a
firm-curated **criteria pack** (A5) and a **pure, deterministic affordability
engine** (A6). The output is an **adviser-only, indicative** decision surface:
per panel lender an indicative `pass` / `refer` / `fail` with a **why-not for
every excluded lender** (the cited rule + the input delta), plus an indicative
max-borrow and monthly-at-rate / monthly-at-stress figure with the **full working
retained in an artifact**. It then runs **counterfactuals** (larger deposit,
higher rate, second income, longer term) and **side-by-side scenarios**.

Every number is computed LLM-free by a pure engine — there is **no model
inference in the A6 path at all**, so §3 of the docintel DPIA (inference
residency) does not arise here. The agent **dispatches nothing and sends
nothing**; there is no outbound path, enforced by construction and asserted by
the write-path red team (`test/unit/crm/redteamWrite.test.ts`).

## 2. Lawful basis (UK GDPR Art 6)

- **Art 6(1)(b) — performance of a contract.** The client has engaged the firm to
  source and advise on a mortgage; assessing which lenders' published criteria a
  verified fact-find meets, and what is indicatively affordable, is necessary to
  perform that mortgage-advice contract (MCOB 11.6 affordability, MCOB 4.7A
  suitability). This is the primary basis for the personal data processed.
- No processing relies on consent as its Art 6 basis, so a withdrawal of consent
  does not strand a live application. No special-category data (Art 9) is
  processed by A5/A6: the inputs are financial fact-find fields, not health,
  belief, or union data — any Art 9 incidental data was flagged and held for human
  review upstream by docintel (M3), never folded into the criteria inputs.

## 3. The inputs A5/A6 read (data minimisation, Art 5(1)(c))

The engines read **only** the minimum fact-find fields the rules and the
affordability sum need, each carrying its trust marker:

| Input | Purpose | Source / trust |
|---|---|---|
| Annual income (pence) | affordability max-borrow, LTI, `minIncome` rules | `det` only, from an M3 quote-locator; a `syn` income never satisfies **G9** |
| Deposit / property value (pence) | LTV, loan amount | `det` fact-find field |
| Term (years), employment type, property type | `minTerm`/`maxTerm`, `employmentType`, `propertyType` rules | fact-find fields; a `syn`/missing input forces a **named refer**, never a silent pass |
| Adverse-credit marker | policy rules (referred to underwriting) | fact-find field |
| Rate / stress rate (bps), income multiple | monthly-at-rate, monthly-at-stress, LTI cap | product snapshot (M4) + firm stress policy |

The **criteria pack itself is firm-authored curation, not client PII and not a
licensed lender database** — it is a set of the firm's own records of published
lender criteria (rule + `citedText` + `sourceRef` + `asAt`), content-hashed into a
`packRef`. No real lender-criteria data ships in this repo (FR-016).

## 4. Transparency (Art 13(2)(f)) & automated decisions (Art 22)

- **Art 13(2)(f) — meaningful information about the logic.** Every non-pass
  verdict carries **≥1 structured reason** — the cited rule text, the input value,
  its `det`/`syn` marker, and the delta — surfaced **inline** (keyboard-reachable,
  never hover-only) with the rule's `as-at` date behind a drawer. The affordability
  figure retains its **full working** step-by-step in an artifact. The logic of
  every call is inspectable, not a black box. (The word "provenance" never appears
  in the UI; the trust marker shows as a verified/synthetic dot + a board-level
  "N inputs synthetic" summary.)
- **Art 22 — no solely-automated decision with legal or significant effect.**
  This is the load-bearing control of M5. A single **`assertIndicative()`
  choke-point** gates every criteria/affordability surface + export and refuses,
  with a typed reason, any attempt to:
  - embed an A6/criteria figure into **any client view or client-comms artifact
    pre-G5** (`client-surface`);
  - present the output as anything other than indicative (`not-indicative`);
  - compute affordability on **unverified income** (`g9-unverified`);
  - embed on the wrong surface (`wrong-surface`);
  - quote a product from an M4 snapshot that no longer passes `assertClaimable`
    (`stale-product`).

  Every A5/A6 payload carries `surfaceClass:'adviser-only'` **structurally** (not
  UI hiding), and a CI test proves no client-facing component can decode or embed
  `lm.affordability.assessment/1`. The output is never a lender decision, never an
  eligibility statement, and never a guaranteed maximum (a copy/lint gate bans
  "eligible" / "guaranteed" / "whole of market"). **The recommendation stays a
  human G5 act — M5 never recommends.** A criteria **override** is a deliberate
  human act routed through **G6** (adviser-only, compliance-flagged): it shows the
  original machine verdict, forces a one-line rationale, states plainly that it
  raises a compliance flag, folds the original verdict + adviser id + rationale +
  flag, and never auto-applies; a stale-rule override records the staleness.

## 5. Retention (SYSC 9 / MCOB 4.7A.19R)

- The criteria assessment, affordability working, and scenario runs are
  **suitability evidence**: they show why the adviser considered or excluded each
  lender at the point of advice. They are retained for the **life of the advice
  file** per **MCOB 4.7A.19R** (suitability record) and the firm's general record
  obligation under **SYSC 9.1** (orderly records, sufficient to reconstruct the
  advice). Because the surface is pinned to a **pinned `packRef` + `caseFactsHash`
  + product snapshot**, a scenario run is **deterministically reproducible** — the
  audit reconstructs the exact figures the adviser saw, not an approximation.
- **Pack authorship** (who edited which rule, when) is folded onto the same
  tamper-evident case/firm log and retained with the pack it governs, so a rule's
  provenance is auditable for the life of any advice that relied on it.
- A full retention **UI**, SSO/RBAC, and an authoring console are **out of scope**
  for M5 (enterprise-readiness rides the M2 surface + the fold audit); the
  retention **posture** is documented here per FR-014.

## 6. Residual risk & controls

| Risk | Control |
|---|---|
| An indicative figure is shown to a client as a decision or a guaranteed max | `assertIndicative` refuses the client-surface / non-indicative embed (typed reason), enforced in the writer/fold; a CI test proves no client-facing component can embed A6; persistent non-dismissible indicative chrome + pinned honesty line on the surface. |
| Affordability computed on unverified income | `g9-unverified` refusal; a `syn` income never satisfies **G9**; the comparison renders an honest **blocked band** instead of a grid. |
| An excluded lender is silently dropped | Every non-pass verdict folds ≥1 structured reason; a no-rules lender reads **refer / "not assessed"**, never pass; the eval corpus asserts **why-not completeness** across the panel. |
| A stale product / criteria drives a live quote | `stale-product` refusal (snapshot must still pass `assertClaimable`); a stale rule forces a **refer** that notes staleness; a stale-pack comparison renders a blocked band. |
| The agent recommends, or an override applies silently | M5 never recommends (G5 stays human); an override is **G6**-gated, compliance-flagged, rationale-forced, and folds the original verdict — nothing auto-applies. |
| Real client PII / real lender-criteria data processed before sign-off | **Blocked** until §7 sign-off; the build + all eval numbers run on the synthetic 12-lender pack + synthetic applicant only (FR-016). |

## 7. Sign-off

- [ ] DPO review of the fact-find inputs, minimisation table (§3), and retention
      schedule (§5).
- [ ] Compliance approval of the adviser-only boundary + G5/G6 gating (§4) and the
      "no recommendation, no guaranteed max" copy posture.
- [ ] SIRO / firm principal approval to switch from the synthetic pack + synthetic
      applicant to real client facts and real firm-authored criteria.

_Until all three boxes are ticked, A5/A6 process synthetic data only._
