# Product Manager perspective on mesh-m3-docintel

## What I support
- **Right next value.** M2 tracked and chased; M3 is the first agent that removes adviser keystrokes — reads a doc, fills the fact-find. First visibly *smart* moment; the `adviser-minutes-saved` §7 promised.
- **Buildable and verifiable tonight** (no external access), riding M1's fold and M2's dispatch/vault — the most de-risked milestone, take it while sourcing is blocked.
- **Quote-locator rejection filter is right.** A wrong `det` field poisons the audit record we sell; under-fill beats mis-fill.
- **Checklist auto-reconcile closes M2's loop** — the onboarding checklist only pays off when arriving docs flip items to received unattended.

## What I want changed (Dissent:)
- **Dissent (no persona):** name them — the directly-authorised adviser, ~40 cases, today hand-typing gross/net from a payslip PDF and eyeballing for conflicts. Every test traces to killing that rekey.
- **Dissent (≥0.95/≥50-real gate blocks indefinitely):** corpus sourcing is a founder input (open-q #2) with no owner, no date. Split it. (a) Synthetic + malicious-PDF red-team = hard blocker to merge/demo tonight. (b) The ≥0.95-on-≥50-real bar gates the external accuracy *claim* and G9 autonomy, not the build. Name the owner (design-partner #1) and a date, per the connector-access precedent — else M3 is done-but-unclaimable.
- **Dissent (no product metric, again):** instrument fields auto-filled/doc (det vs syn) and % `det` accepted unedited, via M2's supervision plane.

## What I would not ship without
- **Activation moment:** drop a payslip → income lands as `det` with a clickable quote+locator, checklist flips to received, adviser edits nothing. Unedited extraction is "got it."
- **The d7 £38,500/£37,300 conflict firing G3 visibly** — proves cross-doc value beyond OCR.
- **Failure metric:** `det` later corrected by adviser above X% → guardrail failed; retune before any accuracy claim.
- Corpus owner + date named.

## Acceptance criteria from my lens
- Seeded case: payslip → income `det` w/ quote+locator, checklist → received; joint/ambiguous doc raises G2; d7 fires G3.
- `lm.docintel.extraction/1` **frozen and documented as the fact-find's field-provenance source** so M4/M5 read det/syn+hint without rework — the done-for-downstream test.
- det/syn counts + accept-unedited rate queryable; G9 blocks recommendation-ready until income det-verified.

## Edge cases I want addressed
- Same figure in two docs → reinforce, must **not** fire G3 spuriously.
- Doc for a client not on the case → attribution fails to G2, never silent attach.
- Corpus never arrives → M3 ships "det-precision unclaimed"; define that state so it doesn't read as broken.
- Redaction boxes OCR'd as garbage → typed failure, never a hallucinated `det`.
