# Implementation Plan: mesh-m1-contracts-audit-spine

**Branch**: `lendmind-crm` (spec authored here; implementation runs on `feature/mesh-m1-contracts-audit-spine` cut from it) | **Date**: 2026-08-22 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/002-mesh-m1-contracts-audit-spine/spec.md`; authoritative architecture `.lm-flow/architecture/mesh-m1-contracts-audit-spine.md` (component paths, seams, and phasing are decided there — this plan transcribes and elaborates, it does not re-derive).

## Summary

M1 ships the agent mesh's contract layer and audit spine as pure renderer TypeScript extending the merged F01 domain layer: (1) `src/crm/agentContracts/` — hand-written types + `decode*`/`is*` pairs (house `contracts.ts` pattern, NOT zod) for the directive envelope, per-agent artifact kinds A1–A8 + typed failures, the `lm.caselog/1` chained event-log entry, gate registry G1–G10 as data, and per-firm config; (2) the artifact-canonical fold — `lm/case/` artifacts are the source of truth, the four F01 zustand stores demote to a derived cache, with a fifth persisted store (`crm-eventlog-store`) for watermarks/pending/quarantine/outbox; (3) the audit spine — sha256-over-canonical-JSON hash chain, a minus-writer-fields settle hash, and case-file export v2 that proves its own integrity. Plus the scripted tamper demo and the M2 rendering contract. Zero new dependencies, zero UI, zero new endpoints.

## Technical Context

**Language/Version**: TypeScript 5.x (repo's existing config; `tsconfig.build.json` is the type gate)

**Primary Dependencies**: none added. Uses existing: zustand v5 (`persist`), WebCrypto (`crypto.subtle`), the aion v1 client (`src/api/aion/v1/` — READ-ONLY, never modified), F01 domain layer (`src/crm/`)

**Storage**: zustand persist → localStorage (fifth store `crm-eventlog-store`, house checklist: `storageEnvironmentKey`, migrate + shape repair, partialize, `resetForTests`, key registered in `CRM_LS_KEYS`/`clearAllCrmState`); canonical data lives on the aion edge as artifacts

**Testing**: vitest 2.1 (jsdom, `test/setup.ts`); colocated unit tests + `test/unit/crm/` invariant tests; golden fixture log under `src/crm/fixtures/caselog/`; WebCrypto canary added to `test/setup.ts`

**Target Platform**: Electron renderer + web build (same as F01; no electron-main changes)

**Project Type**: desktop-app domain layer (renderer-only module)

**Performance Goals**: fold of 1,000-entry log < 500 ms on case open (excluding network); zero re-render storms (referential no-op on replay)

**Constraints**: no new deps; `src/api/aion/v1/**` frozen; ESLint FR-014 store layering (fold is downstream of all four stores; upstream writes via `_bus.ts`); attachments route carries no Idempotency-Key (retry safety = CAS dedupe + settle-by-hash); artifact inline read ≤ 1 MiB; attachments ≤ 3 MiB; vitest baseline must not move; every CI gate green

**Scale/Scope**: ~14 new source files in `src/crm/{agentContracts,fold}/` + `hashChain.ts`, 3 modified (`caseFile.ts`, `domain/ids.ts`, `domain/types.ts`, `_bus.ts`, `index.ts`, `seed.ts` at most), ~20 new test files, 7 frozen `.d.ts` contracts, 1 demo script

## Constitution Check

`.specify/memory/constitution.md` is the unfilled template — no project constitution is ratified. Gates applied instead (from the architecture's constraints): no-new-deps ✓ · aion-client-frozen ✓ · store-layering-lint ✓ · no-UI/i18n/token deltas ✓ · baseline-unmoved ✓. No violations to justify; Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/002-mesh-m1-contracts-audit-spine/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions transcribed from architecture + persona resolutions
├── data-model.md        # Phase 1 — entities, fields, invariants
├── quickstart.md        # Phase 1 — the scripted demo as a validation guide
├── contracts/           # Phase 1 — frozen .d.ts surfaces (FR-006)
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
src/crm/
├── agentContracts/
│   ├── index.ts             # package barrel (re-exported from src/crm/index.ts)
│   ├── errors.ts            # ContractDecodeError + helpers
│   ├── envelope.ts          # DirectiveEnvelope decode/encode/hash (FR-001)
│   ├── artifactKinds.ts     # A1–A8 + lm.failure kinds, classifyKind quarantine router (FR-002)
│   ├── caseLog.ts           # lm.caselog/1 entry + event union + chain-anchor (FR-003, T3)
│   ├── gates.ts             # GATE_REGISTRY G1–G10 as data (FR-004)
│   ├── firmConfig.ts        # lm/config.json decode + defaults (FR-005)
│   └── reasonCodes.ts       # fold reason-code table (T5, FR-014)
├── fold/
│   ├── eventLogStore.ts     # 5th persisted store: watermarks/pending/quarantine/outbox (FR-011..13)
│   ├── caseLogFold.ts       # ordered idempotent serialized apply (FR-007..10, FR-014)
│   ├── foldSource.ts        # notice + fetch inline + decode (triggers: open/live/refresh)
│   └── outbox.ts            # record/flush/settle, LWW kinds only (FR-018..20, T1)
├── hashChain.ts             # sha256HexCanonical, computeEntryHash, settleHash, verifyChain (FR-016/17)
├── caseFile.ts              # MODIFIED: export v2 + dual-version import (FR-021); canonicalise stays
├── _bus.ts                  # MODIFIED: + EventLogSideBus (loud, FR-020)
├── domain/ids.ts            # MODIFIED: + 'outbox' | 'quarantine' prefixes (FR-024)
├── domain/types.ts          # MODIFIED: + Case.aionProjectId?, ActivityEvent.origin? (additive)
├── index.ts                 # MODIFIED: barrel additions
└── fixtures/caselog/        # golden c417 event log + negative fixtures (manifest-driven)

test/unit/crm/               # invariant tests: convergence, killTheLaptop, tamper, quarantineRefold,
                             # crossStoreImports (extended), settle, persist round-trip (extended)
test/setup.ts                # MODIFIED: WebCrypto canary (FR-016)
scripts/demo-mesh-m1.mjs     # the scripted tamper demo (FR-022) — runs vitest journeys + prints evidence
eslint.config.js             # MODIFIED: ban store→fold/* static imports (FR-018)
```

**Structure Decision**: single-project renderer module; all new code under `src/crm/` per F01 precedent; invariant tests under `test/unit/crm/` per house split (unit logic colocated, architecture invariants centralized).

## Phase ordering (from architecture `## Phasing`, elaborated)

- **P0 (gate)**: merge `fix/crm-review-iter1` (worktree commit, currently 4d45a196 rebased on lendmind-crm) into the feature branch FIRST; add one regression test per review finding (FR-023). Nothing else starts until the 108-test suite + new regressions are green.
- **P1 Contracts & audit primitives**: `agentContracts/` + `hashChain.ts` + `reasonCodes.ts` + golden fixtures + frozen `.d.ts`. Success: FR-001..006, FR-016/17 tests green; type-check/lint green.
- **P2 The fold**: `eventLogStore` + `caseLogFold` + `foldSource` + domain additive changes + lint/invariant extensions. Success: US1 scenarios 1–5, SC-001, SC-003; M2 is UNBLOCKED at P2-merge (T2).
- **P3 Outbox & export v2**: `outbox.ts` + `_bus` extension + `caseFile` v2 + demo script + quickstart. Success: US2/US3 scenarios, SC-002/004/007.

## Complexity Tracking

None — no constitution violations to justify.
