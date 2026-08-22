# Quickstart: validating mesh-m2-watcher-onboarding

## Prereqs
`pnpm install --frozen-lockfile`. No edge creds needed for the seeded journeys.

## Gates (CI parity)
```
pnpm type-check && pnpm lint && pnpm check:i18n && pnpm check:vitest-baseline && bash scripts/check-electron-access.sh
```

## The three journeys (vitest + storybook)
```
npx vitest run test/unit/crm/onboarding.test.ts        # J1 — G1 approve (US1/SC-001)
npx vitest run test/unit/crm/watcherPass.test.ts       # J2 — watcher pass (US2/SC-002)
npx vitest run test/unit/crm/queueModel.test.ts        # J3 — queue integrity (US3/SC-003)
npx vitest run test/unit/crm/convergenceWithAgents.test.ts  # SC-004
```

## The app (see it)
Launch the desktop app, open `/crm` from the nav entry → the Today needs-you queue renders from the seeded demo case → open the G1 onboarding card (full draft + provenance) → edit + Approve & send → the send logs to the case. Run a watcher pass (dev button) → a remortgage proposal + a stalled-case chase appear, SLA-sorted.

## The demo (SC-007)
```
node scripts/demo-mesh-m2.mjs   # seed case → watcher pass → onboarding draft → G1 approve → logged; prints evidence
```

## Contract references
Frozen surfaces: [contracts/](contracts/) — the M3 build-against boundary. Entities: [data-model.md](data-model.md). Decisions: [research.md](research.md).
