# UX Designer perspective on mesh-m4-connectors

## What I support
- LB4 reuse — visible window + take-control, under the adviser's login. Agreed.
- Pessimistic surface: the shortlist appears only when the snapshot folds. No mid-scrape flicker.
- Adviser-only; G5 is a human action, not agent output.

## What I want changed (Dissent:)
- **Dissent: the computer-use moment needs a narrating overlay, not a raw browser.** Watching an agent type into your logged-in session is unnerving. Add a step ribbon ("Entering income £48,200 · reading 34 products") + a persistent, always-hot "Take control" that freezes it mid-step and yields the cursor — never buried. Label whose login: "Running as you".
- **Dissent: the shortlist is not a table.** True-cost + why-not + APRC as a grid is unreadable. Use ranked cards: lender, monthly, true-cost-over-deal-period (the one number), a "Why?" disclosure. Rejected lenders collapse under "N not shortlisted", each showing one plain sentence ("Rate higher at this LTV").
- **Dissent: verified:false can't be a small grey tag.** A scaffold result in the live visual class will reach a client. Provisional results get a watermark band + "Not for client use — awaiting verified feed"; export / "add to suitability" is disabled, not just labelled.

## What I would not ship without
- **Coverage statement pinned to the list header — honest, not alarming:** one line, always visible: "Based on MSE best-buys — direct + most broker deals. Not whole of market." Never red, never dismissable.
- **A G5 that resists rubber-stamping:** Recommend stays disabled until the adviser picks a product AND types a one-line rationale; that choice + rejected-reasons snapshot fold.
- **Typed failure, not stall:** portal drift/challenge → failure card + screenshot + "Take control to continue". Never a spinner.

## Acceptance criteria from my lens
- Live run shows the step ribbon + hot take-control; clicking freezes within one step.
- Shortlist renders as ranked cards; rejected lenders collapsed, one-sentence why-not each.
- A verified:false adapter's results are watermarked and cannot be exported / added to suitability.
- G5 Recommend disabled until product + rationale entered.

## Edge cases I want addressed
- Zero results: escalate copy, never a blank list.
- Coverage line never below the fold, never exceeded by any evidence label (invariant 4).
- Dark mode: watermark + coverage contrast unverified (Storybook forced-light) — flag now.
- Session drops mid-scrape: a partial snapshot must not fold as complete.
