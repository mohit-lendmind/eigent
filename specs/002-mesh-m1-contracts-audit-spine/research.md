# Research: mesh-m1-contracts-audit-spine

Phase 0 output. No NEEDS CLARIFICATION markers existed in the spec — the architecture pass (three parallel codebase reports) and the persona pass (five seats) resolved every open question. This file records those decisions in Decision/Rationale/Alternatives form so the trail is auditable.

## D1 — Validation approach: house decode pattern, not zod
- **Decision**: hand-written TS types + `decode*`/`is*` pairs + open-set kind typing (`Known | (string & {})`), per `src/api/aion/v1/contracts.ts`.
- **Rationale**: zero `zod` imports exist anywhere in the repo; the decode pattern is the proven convention (used by the whole aion plane); open-set typing IS the quarantine mechanism (unknown kinds decode rather than throw); adds no dependency.
- **Alternatives considered**: zod (spec v2's original wording — rejected: new dep, contradicts convention; spec v2 corrected); ajv/JSON-Schema (rejected: same objections plus codegen weight).

## D2 — Fold discipline: transpose reducer.ts's seven invariants
- **Decision**: decimal-string per-case `seq` compared via BigInt; replay returns same reference; cursor advances unconditionally; record-never-repair (gaps/duplicates are surfaced anomalies); open sets everywhere; two-stage fold (metadata notice → inline content fetch → ordered apply); per-case serialization with watermark re-check after every await and zero awaits between final check and apply.
- **Rationale**: `src/api/aion/v1/reducer.ts` is the house's proven pure-fold; its test harness (`aionReducer.test.ts`) pins live-vs-replay byte equality and referential no-ops — we inherit the discipline and the test shapes. The serialization addendum exists because our fold (unlike the reducer) has async steps (fetch, hash), so interleaving is a real race (engineer persona, verified).
- **Alternatives**: reorder-buffer with gap repair (rejected: violates record-never-repair; edge guarantees don't apply to our writer-authored seq, so a gap is a writer bug to surface, not hide); folding artifact metadata only (rejected: our domain mutation IS the content).

## D3 — Canonical/derived split + settle
- **Decision**: `lm/case/` artifacts canonical; F01 stores = derived cache; desktop writes go outbox-first (LWW kinds only in M1), flush via attachments plane, settle on canonical echo by sha256 over entry-minus-writer-fields (`seq`, `prevHash`, `hash`); out-of-position settle of a non-LWW kind triggers one-time refold-from-zero (T1).
- **Rationale**: system contract §1 (panel verdict #2). Minus-writer-fields hash is the only hash both sides can compute (architect persona — full-content hash of the echo can never match the unsequenced candidate). LWW restriction makes out-of-position echoes harmless by construction; refold is the correctness backstop, not the happy path (PM's 500 ms budget).
- **Alternatives**: dedicated append-run per desktop write (rejected for M1: cost per edit, needs a skill deploy; attachments CAS dedupe aligns with the settle hash for free); desktop mints seq (rejected: two writers minting seq is the classic split-brain).

## D4 — Hashing: hex sha256 over canonicalised JSON, WebCrypto
- **Decision**: reuse `caseFile.ts#canonicalise` (recursive key-sort) + `crypto.subtle.digest('SHA-256', …)` → hex; canary assertion in `test/setup.ts`.
- **Rationale**: matches the edge's own `content_hash` convention ("Hex sha256 of the canonical document"); `canonicalise` already exists and is round-trip-tested; WebCrypto works in renderer, web build, and vitest's Node-webcrypto global — but only by vitest's grace, hence the canary (engineer persona, verified empirically under jsdom 26).
- **Alternatives**: a JS sha256 lib (rejected: new dep for something the platform provides); Node `crypto` (rejected: renderer + web build).

## D5 — Quarantine economics
- **Decision**: pointer records (artifactId/version/contentHash/reason/preview ≤ 16 KB), permanent tombstones on eviction, cumulative ever-count; refold trigger per-case on open when stored contractsVersion < build's AND case has quarantine (T4).
- **Rationale**: verbatim payloads can blow the ~5 MiB localStorage quota and make every persist write re-stringify megabytes (engineer); the artifact plane is canonical and refetchable so pointers lose nothing; auditors ask "how many ever" (PM/sales); bounded refold preserves the latency budget (PM vs architect resolved).
- **Alternatives**: verbatim retention (rejected: quota); evict-and-forget (rejected: audit product); global refold on upgrade (rejected: unbounded latency).

## D6 — Loudness grammar
- **Decision**: structured `reasonCode` + params from a fixed table (`FOLD_GAP`, `CHAIN_BREAK`, `QUARANTINE_UNKNOWN_MAJOR`, `OUTBOX_QUOTA`, `DUPLICATE_SEQ`, `ENTRY_TOO_LARGE`); stable worklist ids `caseId+reasonCode+seq` (upsert, never spam); distinct kinds for gap vs tamper; unwired bus throws (dev) / errors+queues (prod).
- **Rationale**: prose in the fold bypasses the i18n gate and freezes copy at the wrong layer (UX); dedup prevents item-per-refresh spam (UX); gap and tamper have different recovery semantics (architect); silent null-bus drops adviser edits (engineer).
- **Alternatives**: free-prose titles (banned by test, T5); console.warn-only (rejected: PM — counters and items, not logs).

## D7 — Export v2 envelope
- **Decision**: `exportVersion: 2` with chain head, chainVerified, per-entry hash manifest, gate-policy snapshot, version stamps + records for log entries/outbox/quarantine; import accepts v1 (integrity "not verifiable") and v2.
- **Rationale**: the export is the compliance deliverable (sales); v1 compat keeps existing bundles importable (FR-021); gate-policy snapshot answers "who could approve what, then" in a file review (sales dissent adopted).
- **Alternatives**: bump to v2-only import (rejected: breaks existing exports for no gain).

## D8 — Chain repair provision
- **Decision**: reserve `chain-anchor` in the caseLog event union now; fold treats it as a chain re-base no-op (T3).
- **Rationale**: record-never-repair means a broken chain is repaired writer-side by an appended anchor, never a rewrite; reserving the member now costs one decode case; adding it later costs a major bump + quarantine-refold cycle for every fielded build (architect).
- **Alternatives**: minimal union, add on need (rejected: the upgrade path is exactly what's expensive; dissent recorded).

## D9 — Fold triggers without a push channel
- **Decision**: fold on case open + live `subscribeAionArtifacts` notifications during a run + explicit refresh; per-case freshness (`lastFoldedAt`, `sourceStatus`) queryable (FR-015). No polling.
- **Rationale**: SSE artifact notifications only exist while a session is live (bindings minted by `startAionTask` only — verified); the M2 watcher becomes the real-time driver; event-driven invalidation is the house rule (no `setInterval` in the aion plane).
- **Alternatives**: renderer polling (rejected: house rule, battery, and the watcher makes it redundant one milestone later).
