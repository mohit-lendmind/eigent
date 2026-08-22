# Principal Architect perspective on mesh-m2-watcher-onboarding

## What I support
- Directive-as-artifact + `command_id ↔ directiveIdentity` mapping at one call site — matches transport: `submitCommand`'s Idempotency-Key IS `command_id` (transport.ts:202). Sound.
- Fail-closed on absent FX (refuse, raise config worklist); static FX over fetched — budget decisions stay reproducible.
- Watcher proposes-only for M2; no writes to frozen `src/api/aion/v1/**`; M1 fold consumed read-only.

## What I want changed (Dissent:)
- **Dissent: the single `lm/firm/<firmId>/cases.json` index is a lost-update hazard.** `uploadAttachment` (transport.ts:373-378) has no If-Match and no Idempotency-Key; artifacts are append-only, versioned-by-name, and nothing records that v2 supersedes v1 (artifactsStore.ts:289). Two onboarding runs racing on new cases → read-modify-write lost update, and the watcher's "latest" silently drops one. Your Q2 flags this but the diagram and A2 hardcode one file. Fix: one pointer artifact per case (`…/cases/<caseId>.json`); enumerate by name-prefix listing.
- **Dissent: the cross-project pendingGates aggregator is a subscription leak.** Live approval state needs one SSE/reducer subscription per active case's project; 200 active cases = 200 held-open streams for one queue. Mirror `approval_required`/`approval_resolved` into the M1 fold, source the queue from the persistent selector, and keep a live reducer subscription only for the single open gate card — that is all "wait for approval_resolved" needs.
- **Dissent: M2 is two runners.** P4 (route/layout/rail/queue/gate cards/tones/primitives/11-locale i18n/stories) renders from seeded M1 state and depends on P1–P3 only through the aggregator. Split: agents+invocation vs thin surface. Ship independently.

## What I would not ship without
- Per-case pointer artifacts (no shared mutable index).
- FX rate value + effective-date **stamped into each spend/supervision record** — a later config change must not reprice historical audit rows.
- A `passId` correlation id threaded watcher-pass → every decision + supervision record.
- `lm.watcher.decision/1` carrying a dispatch-ready directive payload (same envelope `dispatch.ts` consumes), so M3 flips propose→dispatch by adding a consumer, not rewriting.
- Explicit "single desktop = single firm" tenancy line.

## Acceptance criteria from my lens
- Two cases onboarded concurrently: both survive the firm index (no lost update).
- Queue renders with zero cross-project live subscriptions when no gate card is open.
- Retried directive publish (response lost): duplicate detected at fold via directive identity carried in the artifact body — command submitted at most once.
- FX config changed after a run settles: historical GBP figures unchanged.
- Watcher pass killed mid-flight: next pass reconstructs from log heads, no double-decision.

## Edge cases I want addressed
- Coordinator project absent/deleted → watcher re-mints, does not silently stop.
- `*/5` fires while the prior pass still runs — is a pass reentrant / passId-deduped?
- Breaker trips mid-pass: no case left holding half a decision.
- Firm index paging past one page of per-case pointers.
- Pointer for a case whose project was never bound.
