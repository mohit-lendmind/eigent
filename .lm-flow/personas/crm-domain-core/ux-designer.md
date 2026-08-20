# UX Designer perspective on crm-domain-core

## What I support
- `src: 'det'|'syn'` on every fact-find field, `conf` on insights, `confidence`/`calibration` on traces — provenance and confidence rendering are expressible. Good.
- Tone keys instead of hex in the stage catalog. Contrast and dark mode get handled once, centrally.
- `PROCESSING` document status and `live` stream kind give me real loading states, not fake spinners.
- Dev-gated explicit seed (not auto-run) — I can design a true first-run empty state and a demo state separately.
- Selectors returning Today-screen counts from seeded state means density decisions are testable.

## What I want changed (Dissent:)
- **Dissent: conflicts are a boolean flag.** `conflict?` on a field can't render the £38,500 vs £37,300 affordance. A conflict must carry both competing values, each with source (doc id / field origin) and timestamps. Same for `DocInsight.conflict`.
- **Dissent: undo is not modeled.** "Records prior value into an audit note" is prose, not a shape. `setFactFindField` and `resolveConflict` must produce a typed prior-state record (`{ prevValue, prevSrc, at, actor }`) so UI can offer one-tap revert. Irreversible conflict resolution is a support-ticket factory.
- **Dissent: silent repair.** `migrate`/microtask pruning that only `console.warn`s means users see rows vanish with no explanation. Store a non-persisted `lastRepairSummary` the UI can surface.
- **Dissent: silent stream cap.** Pruning to 200 entries in `partialize` must leave a `truncatedCount`/marker so the activity view can say "older activity archived", not just end.

## What I would not ship without
- Confidence scale pinned in types (0–1 float vs banded enum) — UI can't mix scales.
- `confirmSynthesizedField` recording `confirmedAt`/`confirmedBy` — "AI-suggested, you confirmed" is the core trust affordance.
- Worklist items retained with `resolved` status + timestamp, never deleted (answers the open question).
- Typed placeholder shape for dangling refs — not `undefined`.

## Acceptance criteria from my lens
- From any seeded field I can render: value, source badge, confidence, conflict detail with both sides, and a revert path — using types alone.
- Empty stores vs environment-cleared stores are distinguishable in state.
- `computeSectionCompleteness` returns a defined value for 0-field sections (no NaN).

## Edge cases I want addressed
- Case with zero applicants; applicant with empty profile.
- Document completing with zero insights.
- Retention entry exactly at 90 days.
- Conflict where both values come from `syn` sources.
