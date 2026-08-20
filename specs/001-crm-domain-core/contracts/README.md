# Contracts — crm-domain-core

The public surface of the `src/crm/` domain layer. These `.d.ts` files are **contracts** — the shape of the API that F02–F17 will import and that the vitest suite exercises. They are not the implementation.

## Files

| Contract | What it defines |
|---|---|
| [`stores.d.ts`](./stores.d.ts) | The four zustand stores' state shapes and action signatures (`useCrmClientsStore` / `getCrmClientsStore` and siblings), plus the atomic `resolveConflict` orchestration signature. |
| [`selectors.d.ts`](./selectors.d.ts) | Pure cross-store selector signatures returning stable empty constants. Includes `selectNeedsYou`, `selectPipelineCounts`, `selectOpenConflicts`, `selectRetentionUrgency`, `selectCaseStreamSections`, `selectDetSynCounts`, `selectCaseCompleteness`. |
| [`export.d.ts`](./export.d.ts) | `exportCaseFile`, `importCaseFile`, `clearAllCrmState`, `CaseFileExport` envelope shape. |
| [`integrity.d.ts`](./integrity.d.ts) | `crmIntegrityRepair`, `RepairReport` shape, `getLastRepairReport`. |

## Import discipline

- Consumers (F02+) import from `src/crm/index.ts` (the public barrel). Nothing outside `src/crm/` reaches into `src/crm/domain/` or `src/crm/fixtures/` directly (except tests).
- Cross-store integration inside `src/crm/` is one-directional (spec FR-014): `documents → cases → clients`, `workstream → all three`. Enforced by ESLint `no-restricted-imports` and by a dedicated cross-store-imports test.

## What the contracts DO commit to

- **Argument and return shapes** — including discriminated-union `FieldValue`, branded `Pence`, and every `origin?` seam (spec FR-002).
- **Return-value contracts on error paths** — typed refusals like `{ok:false, reason:'referenced_by_case', caseIds}` (spec FR-016), never a throw.
- **Idempotence guarantees** on `seedCrmGoldenPath`, `resolveConflict`, `importCaseFile` (spec User Story 1 acceptance #2, User Story 2 acceptance #5, FR-041).
- **Atomicity of `resolveConflict`** — one `setState` per affected store, no partial-state observability.
- **Empty-state stability** — selectors return `EMPTY_ARRAY` / `EMPTY_MAP` shared constants (spec FR-043).

## What the contracts DO NOT commit to

- Internal helper signatures inside stores (implementation is free to refactor).
- Fixture data shape (documented in `data-model.md` § 6; fixtures are internal to `src/crm/`).
- Test fixture reset idiom (documented in `quickstart.md`).
