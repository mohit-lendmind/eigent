# UX Designer perspective on mesh-m2-watcher-onboarding

## What I support
- Pessimistic gate resolve (waits for `approval_resolved`, never optimistic). Correct for a regulated sign-off. Agreed.
- Watcher proposes-only in M2 — fewer surprises on the adviser's first surface. Agreed.
- Reusing `HomeHubListTable` rows + registry-driven cards. The data is already there: my M1 dissent put `tier`/`slaMinutes`/`batchable` on `GateDescriptor`; the card must actually render them.

## What I want changed (Dissent:)
- **Dissent: gates are interrupts, not rows.** Merging live gate-approvals into the same visual class as folded worklist items flattens "the agent is blocked on my decision" into "a note." Gates pin to top, carry the SLA timer, read as a distinct card class. Order the merged list by priority (SLA-remaining → tier → age), never naive recency — else an at-SLA G1 buries under fresh low-value worklist noise.
- **Dissent: every row needs a source/freshness badge** — `live · as-of 10:42 · stale`. Persistent items carry the fold watermark (my M1 `lastFoldedAt`); live approvals are realtime-when-subscribed. Side by side unmarked, the adviser can't tell fresh from stale, and a gate resolved elsewhere leaves a stale echo.
- **Dissent: the G1 card must show the full draft + inline edit + provenance**, not approve/reject on gate metadata. First real case = "an AI wrote to my client." Trust dies if they can't read the whole message, edit before send (v1 send is manual anyway), and see the disclosure ref and why each checklist item. Settle arch open-Q#4 here: bespoke `GateCard`, built to G4b's shape now (tier/SLA visible, batch-select present-but-inert) so M6 isn't a re-plumb.
- **Dissent: name the tabs.** "Today / needs-you" is two axes (time vs blocked-on-me). One list → one name; two lists → define the split.

## What I would not ship without
- **A loud degraded state when ONE source fails.** If the live aggregator dies but fold loads, the adviser sees a plausible list silently missing approvals — a missed regulated sign-off. Banner: "Live approvals unavailable — you may be missing items. Retry." Non-negotiable.
- **Four distinct queue states, real copy:** first-run ("Nothing needs you yet — the watcher surfaces decisions here"), all-clear ("You're caught up" — positive, not broken-looking), loading (skeleton rows; partial-source resolve is fine), degraded (above). One boolean can't carry four.
- **A nav entry to `/crm`.** A sibling route with no entry point is URL-only and undiscovered.
- **Pending-submit lock on Approve** + confirm-timeout ("couldn't confirm; check the case"), never an infinite spinner.

## Acceptance criteria from my lens
- Merged queue sorts by a defined priority key; fixture: an at-SLA G1 outranks a just-raised tier-3 worklist item.
- Each row asserts a source badge; a gate resolved elsewhere reconciles (no stale echo) within one aggregator re-read.
- G1 card renders draft body + editable field + disclosure ref, and locks on submit until `approval_resolved`.
- A live approval arriving mid-session announces `aria-live=polite`, does NOT steal focus; the SLA timer is text, not a ticking live region.

## Edge cases I want addressed
- Case whose project isn't yet subscribed: is its pending gate visible or silently absent? If absent, count it in the degraded banner.
- Approve G1, then session drops before `approval_resolved`: card state on reconnect?
- Dark mode: CrmTone anchors are light-mode hex and Storybook is forced-light — the queue advisers stare at all day is contrast-unverified in dark. Flag as a risk now.
- Mis-logged manual send (send happens outside the app in v1): correction = append a correction (M1 record-never-repair), not edit.
