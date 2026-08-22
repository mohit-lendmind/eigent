# Quickstart: validating mesh-m1-contracts-audit-spine

This is the validation/run guide (and the scripted compliance demo, FR-022/SC-007). It proves the three journeys end-to-end with no UI and no live edge — fixtures stand in for the artifact plane.

## Prerequisites

```bash
pnpm install --frozen-lockfile
```

Node ≥ 18 < 23 (the vitest baseline warns outside this range). No edge credentials needed — everything runs against the golden fixture log.

## 1. The full gate set (what CI runs)

```bash
pnpm type-check && pnpm lint && pnpm check:i18n && pnpm check:vitest-baseline && bash scripts/check-electron-access.sh
```

Expected: all green; baseline unmoved (FR-025 / SC-008).

## 2. The three journeys (vitest)

```bash
npx vitest run test/unit/crm/killTheLaptop.test.ts      # Journey 1 — converge (US1 / SC-001)
npx vitest run test/unit/crm/tamperExport.test.ts       # Journey 2 — tamper-evident export (US2 / SC-002)
npx vitest run test/unit/crm/outboxSettle.test.ts       # Journey 3 — outbox round-trip (US3 / SC-004)
```

Expected outcomes per journey are pinned in the spec's User Journeys section; the tests assert them verbatim (byte-identical snapshots, brokenAtSeq named, exactly-once settle).

## 3. The scripted compliance demo (SC-007)

```bash
node scripts/demo-mesh-m1.mjs
```

Runs unattended in < 5 minutes from a clean checkout:
1. folds the golden c417 log → prints converged watermark + chain-verified ✓
2. wipes all five stores → refolds → prints byte-identical confirmation
3. flips one byte in one entry → refolds → prints `chainVerified: false`, `brokenAtSeq`
4. feeds an unknown-major artifact → prints quarantine pointer + cumulative count
5. exports v2 before/after → prints both envelopes' integrity fields

Evidence lands in `test-results/demo-mesh-m1/` (JSON envelopes + a transcript).

## 4. Full CRM suite

```bash
npx vitest run src/crm test/unit/crm
```

Expected: 108 pre-existing tests + all new M1 tests green.

## Contract references

- Frozen surfaces: [contracts/](contracts/) — the M2 build-against boundary (FR-006)
- Entities & invariants: [data-model.md](data-model.md)
- Decisions & rationale: [research.md](research.md)
