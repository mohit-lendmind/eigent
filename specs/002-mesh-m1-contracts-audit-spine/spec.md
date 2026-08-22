# Feature Specification: mesh-m1-contracts-audit-spine

**Feature Branch**: `feature/mesh-m1-contracts-audit-spine` (cut from `lendmind-crm`; spec authored on `lendmind-crm`)

**Created**: 2026-08-22

**Status**: Ready for planning

**Input**: User description: multi-persona brief at `.lm-flow/personas/mesh-m1-contracts-audit-spine/brief.txt`; authoritative architecture at `.lm-flow/architecture/mesh-m1-contracts-audit-spine.md`; system contract `.lm-flow/spec/lendmind-agent-mesh-spec-v2.md` §§1, 3, 5, 12.

M1 is the contract layer and audit spine of the Lendmind agent mesh. It makes the aion-hosted case event log the single source of truth, demotes the desktop's case data to a rebuildable cache, and gives every future agent a typed, versioned, tamper-evident way to write into a case. No UI ships in this feature; its users are the adviser (indirectly — durability and auditability of their case data), the compliance buyer (export integrity), and the M2+ feature teams (frozen contracts, rendering selectors, gate registry).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Kill the laptop, reopen, converge (Priority: P1)

An adviser's machine dies mid-case. On a fresh machine, opening the case rebuilds the entire local case state from the canonical event log — nothing on the lost disk was the only copy of anything canonical.

**Why this priority**: This is the artifact-canonical inversion the whole mesh rests on (system contract §1). Every later agent milestone assumes the fold exists and converges. It is independently the smallest thing that proves the architecture.

**Independent Test**: Fold the golden c417 fixture event log into empty stores; snapshot; wipe every CRM store; refold from entry zero; the two snapshots are identical. No agent, no UI, no network needed (fixtures stand in for the artifact plane).

**Acceptance Scenarios**:

1. **Given** empty CRM stores and the golden c417 event log, **When** the log is folded, **Then** the stores contain the full case state, the per-case watermark equals the log head, and the integrity chain verifies.
2. **Given** a folded case, **When** all CRM storage is wiped and the same log is refolded from zero, **Then** the resulting state is byte-identical (canonical JSON) to the pre-wipe snapshot, in under 500 ms for a 1,000-entry log (excluding network).
3. **Given** a folded case, **When** an already-applied entry is folded again, **Then** the state object is returned unchanged by reference (replay is invisible).
4. **Given** a log with an entry arriving ahead of order, **When** folded, **Then** the entry is buffered, not applied; **and When** the gap persists past the next refresh, **Then** exactly one deduplicated needs-attention item is raised for that case and folding continues for all other cases.
5. **Given** an artifact whose kind has an unknown major version, **When** folded, **Then** it is quarantined as a pointer record (never dropped, never thrown), the cumulative quarantine count increments, and the watermark still advances.

---

### User Story 2 - Tamper-evident export for a compliance review (Priority: P2)

A compliance officer exports a case file and can prove to a reviewer (or the FCA) that the audit trail has not been altered — and if it has been, the export says so, and says where.

**Why this priority**: The audit record is the product for compliance buyers (system contract §0). The export is the deliverable a design-partner compliance review inspects; the tamper demo is the sales artifact.

**Independent Test**: Export a folded golden case → verification passes. Flip one byte in one log entry, refold, re-export → verification fails naming the broken sequence. Runs scripted, end-to-end, from a clean checkout in under 5 minutes.

**Acceptance Scenarios**:

1. **Given** a folded, untampered case, **When** exported, **Then** the bundle carries chain-verified status, the chain head, a manifest of every folded entry with its content hash, and a snapshot of the gate policy in force.
2. **Given** one tampered log entry, **When** refolded and exported, **Then** the bundle marks the chain as broken naming the first broken sequence, a chain-tamper needs-attention item (distinct from a gap item) exists for that case, folding is halted for that case only, and other cases are unaffected.
3. **Given** a v1 (pre-M1) export bundle, **When** imported, **Then** it imports successfully with integrity status recorded as "not verifiable" rather than failing or silently claiming verification.
4. **Given** the scripted demo, **When** run from a clean checkout, **Then** it completes fold → wipe → converge → tamper → failed verification → quarantine, unattended, in under 5 minutes.

---

### User Story 3 - An adviser edit round-trips through the outbox (Priority: P3)

An adviser edits a fact-find field. The edit applies instantly on their screen, is durably queued for the canonical log, survives restarts and storage pressure, and — when the canonical echo comes back — is recognised as already-applied rather than applied twice.

**Why this priority**: Desktop-originated writes are the other half of the two-writer world. M2's watcher (the canonical log writer) cannot be built against an unpinned settle contract; but the fold (US1) and export (US2) deliver value without it.

**Independent Test**: Perform a store edit; assert local apply + outbox depth 1; simulate restart (outbox survives); flush; simulate the canonical echo (with writer-assigned sequence and chain fields); fold it; assert settled exactly once with no state change.

**Acceptance Scenarios**:

1. **Given** a seeded case, **When** a fact-find field is edited via the existing store action, **Then** local state updates immediately and one outbox record is queued, queryable as "unsettled".
2. **Given** a queued outbox record, **When** the app restarts or the environment key changes, **Then** the record survives (source data is never wiped with derived state).
3. **Given** a flushed record and its canonical echo (writer-stamped sequence/chain fields), **When** the echo folds, **Then** it settles the record exactly once — matched by the pinned settle hash computed over the entry minus writer-assigned fields — and store state does not change (no double-apply). A duplicate echo is a no-op.
4. **Given** exhausted local storage quota, **When** an edit is attempted, **Then** it is refused synchronously with a typed refusal, a needs-attention item is raised, and no outbox record is silently dropped.
5. **Given** an echo that sequences a local edit after non-commutative canonical entries, **When** folded, **Then** convergence is preserved per the resolved settle policy (see Tradeoff Resolutions, T1).

---

### Edge Cases

- Duplicate sequence number from a buggy writer: first entry wins; an anomaly counter increments; a needs-attention item is raised (record, never repair).
- A log entry larger than the inline read limit: typed failure + needs-attention item (an oversized entry is itself a contract violation worth surfacing).
- Local writes attempted on a case whose fold is halted (chain break): accepted and queued, with the unsettled flag and the halted status both queryable — the surface layer (M2) decides how loudly to warn.
- Gap and duplicate-sequence occurring together on one case: each raises its own deduplicated item; the gap governs the halt.
- Quarantined entries that a future build understands: on case open, if the stored contracts version is older than the build's and the case has quarantine records, that case refolds from zero (bounded cost; clean cases never refold).
- Environment-key change (different edge/tenant): derived state (watermarks, pending, quarantine) wipes and refolds; outbox (source) survives; the refold IS the kill-the-laptop path exercising itself.
- Both fold triggers firing at once (case-open refresh racing a live notification): per-case serialization admits one; the watermark re-check after every await point discards the loser.

## User Journeys

*(Contract for post-merge validation — these are driven scripted/headless; this feature has no UI.)*

### Journey 1 — Kill the laptop, reopen, converge
**As an** adviser on a new machine **I want** my case to rebuild itself from the canonical log **so that** no local disk is ever the source of truth.

**Steps:**
1. Seed stores by folding the golden c417 fixture log (stands in for first case-open fetch).
2. Capture snapshot S1 (all five stores, canonical JSON).
3. Wipe all CRM stores and their persisted storage.
4. Refold the same log from sequence zero.
5. Capture snapshot S2.

**Success criteria:**
- S1 equals S2 byte-for-byte; watermark equals log head; chain verifies; zero quarantine; fold < 500 ms (1,000-entry log, no network).

### Journey 2 — Tamper-evident export for a compliance review
**As a** compliance officer **I want** a case-file export that proves its own integrity **so that** an FCA file review can trust the audit trail.

**Steps:**
1. Fold the golden log; export the case file (v2).
2. Verify: chain-verified true, chain head present, per-entry hash manifest, gate-policy snapshot.
3. Flip one byte in one entry; refold from zero; re-export.
4. Import a v1 bundle.

**Success criteria:**
- Step 2 verifies; step 3 export reports chain broken at the exact sequence; distinct tamper item raised; fold halted for that case only; step 4 imports with integrity "not verifiable".

### Journey 3 — Adviser edit round-trips through the outbox
**As an** adviser **I want** my fact-find edit applied instantly and durably queued upstream **so that** my work is never lost and never double-applied.

**Steps:**
1. Edit a fact-find field through the existing store action.
2. Assert local apply + outbox depth 1 + unsettled queryable.
3. Simulate restart; assert outbox survived.
4. Flush (upload mocked); fold the simulated canonical echo.

**Success criteria:**
- Settled exactly once via the pinned minus-writer-fields hash; no state change on echo; duplicate echo is a referential no-op; quota-exhausted edit refuses synchronously with a typed refusal + needs-attention item.

## Requirements *(mandatory)*

### Functional Requirements

**Contracts**
- **FR-001**: The system MUST define a typed directive envelope carrying agent id, case id, directive, inputs, constraints, issuer, gate policy, trace id, an attempt nonce, version stamps (model, prompt, skill), and a spend budget — with decode/encode functions that reject malformed envelopes with typed errors.
- **FR-002**: The system MUST define typed artifact contracts for every agent A1–A8 plus a typed failure artifact, each carrying a versioned kind identifier; decoding an artifact whose kind has an unrecognised major version MUST quarantine it (never throw, never drop, never partially apply).
- **FR-003**: The system MUST define the case event-log entry contract: per-case monotonic sequence (64-bit safe, decimal string), firm id, timestamp, actor, a typed event union covering every existing case-data write path, origin (artifact id, run id), version stamps, and chain fields (previous hash, hash). A `chain-anchor` member is reserved in the union from day one (see T3).
- **FR-004**: The system MUST expose the gate registry G1–G10 as pure data — approver role, regulated flag, batchability, auto-disarm flags, regulatory basis, triage tier, and SLA minutes — sufficient for a later surface to render an approval card from registry data alone.
- **FR-005**: The system MUST define a per-firm configuration contract (tool adapters, lender panel, fee model, disclosure texts, chase cadences, delegation roster, quiet hours, breaker/budget caps) with decode + per-field defaults.
- **FR-006**: Contract surfaces MUST be frozen as declaration files under this feature's `contracts/` directory; any breaking change a later milestone requires is a defect (target: zero).

**Fold**
- **FR-007**: The system MUST treat the canonical case event log (artifacts on the edge) as the source of truth and apply entries to the local case stores strictly in per-case sequence order, exactly once, idempotently — replay of an applied entry returns the same state by reference.
- **FR-008**: Fold execution MUST be serialized per case with no interleaving across await points: the watermark is re-checked after every asynchronous step, and no asynchronous work occurs between the final watermark check and state application.
- **FR-009**: Out-of-order entries MUST be buffered, never applied early; a gap persisting past the next refresh MUST raise exactly one deduplicated needs-attention item (stable identity: case + reason + sequence) and halt folding for that case only.
- **FR-010**: Chain verification MUST run on every applied entry; a broken link MUST halt the fold for that case, raise a needs-attention item of a kind distinct from a gap, and mark the case's integrity status queryable as broken.
- **FR-011**: All fold bookkeeping (per-case watermarks, pending buffers, quarantine records, outbox) MUST persist across restarts in a dedicated store following every existing persistence convention (environment key, migration, shape repair, test reset, reset-surface registration).
- **FR-012**: Quarantine records MUST be pointers (artifact reference, content hash, reason, bounded preview ≤ 16 KB) — never verbatim payloads; eviction MUST leave a permanent tombstone (hash, kind, timestamp); the ever-quarantined count MUST be cumulative and survive eviction.
- **FR-013**: On environment-key change, derived state (watermarks, pending, quarantine) MUST wipe and rebuild by refold; outbox records MUST survive as source data.
- **FR-014**: Every non-applied entry MUST be observable (quarantine record, needs-attention item, or counter) — no silent drops anywhere in the fold; needs-attention items raised by the fold MUST carry a structured reason code + parameters, with titles drawn from a fixed reason-code table (no free prose; see T5).
- **FR-015**: Fold freshness MUST be queryable per case (last-folded time, source status) so a surface can distinguish "empty", "never fetched", "fetch failed", and "no linked project".

**Audit spine**
- **FR-016**: Content hashing MUST be hex SHA-256 over canonicalised JSON, matching the edge's content-hash convention; the hashing environment MUST be asserted at test-suite setup (canary) so an environment change fails loudly.
- **FR-017**: The settle hash MUST be pinned in the contracts as SHA-256 over the canonical entry EXCLUDING writer-assigned fields (sequence, previous hash, hash) — reproducible by both the desktop (before flush) and the canonical writer (M2).
- **FR-018**: Desktop-originated case writes MUST enqueue an outbox record (via the store side-bus; static store→fold imports are lint-banned), apply locally at once, flush upstream via the attachments plane (retry safety = content-addressed dedupe + settle-by-hash; this route carries no idempotency key by contract), and settle exactly once when the canonical echo folds.
- **FR-019**: In M1 the outbox accepts last-writer-wins event kinds only (see T1); a detected out-of-position settle of any other kind MUST trigger a one-time refold-from-zero for that case (defense in depth).
- **FR-020**: An unwired outbox bus MUST fail loudly (throw in dev; error + queue in prod) — never a silent no-op.
- **FR-021**: Case-file export MUST gain a v2 envelope: chain head, chain-verified status, per-entry artifact manifest with hashes, gate-policy snapshot (registry + delegation roster), version stamps, plus the log entries, unflushed outbox, and quarantine records; import MUST accept v1 (integrity "not verifiable") and v2.
- **FR-022**: The scripted tamper demo (fold → wipe → converge → tamper → failed verify → quarantine) is a named deliverable, checked in, runnable unattended from a clean checkout in under 5 minutes.

**Foundation**
- **FR-023**: The parked review-fix branch (`fix/crm-review-iter1`) MUST merge first, with a regression test per finding, before fold work begins.
- **FR-024**: The case entity MUST gain an optional link to its canonical project (additively; no schema version bump); id-prefix and reset surfaces MUST be extended for the new record types.
- **FR-025**: All 108 existing CRM tests and every CI gate (type-check, lint, design-token, i18n parity, vitest baseline, electron-access) MUST stay green; the vitest baseline MUST NOT move.

### Key Entities

- **Directive envelope**: one agent invocation — who asked, what for, with what inputs/constraints/budget, at what versions; its hash (plus nonce) is the idempotency identity.
- **Case log entry**: one canonical fact about a case — sequenced, attributed, chained to its predecessor; the unit of audit.
- **Agent artifact**: one agent run's output (or typed failure) — versioned kind, quarantined when from the future.
- **Gate descriptor**: one human checkpoint — who may approve, whether delegable/batchable, what disarms it, its regulatory basis, tier, and SLA.
- **Watermark**: per-case high-water sequence — the fold's idempotency floor.
- **Quarantine record**: pointer + tombstone for what we could not (yet) understand — never forgotten, cheaply retained.
- **Outbox record**: an adviser-originated event awaiting its canonical echo — source data, never wiped, settled by content identity.
- **Case-file export v2**: the regulator-facing bundle that proves its own integrity.
- **Firm config**: the per-firm policy surface every agent reads.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A wiped machine reconstructs a 1,000-entry case in under 500 ms (excluding network) with zero divergence — batch and incremental folds produce byte-identical state, and replays return identical references.
- **SC-002**: 100% of tampered exports are detected (flipping any single byte in any log entry flips verification to failed and names the first broken sequence); 0% false positives on untampered logs (property-tested across the golden fixtures).
- **SC-003**: Zero silent losses: every entry that does not apply is accounted for in a quarantine record, needs-attention item, or counter — audited by tests that inject every failure mode (gap, tamper, unknown major, oversize, duplicate sequence, quota exhaustion).
- **SC-004**: An adviser edit is never double-applied and never lost across restart, environment change, flush retry, or duplicate echo (exactly-once settle, property-tested).
- **SC-005**: A later surface can render an approval card and a case-health strip from registry data and rendering selectors alone — proven by a spike test that imports only the public barrel.
- **SC-006**: Zero breaking contract changes required by M2 (measured at M2 completion; one major bump triggers a retro).
- **SC-007**: The demo script runs green, unattended, from clean checkout, in under 5 minutes.
- **SC-008**: Every CI gate green; vitest baseline unmoved; 108 pre-existing tests untouched and passing.

## Tradeoff Resolutions *(from the persona dissent record)*

- **T1 — Out-of-position settle**: RESOLVED as restrict-then-refold. M1 outbox accepts last-writer-wins kinds only (fact-find field edit, checklist status, worklist resolve) so an out-of-position echo is harmless by construction; if a non-LWW echo is ever detected out of position, that case refolds from zero once (correctness backstop). Preserves batch≡incremental without paying refold on the happy path. *(Architect option A, with their refold escape hatch.)*
- **T2 — P3 in the definition-of-done**: RESOLVED as P3 stays in M1's DoD (Sales' compliance demo and Journey 2/3 depend on it) — but M2 is explicitly unblocked at P2-merge: the fold + contracts are M2's only dependency. PM's slip-risk is mitigated by dependency, not by descoping.
- **T3 — `chain-anchor` reserved member**: RESOLVED as reserve it now. Record-never-repair makes writer-side repair (an appended anchor entry that re-bases the chain) inevitable; one reserved union member + a fold no-op case is cheap; a major bump later costs a quarantine-refold cycle. *(Architect wins; minimal-union instinct recorded as the dissent.)*
- **T4 — Quarantine refold trigger**: RESOLVED as per-case, on case open, when the stored contracts version < build's contracts version AND that case has quarantine records. Clean cases never refold; the <500 ms budget holds for them; quarantine-bearing cases pay once per upgrade. Global automatic refold: never.
- **T5 — Fold-raised item titles pre-M2**: RESOLVED as a fixed reason-code table (`FOLD_GAP`, `CHAIN_BREAK`, `QUARANTINE_UNKNOWN_MAJOR`, `OUTBOX_QUOTA`, `DUPLICATE_SEQ`, `ENTRY_TOO_LARGE`) with structured params on the item; title = code + minimal params, mono style; free prose is banned by test. M2 owns human copy + i18n.

## Assumptions

- The golden-path fixtures (c417/c392) remain the canonical test data; a fixture event log for c417 is authored in this feature as the fold's golden input.
- The canonical writer (M2 watcher) does not exist yet: all canonical echoes in M1 are simulated fixtures; the settle-hash contract is what M2 builds against.
- The attachments plane is the outbox flush carrier (architecture open question 1, resolved: content-addressed dedupe aligns with the settle hash; no new edge endpoints requested).
- A case's canonical project link is populated by fixtures in M1; real project minting belongs to M2 onboarding (architecture open question 2, resolved for M1's scope).
- Chat surfaces viewing a case's project will render raw log artifacts as cards; accepted noise in M1 (the diversion decision belongs to M2 with the edge/UI).
- Encrypted-at-rest local cache is explicitly NOT in M1 and is owed a named milestone (recorded for the security questionnaire; system contract §9).
- The 8 known-failing upstream tests in the vitest baseline stay untouched.

---

## Appendix: Persona dissent record

This spec was generated from a multi-persona synthesis (five seats, 2026-08-22). Disagreements and their resolutions:

| # | Persona(s) | Position | Resolution in this spec |
|---|---|---|---|
| 1 | Architect | Settle hash must exclude writer-assigned fields or echoes can never match | Adopted verbatim — FR-017 |
| 2 | Architect | Out-of-position settle breaks convergence; restrict kinds or refold | T1: restrict-then-refold hybrid |
| 3 | Architect | Env-key wipe must not destroy unflushed outbox | Adopted — FR-013, US3 scenario 2 |
| 4 | Architect | Reserve `chain-anchor` union member | T3: adopted; minimal-union dissent recorded |
| 5 | Architect + PM | Quarantine stranding needs a refold trigger vs fold-latency budget | T4: per-case, on-open, version+quarantine gated |
| 6 | Engineer | Per-case serialized fold; zero awaits between check and apply | Adopted — FR-008 |
| 7 | Engineer | Quarantine as pointer records, not verbatim payloads (quota + persist cost) | Adopted — FR-012, composed with Sales' tombstones + PM's cumulative count |
| 8 | Engineer | WebCrypto works by vitest's grace — pin a canary | Adopted — FR-016 |
| 9 | Engineer | Null outbox bus = silently dropped adviser edits | Adopted — FR-020 + lint/invariant extensions in FR-018 |
| 10 | Engineer | Two factual errors in architecture doc (attachment idempotency key; `Case.aionProjectId`) | Architecture doc corrected before this spec; FR-018/FR-024 carry the corrected facts |
| 11 | UX | Structured reason codes + params, stable dedup ids, no baked prose | Adopted — FR-009, FR-014, T5 |
| 12 | UX | Gate registry needs `tier`/`slaMinutes` now | Adopted — FR-004 |
| 13 | UX | Per-case freshness metadata (four distinguishable empty states) | Adopted — FR-015 |
| 14 | PM | Demo as named deliverable; M2 rendering contract; contract freeze | Adopted — FR-022, SC-005, FR-006 |
| 15 | PM | P3 may slip vs Sales: export v2 is the compliance story | T2: P3 in DoD; M2 unblocked at P2 |
| 16 | PM + Sales + Architect | Stamp `firmId` now | Adopted — FR-003 |
| 17 | Sales | Gate-policy snapshot in export; permanent quarantine tombstones; per-milestone "claims we cannot make yet" list | Adopted — FR-021, FR-012; claims list lives in the Assumptions (no DPIA, no live agents, no encrypted-at-rest, retention unproven) |

Source files:
- Architecture: `.lm-flow/architecture/mesh-m1-contracts-audit-spine.md`
- Personas: `.lm-flow/personas/mesh-m1-contracts-audit-spine/*.md`
- Synthesis: `.lm-flow/personas/mesh-m1-contracts-audit-spine/synthesis.md`
