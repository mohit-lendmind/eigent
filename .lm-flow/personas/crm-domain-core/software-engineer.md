# Software Engineer perspective on crm-domain-core

## What I support
- Pence as plain `number`, formatter beside the type. Correct call — persist envelopes JSON-serialize and bigint throws. Agree.
- Tone keys instead of hex — the token scan covers all of `src/`, so this is the only design that passes lint. Agree.
- Pure module-level completeness math, one-directional store deps, no UI/no network. This IS implementable in one autonomous run — everything is synchronous, local, and additive to the vitest baseline.
- Test strategy is ~100% unit, no mocks needed beyond localStorage (cleared by `test/setup.ts`). Clean pyramid.

## What I want changed (Dissent:)
- **Dissent: `FactFindField.v` typing is the #1 stall risk.** The design shows `v` as display strings (`'£42,000'`, `'2 yr 4 mo'`) but toggles are booleans and the architecture mandates pence. Spec must state exactly: is `v` a discriminated `string | number | boolean` keyed on `t`, and do money fields hold `Pence` or the design's display string? Fixtures cannot be transcribed until this is decided.
- **Dissent: `resolveConflict(caseId, fieldKey, resolution)` is underspecified** — the salary conflict lives on Daniel's `income` section; the signature needs `clientId` + `section` or a composite path.
- **Dissent: `removeClient` refusing when cases reference it inverts dependency direction** (clientsStore would import casesStore, which imports clientsStore). Put the guard in a facade/selector or at call sites.
- **Dissent: one `goldenPath.ts` will be 1,200–1,800 lines** (3 profiles ×~31 fields, 8 pipeline rows, 6 docs+insights, 6 worklist, 10 criteria with impacts arrays, 5+9 solver products, ~15 stream entries with verbatim trace quotes). Split into per-domain fixture modules re-exported from `goldenPath.ts`.

## What I would not ship without
- Exhaustive field-key enumeration per section (design §3.4) in the spec — not "see design reference".
- `assertNever` exhaustiveness on every union switch (stream kinds, worklist kinds, checklist statuses, criteria statuses).
- Per-store `JSON.stringify` round-trip test via `persist.getOptions()`.
- Named constants for headline numbers (85% LTV, 2.95× LTI, £242,250) shared by fixtures and tests.

## Acceptance criteria from my lens
- `pnpm type-check && pnpm lint && pnpm test` green; ≥60 new passing tests; baseline untouched.
- License header on every new `.ts`; no hex anywhere (including fixture strings); no forbidden-word (c*mel) matches in comments; no dead-brain identifier names.
- `seedCrmGoldenPath()` idempotent (double invocation, no duplicates); seeded selectors return 6 needs-you / 4 activity / 4 retention.

## Edge cases I want addressed
- Toggle `v: false` vs field absent; masked-NI unicode bullets surviving persist; `parseGbp` on negatives/pennies.
- `migrate` fed garbage/version-0 state; environment-key switch clears all four stores.
- Stream cap eviction order (keep latest 200 — assert in test); resolveConflict on a non-conflicted field is a no-op; dangling `clientId` in selectors returns placeholder.
- Two renderer windows sharing localStorage: persist does not cross-tab sync — document as known limitation.
