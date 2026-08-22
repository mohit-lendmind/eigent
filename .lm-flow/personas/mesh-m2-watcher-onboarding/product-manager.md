# Product Manager perspective on mesh-m2-watcher-onboarding

## What I support
- The scope shape: thin surface ships with the first agents (gates without UI = dead letters — agreed). Propose-only watcher is the right teeth-level given docintel/sourcing don't exist yet: stage/time triggers (stalled-case chase, fixed-rate radar, next-step nudge) are real adviser pain, not filler.
- The artifact→fold seam already proven — M2 writes `lm/case` entries, M1 consumes them. That's the core de-risker.
- Budget FX/breaker/supervision as first-class; the "who watches the watcher" plane doubles as my metrics substrate.

## What I want changed (Dissent:)
- **Dissent (no persona):** the doc names no user. Name them — a directly-authorised adviser running ~40 live cases, today tracking next-steps in their head and hand-drafting doc-requests. Every acceptance test should trace to that person.
- **Dissent (no metrics):** engineering criteria per phase, zero product metrics. Instrument two leading indicators from day one via the supervision plane: watcher-proposal **acceptance rate** (accepted vs dismissed) and **case-create → G1-sent** latency.
- **Dissent (portal split):** deferring web infra is defensible for an installable desktop demo, and §8.4 covers *outbound* send — but §8.1/§4-A1 fix *inbound collection* as the portal, overturning email. So M2 onboarding drafts a request with no return channel. Do not let "client emails docs back" become the interim default — that reopens the exact PII/phishing surface §9 closed. Mark interim collection "adviser-logged manual"; M-portal must be the *next* milestone, not vaguely "later."

## What I would not ship without
- The activation moment landed in the demo: the adviser approving a G1 draft **good enough to send unedited**, with correct MCOB 4.4A refs from firm config (compliance-verified, not placeholder). A visible queue is not activation; approving a real draft is.
- One watcher trigger that is genuine chase-work, not a restatement of state.
- A failure metric defined before ship (e.g. proposal dismiss-rate above X → retune/roll back).

## Acceptance criteria from my lens
- Founder installs, opens `/crm`, sees a needs-you queue with (a) an A1 onboarding gate card and (b) ≥1 A2 item from a `*/5` pass over seeded cases.
- Approving G1 logs a manual send; disclosure refs present and correct.
- Proposal acceptance-rate and onboarding latency queryable from supervision selectors.
- Propose→dispatch documented as *additive* (a worklist-raising decision can later route to dispatch) so M3 docintel plugs in without rewriting the trigger matrix.

## Edge cases I want addressed
- Watcher re-proposes a rejected G7 transition next pass → nag loop; need a dismissed-suppression window.
- Onboarding differs across remortgage / purchase / product-transfer — the demo must not show purchase only.
- Seeded demo firm must carry an FX rate, or `budget.ts` refuses and the demo dead-ends.
- Breaker trip mid-demo must stay visible in the queue, never silently drop (verify in UI).
