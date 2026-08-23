# UX Designer perspective on mesh-m5-criteria-affordability

## What I support
- Adviser-only enforcement in the writer/fold (`assertIndicative`), not UI hiding — the only honest way to guarantee A6 never leaks. Correct.
- `refer` (not silent pass/fail) when an input is syn/missing, with the missing input named. That maps to a real mental model: "I can't tell yet, here's why."
- Full working as a drawer/attachment, folded summary in the log. Right density call: the grid is the scan surface, the drawer is the audit.

## What I want changed (Dissent:)
- Dissent: "indicative" as a per-figure label will banner-blind advisers fast. Make it a persistent surface-level treatment, not repeated micro-labels: one pinned honesty line (like M4) + a non-dismissible surfaceClass chrome band on the whole board. Every number then inherits it visually without 40 repeated tags.
- Dissent: det/syn provenance "per input" will clutter the grid. Spec it as a two-state affordance — a `det`/`syn` dot per cell (with the M3 quote-locator on the det dot as a hover/click), and a single board-level "N inputs synthetic" summary. Don't print the word "provenance" anywhere in the UI.
- Dissent: "why-not on hover" fails keyboard and touch users and is undiscoverable. The why-not (failed rule + delta, e.g. "LTI 4.6 vs max 4.5") must be inline visible text on every excluded lender row, cited criteria text in the drawer — not hover-only.
- Dissent: G6 override as "a button on the board" is under-specified. It needs a confirm step that shows original verdict, forces the one-line rationale, and states in plain copy that this raises a compliance flag — before commit, since it's non-reversible in the fold.

## What I would not ship without
- Empty/blocked state copy for G9-not-verified: not "income not yet verified" alone — a state that names the blocking step and the action ("Verify income on the fact-find to run affordability"), with the criteria grid still shown (criteria doesn't need G9).
- Defined states for the two commonest failures: (1) stale pack — banner "Criteria as-at {date}; may be out of date" with per-rule as-at in drawer; (2) no sourcing snapshot — scenario still runnable on manual product terms, with an inline "add product terms" affordance.
- An explicit pessimistic-UI decision for scenario runs: these are deterministic computes with a G9 gate — no optimistic render. Show a skeleton grid while computing; never show a number that might vanish.

## Acceptance criteria from my lens
- Every excluded lender row shows a machine-readable why-not inline (rule + numeric delta), keyboard-reachable, with cited text in the drawer.
- One persistent adviser-only + indicative treatment; zero client-view render path (CI-proven).
- Scenario diff highlights lender flips (pass↔fail) and max/monthly deltas visually, not as raw before/after columns.
- G6 override cannot commit without rationale + confirm; folds the original verdict.
- Dark-mode contrast verified on the det/syn dots and pass/refer/fail states (these fail by default).

## Edge cases I want addressed
- Every panel lender fails/refers → grid must not read as "no results"; show "0 indicative passes" with the closest-miss ranked first.
- >4 scenarios (cap is 8) → how the board pages the side-by-side; which scenario is the pinned baseline.
- Override then underlying fact changes (verdict would flip anyway) → does the G6 flag stay, go stale, or re-raise? Surface it.
- Screen-reader order: grid must announce lender + verdict + why-not together, not as disconnected cells.
