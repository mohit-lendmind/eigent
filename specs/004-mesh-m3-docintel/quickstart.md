# Quickstart: mesh-m3-docintel
`pnpm install --frozen-lockfile`. Synthetic fixtures only.
Gates: `pnpm type-check && pnpm lint && pnpm check:i18n && pnpm check:vitest-baseline && bash scripts/check-electron-access.sh`
Journeys: `npx vitest run test/unit/crm/docintelExtract.test.ts` (J1) · `docintelConflict.test.ts` (J2) · `redteamWrite.test.ts` (J3, hard gate).
App: upload a fixture payslip in the doc vault → PROCESSING→COMPLETED → income det with clickable quote → checklist received → d7 conflict fires G3.
Contracts: [contracts/](contracts/). DPIA: docs/dpia-docintel.md.
