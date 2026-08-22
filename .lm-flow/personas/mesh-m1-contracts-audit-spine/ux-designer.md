# UX Designer perspective on mesh-m1-contracts-audit-spine

## What I support
- Loudness doctrine (record-never-repair, no silent drops) is exactly what the Today queue needs. Agreed.
- Optimistic local apply + settle-by-hash is the right call for adviser edits — decided explicitly, good.
- Quarantine keeps full payload with a surfaced count; gates as data ready for M2 cards. Agreed.

## What I want changed (Dissent:)
- **Dissent: system-raised worklist items must carry a structured `reasonCode` + params, not prose.** Fold-layer English strings become the de facto copy and dodge i18n (a CI gate!). Surfaces render localized, actionable copy from codes; export keeps the code.
- **Dissent: no dedup key is specified for gap/chain-break worklist items.** A gap persisting across five refreshes must upsert ONE item (key: `caseId+reasonCode+seq`), not spam five. `worklist-upsert` exists — mandate its use with a stable id.
- **Dissent: `GateDescriptor` omits triage tier and SLA timer fields** despite spec §5 marking gate ergonomics *binding*. Add `tier` and `slaMinutes` now; M2 cards shouldn't re-plumb the registry.
- **Dissent: eventLogStore must expose per-case freshness** (`lastFoldedAt`, `sourceStatus: 'live'|'idle'|'error'`). The no-push-without-session gap means the Today queue WILL show stale data; without a timestamp it can't say "as of 10:42".

## What I would not ship without
- Distinguishable empty states in `FoldReport`/store: never-fetched vs fetched-and-empty vs fetch-failed vs no-`aionProjectId`. Four different screens; one boolean can't carry them.
- A defined recovery action on the chain-break item. "Fold halted" with no next step is punishing — specify re-verify/refetch-from-artifacts (or explicit "export + escalate") in the reason code.
- An "unsettled" flag queryable per outbox-originated entry, so the case stream can badge unsynced edits.

## Acceptance criteria from my lens
- Every failure-mode row in the table maps to a reason code with: severity, dedup key, recovery action id. Fixture test asserts no duplicate item after repeated refresh over the same gap.
- Quarantine badge count survives eviction (evicted items still counted, e.g. `totalSeen` vs `retained`).
- `refreshCaseLog` resolves with a report a surface can render as skeleton→content→error without peeking at internals.

## Edge cases I want addressed
- Outbox write refused at quota mid-edit: refusal must reach the calling store action synchronously, not just a worklist item discovered later.
- Duplicate-seq anomaly and gap on the same case: two items or one? Define.
- Chain break, then adviser keeps editing: are local writes still accepted on a halted case? Say so.
