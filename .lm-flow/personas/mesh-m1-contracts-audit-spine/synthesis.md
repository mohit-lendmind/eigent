# Synthesis: mesh-m1-contracts-audit-spine

Five personas, 2026-08-22. Sources: ux-designer.md, principal-architect.md, software-engineer.md, product-manager.md, head-of-sales.md (same directory). Architecture: `.lm-flow/architecture/mesh-m1-contracts-audit-spine.md` (corrected post-review: attachments carry no Idempotency-Key — retry safety is CAS dedupe + settle-by-hash; `Case.aionProjectId` is an additive M1 field, not existing F01).

## Unanimous requirements (no seat opposed; ≥2 seats demanded)
1. **`firmId` stamped in `lm.caselog/1` now** (Sales, Architect, PM — resolves architecture open question 5 as YES; the field is cheap, the migration is not, and five design-partner firms is multi-firm from pilot day one).
2. **Settle-hash contract pinned in M1**: sha256 over the canonical entry MINUS writer-assigned fields (`seq`, `prevHash`, `hash`) — a full-content hash of the canonical echo can never match the unsequenced outbox candidate (Architect ship-blocker; Engineer's CAS-dedupe correction depends on the same hash).
3. **Quarantine is audit-grade**: pointer records (artifactId/version/contentHash/reason/≤16 KB preview), NOT verbatim payloads (Engineer: localStorage quota + persist re-stringify cost); permanent tombstones (hash/kind/timestamp) that survive eviction (Sales); cumulative ever-count, not retained-count (PM). These compose — adopt all three.
4. **Loudness is structured, deduplicated, and countable**: fold-raised worklist items carry `reasonCode` + params, never baked prose (UX — prose in the fold bypasses i18n); stable dedup ids `caseId+reasonCode+seq` so a persisting gap upserts one item, not one per refresh (UX); distinct worklist kinds for gap vs chain-tamper (Architect); visible counters, not `console.warn` (PM).
5. **Per-case serialized fold with zero awaits between watermark re-check and apply** (Engineer: case-open refresh racing a live notification can double-apply across the hash `await`; drain pattern = `browserDelegationExecutor` precedent; Architect's convergence discipline requires the same).
6. **Env-key wipe policy splits source from derived** (Architect): watermarks/pending/quarantine are derived (wipe + refold); unflushed outbox is SOURCE data (adviser edits, unreconstructable) — never wiped, never evicted; quota-pressure refusals are synchronous and typed (UX).
7. **Outbox bus is loud from birth** (Engineer): `EventLogSideBus` registered via barrel side-effect import; unwired dispatch throws in dev / console.error + queues in prod; ESLint `no-restricted-imports` and `crossStoreImports.test.ts` extended to ban store→`fold/*` static imports.
8. **The scripted demo is a named deliverable with its own success criterion** (PM, Sales): fold c417 fixture log → wipe all five stores → refold converges byte-identical → tamper one entry → export v2 flips `chainVerified: false` → unknown-major quarantines with visible count. Checked in, repeatable, < 5 minutes.
9. **M2 rendering contract** (PM, UX): stable test-pinned selectors — `quarantineCount(caseId)`, chain status, watermark/`lastFoldedAt` freshness, fold-halt reason, unsettled-outbox flag — plus `GateDescriptor` gains `tier` and `slaMinutes` NOW (spec §5 marks gate ergonomics binding; M2 cards must bind to registry data alone).
10. **Contract freeze**: tagged `.d.ts` under `specs/002-mesh-m1-contracts-audit-spine/contracts/`; failure metric = any breaking change M2 requires (target zero).
11. **WebCrypto canary pinned in `test/setup.ts`** (Engineer): `crypto.subtle` works under vitest by vitest's grace, not the repo's ownership — assert it exists and digests 32 bytes, so an environment change fails loudly at setup, not deep in a fold test.
12. **Architecture open questions 1 (outbox carrier: attachments — recommended) and 2 (case↔project binding) are resolved INSIDE M1's spec**, not deferred — both are M2-blocking (PM).

## Tradeoffs to be resolved in spec (NOT pre-resolved here)
1. **Out-of-position settle vs convergence** — Architect: marking an echo applied without re-applying violates batch≡incremental when the canonical writer sequences a local edit AFTER non-commutative entries. Option A (Architect lean): M1 outbox restricted to last-writer-wins event kinds only (field edits, checklist status) so out-of-position is harmless. Option B: refold-from-0 on out-of-position settle — correct but collides with PM's <500 ms case-open fold budget for a 1,000-entry log. The spec must pick one and state the invariant it preserves.
2. **P3 slip policy** — PM: MVP cut is P1+P2 core; P3 (outbox + export v2) may slip without blocking M2. Sales: export v2 + tamper demo IS the compliance one-pager story and the demo depends on it. The spec must state whether P3 is in the M1 definition-of-done or a fast-follow with the demo re-scoped to P2 (fold + convergence + quarantine only).
3. **`chain-anchor` reserved union member** — Architect wants a reserved caseLog kind so writer-side chain repair (record-never-repair means repair is an appended anchor, not a rewrite) doesn't force a major bump; minimal-union instinct says don't reserve speculative members. Spec decides.
4. **Quarantine refold trigger** — Architect: a contracts-version stamp in eventLogStore triggering refold-from-0 on upgrade (so understood-late entries reinsert mid-stream); PM's fold-latency budget makes unconditional refold-on-upgrade expensive for big logs. Spec decides trigger granularity (per-case on open vs global on upgrade).
5. **Fold-raised copy ownership** — UX: reasonCode+params with rendering deferred to M2's i18n layer; but the worklist item exists TODAY in F01's store with a `title: string`. Spec must define what a pre-M2 title contains (mono english-only placeholder from a reasonCode table is acceptable; free prose is not).

## Acceptance criteria (union, deduplicated)
- Batch fold ≡ incremental fold: byte-identical `JSON.stringify` AND replay returns the same reference (`toBe`).
- Kill-the-laptop: wipe all five stores → refold from fixture log → deep-equal converged state, `chainVerified: true`.
- Tamper any entry → `verifyChain` reports `brokenAtSeq`; export v2 carries `chainVerified: false`; distinct worklist kind raised.
- Unknown-major artifact → quarantine pointer record + cumulative count + watermark advances; refold after simulated upgrade reinserts it (per resolved tradeoff 4).
- Settle: simulated canonical echo (writer-stamped fields differ) settles its outbox record exactly once by minus-writer-fields hash; double echo is a no-op; out-of-position echo behaves per resolved tradeoff 1.
- Unflushed outbox survives restart AND env-key wipe; quota-pressure local write refuses synchronously with typed refusal + worklist item.
- Gap: out-of-order entry buffers; gap persisting past next refresh raises ONE deduplicated worklist item; fold halts at gap for that case only; other cases fold on.
- Fold of the 1,000-entry synthetic log completes < 500 ms on case open (excluding network).
- `GATE_REGISTRY` alone suffices to render an approval-card spike (fields: approver, regulated, batchable, autoDisarmFlags, basis, tier, slaMinutes).
- All 108 existing CRM tests green; vitest baseline unmoved; type-check/lint/design-token/i18n gates green (M1 adds no UI strings).
- `fix/crm-review-iter1` merged first with regression tests per finding.
- Demo script runs end-to-end from a clean checkout in < 5 minutes.

## Out of scope (explicit)
- Any rendering/UI (M2 owns the thin surface; M1 ships selectors + registry data only).
- Live agent runs / real `lm/case/` writers (M2 watcher is first writer; M1 echoes are simulated fixtures).
- Encrypted-at-rest local cache (named milestone owed to spec §9 — Sales flags the security-questionnaire landmine; NOT silently absent).
- Chat-timeline diversion of `lm/case/*` artifact cards (reducer.ts is frozen; M2 decides with the edge/UI).
- Retention/2-day-retrieval proof (edge-side; spec §11 design-partner review, not M1).
- grantAionArtifact fallback for >1 MiB entries (typed failure + worklist in M1; M2 may add the fallback).

## User Journeys (required output for downstream validation)

### Journey 1 — Kill the laptop, reopen, converge
**As an** adviser on a new machine **I want** my case to rebuild itself from the canonical log **so that** no local disk is ever the source of truth.

**Steps:**
1. Seed stores by folding the golden c417 fixture log (scripted; stands in for first case-open fetch).
2. Capture state snapshot S1 (all five stores, canonicalised).
3. Wipe all five CRM stores + localStorage keys (`clearAllCrmState`).
4. Refold the same log from seq 0.
5. Capture snapshot S2.

**Success criteria:**
- S1 deep-equals S2 (byte-identical canonical JSON).
- Watermark equals the log head seq; `chainVerified: true`; zero quarantine; fold < 500 ms.

### Journey 2 — Tamper-evident export for a compliance review
**As a** compliance officer **I want** a case-file export that proves its own integrity **so that** an FCA file review can trust the audit trail.

**Steps:**
1. Fold the golden c417 log; run `exportCaseFile` v2.
2. Verify export: `chainVerified: true`, chain head present, artifact manifest lists every folded entry with sha256.
3. Flip one byte in one caseLog entry fixture; refold from 0.
4. Re-export.

**Success criteria:**
- Step 2 export verifies; step 4 export carries `chainVerified: false` and names `brokenAtSeq`.
- A chain-tamper worklist item (distinct kind from gap) exists for the case; fold halted for that case only.
- v1 bundles still import (`chainVerified: null`).

### Journey 3 — Adviser edit round-trips through the outbox
**As an** adviser **I want** my fact-find edit applied instantly and durably queued upstream **so that** my work is never lost and never double-applied.

**Steps:**
1. `setFactFindField` on a seeded case (via existing store action; bus enqueues outbox record).
2. Assert local state updated + outbox depth 1 + unsettled flag queryable.
3. Simulate restart (rehydrate stores); assert outbox survives.
4. Flush outbox (attachment POST mocked); simulate the canonical echo entry (writer-stamped seq/prevHash/hash) arriving in the log.
5. Fold the echo.

**Success criteria:**
- Settle-by-minus-writer-fields-hash marks the record settled exactly once; store state unchanged by the echo (no double-apply); outbox depth 0.
- A second identical echo is a referential no-op.
- With quota exhausted, step 1 refuses synchronously with a typed refusal and raises a worklist item.

## Brief for /speckit-specify
Build `mesh-m1-contracts-audit-spine`: the contract layer and audit spine of the Lendmind agent mesh, extending the merged F01 CRM domain layer in `src/crm/` on branch `lendmind-crm`. The full component design, file paths, and seams are in `.lm-flow/architecture/mesh-m1-contracts-audit-spine.md` (authoritative; reconciled against three codebase reports and corrected by persona review) — the spec's job is to turn it into testable requirements and resolve the five named tradeoffs below. This feature has NO UI: it ships typed contracts, a fold, a persisted bookkeeping store, a hash chain, a gate registry as data, an outbox, and a v2 case-file export, plus a scripted demo. The system contract it implements is `.lm-flow/spec/lendmind-agent-mesh-spec-v2.md` (§§1, 3, 5, 12).

Three pillars. First, `src/crm/agentContracts/`: hand-written types + `decode*`/`is*` pairs in the house `contracts.ts` style (NOT zod — no new dependencies), covering the directive envelope (with `attemptNonce`, `versions`, `budgetMicroGbp`), per-agent artifact kinds A1–A8 plus typed failures, the `lm.caselog/1` entry (per-case decimal-string `seq`, `firmId` stamped from day one, `prevHash`/`hash` chain fields, and an event union mirroring F01 write paths), the gate registry G1–G10 as pure data (including `tier` and `slaMinutes`), and per-firm config. Unknown majors quarantine — never throw, never drop. Second, the fold: `lm/case/` artifacts on the aion edge are canonical; the four F01 zustand stores demote to a derived cache. A fifth persisted store (`crm-eventlog-store`) holds per-case watermarks, pending buffers, quarantine pointer records (with permanent tombstones and a cumulative ever-count), and the outbox. The fold is per-case serialized (zero awaits between watermark re-check and apply), idempotent by referential identity, strictly seq-ordered, halts per-case on chain break or persistent gap with structured, deduplicated worklist items (`reasonCode` + params, stable ids — never baked prose). Third, the audit spine: sha256 over canonicalised JSON (reusing `caseFile.ts#canonicalise`, WebCrypto), a settle-hash pinned as hash-minus-writer-assigned-fields so M2's canonical writer can reproduce it, and export v2 with chain head, artifact manifest, and gate-policy snapshot, importing both v1 and v2 bundles.

Resolve these five tradeoffs explicitly (dissent details in `.lm-flow/personas/mesh-m1-contracts-audit-spine/`): (1) out-of-position settle — restrict M1 outbox to last-writer-wins kinds vs refold-from-0, preserving batch≡incremental convergence either way; (2) whether P3 (outbox + export v2) is in M1's definition-of-done or a fast-follow, given the compliance demo depends on it; (3) whether to reserve a `chain-anchor` union member for writer-side chain repair; (4) quarantine refold trigger on contracts-version upgrade vs the <500 ms case-open fold budget; (5) what a fold-raised worklist item's `title` contains pre-M2 (a reasonCode-table placeholder is acceptable; free prose is not).

Hard requirements: merge branch `fix/crm-review-iter1` first with regression tests per finding; the scripted tamper demo is a named deliverable; contract freeze via `.d.ts` under `specs/002-mesh-m1-contracts-audit-spine/contracts/`; M2 rendering-contract selectors (quarantine count, chain status, freshness, halt reason, unsettled flag); WebCrypto canary in `test/setup.ts`; ESLint + invariant tests extended to ban store→`fold/*` static imports; all existing 108 CRM tests and every CI gate stay green; vitest baseline unmoved. Include a "## User Journeys" section in the spec with the three journeys above (or refined versions) — this is a hard requirement, not a suggestion: post-merge validation drives them.

