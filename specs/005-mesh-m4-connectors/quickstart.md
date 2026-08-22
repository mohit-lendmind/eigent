# Quickstart: mesh-m4-connectors
`pnpm install --frozen-lockfile`. MSE public; licensed scaffolds run on recorded fixtures.
Gates: `pnpm type-check && pnpm lint && pnpm check:i18n && pnpm check:vitest-baseline && bash scripts/check-electron-access.sh`
Journeys: `npx vitest run test/unit/crm/sourcingMse.test.ts` (J1, pure replay) · `assertClaimable.test.ts` + `noClientEmbed.test.ts` (J2/invariant 2) · `evidenceExport.test.ts` (J3).
Live canary (nightly, MSE): `EIGENT_EVAL_DIR=/abs npx playwright test --config e2e/eval.config.ts connector-mse`.
App: trigger sourcing on a fact-find-complete case → visible browser drives MSE with the narrating ribbon + take-control → adviser-only ranked cards + pinned coverage line → G5 pick+rationale.
Contracts: [contracts/](contracts/).
