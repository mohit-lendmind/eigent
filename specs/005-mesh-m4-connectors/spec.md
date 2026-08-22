# Feature Specification: mesh-m4-connectors

**Feature Branch**: `feature/mesh-m4-connectors` (from `lendmind-crm`) · **Created**: 2026-08-22 · **Status**: Ready for planning
**Input**: brief `.lm-flow/personas/mesh-m4-connectors/brief.txt`; architecture `.lm-flow/architecture/mesh-m4-connectors.md` (panel-corrected on six points); spec v2 §§0(inv 2&4),4-A4,5; decisions connector-access + data-residency. Builds on M1 (fold) + M2 (dispatch, thin surface) + the existing LB4 stack.

M4 is the sourcing connector framework + the computer-use path — the milestone that makes eigent operate the adviser's *existing* tools. MSE is built and verified for real; Mortgage Brain ships as a `verified:false` scaffold with a replay eval that goes green when a firm login/recorded session arrives. The framework supports all broker tools; v1 ships two. **No adapter is claimed live until its replay passes against a real recorded session.**

## User Scenarios & Testing

### User Story 1 — Watch it source MSE, live, under your login (P1)
**Why**: the computer-use showcase — an agent operating the adviser's own tools, with the audit trail as the product.
**Independent test**: trigger sourcing on a fact-find-complete case against MSE; observe the visible run + the folded snapshot + the adviser-only shortlist.
**Acceptance**:
1. Given a case with income det-verified, When sourcing is dispatched, Then the adapter emits a **declarative directive plan** the existing delegation pump runs in the visible browser (isolated for MSE) — no synchronous driver call.
2. During the run, Then a narrating step ribbon shows the current action, an always-hot non-modal "Take control" freezes mid-step and yields the live cursor, and a "Running as you" label is shown.
3. On completion, Then a `lm.sourcing.snapshot/1` is written with the coverage statement, rates-as-at, the **full** result set (incl. declines), adviser id, and a derived `verified`; the case-log entry is a **folded summary** and the full set rides as a **referenced attachment** (never inline — the fold drops oversize).
4. The shortlist renders adviser-only as ranked cards (lender, monthly, one true-cost number, Why?), rejected lenders collapsed under "N not shortlisted", with the coverage line pinned to the header (info tone, never "whole of market" for MSE).

### User Story 2 — The scaffold is honestly not-live (P2)
**Why**: honesty is the moat — a scaffold shown as live loses the compliance-trust game.
**Independent test**: select the Mortgage Brain scaffold; confirm results are marked not-for-client and barred from evidence.
**Acceptance**:
1. Given the Mortgage Brain adapter (`verified:false`), When it runs, Then results carry a watermark band + "Not for client use — awaiting verified feed".
2. Given a `verified:false` snapshot, Then export and "add to suitability" are **disabled**, and `assertClaimable(snapshot)` blocks it from any evidence-of-research export and any client-facing surface — enforced in the writer/fold, not UI hiding, and test-covered.
3. Given a licensed (logged-in) adapter, Then it operates by DOM interaction only (no network interception exists behind a login); an authored replay eval exists and is red until a real recorded session is supplied.

### User Story 3 — The evidence-of-research pack (P2)
**Why**: the coverage statement + full result set + hash-chain is the compliance deliverable.
**Independent test**: export evidence from a verified MSE snapshot; confirm the record spine and the claimable gate.
**Acceptance**:
1. Given a verified MSE snapshot, When evidence-of-research is exported, Then it carries the full result set incl. declines, rates-as-at, the copied coverage statement, adviser id, and `verified` (MCOB 4.7A spine).
2. Given a non-claimable snapshot (verified:false or evidence-less), Then the export refuses via `assertClaimable`.
3. The coverage statement is copied into every artifact (not a pointer); no surface or export ever exceeds it; the literal phrase "whole of market" is rejected unless `wholeOfMarket:true`.

### Edge Cases
- Concurrent sourcing on two cases → serialized per desktop (the browser window is a singleton); the second waits.
- Portal layout change → replay (recorded) can't catch it; only the live MSE canary does; licensed adapters have no drift detection until access → their staleness is surfaced, not hidden.
- Zero/partial results → escalate; never silently retry with loosened constraints.
- Fixtures must scrub session tokens/CSRF/client PII (residency + non-replayable otherwise).
- A sourcing snapshot must never be decodable/embeddable by a client-facing component (invariant 2) — enforced by a CI test.
- Rates-as-at stale at recommendation → G5 staleness warning.

## User Journeys
*(US1/US2/US3 above; MSE journey is live-drivable, scaffold + evidence journeys run on recorded fixtures.)*

## Requirements

### Functional
- **FR-001**: `SourcingAdapter` MUST expose `buildQuery(case) → declarative plan`, `extract(recordedResult) → Product[]` (pure), `coverageStatement()`, and an `id`; the registry resolves the adapter from per-firm config and carries `verified`. `buildQuery` MUST NOT call the browser executor directly — it emits a plan the existing parked-delegation pump runs via `lm.directive/1`.
- **FR-002**: MSE MUST run in isolated mode reading its JSON via a console fetch; **licensed (logged-in) adapters MUST be DOM-interaction only** (no network interception exists behind a login). No adapter may claim API-interception beyond MSE.
- **FR-003**: The record/replay harness MUST capture `tool_result` events as `{tool_name, arguments_json, result_json}` and feed `result_json` to a **pure `extract()`** in CI — no browser/login/model. Only a **live MSE canary** verifies drift; licensed adapters ship recorded replays that are red until a real session is supplied.
- **FR-004**: A sourcing run MUST write a `lm.sourcing.snapshot/1` whose case-log entry is a **folded summary** and whose full result set (incl. declines, rates-as-at) rides as a **referenced attachment** — never inline (the fold drops oversize).
- **FR-005**: A **dedicated sourcing-snapshot payload decoder** MUST require `coverageStatement`, `ratesAsAt`, `products[]` (full incl. declines), and `verified` (the generic M1 decoder validates only the spine).
- **FR-006**: `verified` MUST be **derived** from a verificationRef + fixtureHash + ratesAsAt + a raw-enquiry-evidence pointer — never a self-asserted boolean. A single `assertClaimable(snapshot)` choke-point MUST gate the results surface, every evidence-of-research export, and any client-facing path — enforced in the writer/fold and test-covered.
- **FR-007**: Every sourcing snapshot MUST carry `surfaceClass:"adviser-only"`; a CI test MUST prove no client-facing component (onboarding portal, comms) can decode or embed a sourcing artifact (invariant 2 / PERG 4.6).
- **FR-008**: Coverage MUST be a typed enum + a machine-checkable `wholeOfMarket:boolean`; a lint gate MUST reject the literal phrase "whole of market" unless the flag is true (MCOB 4.4A); the statement MUST be copied into every artifact, never a pointer.
- **FR-009**: v1 MUST ship exactly two adapters — `mse` (verified) and `mortgage-brain` (scaffold, verified:false); the framework MUST support additional broker tools (Twenty7Tec, Mortgage Magic, …) on the same interface without core changes.
- **FR-010**: Local sourcing MUST be serialized per desktop (single browser window/partition); every automated action MUST stamp the acting adviser id; per-portal ToS confirmation MUST be recorded before each licensed adapter is built ([VERIFY]).
- **FR-011**: The results surface MUST render adviser-only ranked cards + collapsed why-not + a pinned coverage line; `verified:false` results MUST show a watermark band with export/add-to-suitability disabled; the run MUST show a narrating ribbon + always-hot take-control + "Running as you".
- **FR-012**: G5 (recommendation) MUST stay disabled until the adviser selects a product AND enters a one-line rationale; the choice + rejected-reasons snapshot MUST fold; a G5 staleness warning MUST show when rates-as-at is old.
- **FR-013**: `writeBack`/DIP submission MUST NOT be in the M4 interface (no browser-action idempotency key yet) — it returns with G8/M-late.
- **FR-014**: Build + verify on MSE (public) + recorded fixtures; fixtures MUST scrub tokens/CSRF/PII; the M1 kill-the-laptop convergence MUST hold with sourcing entries; contract freeze under `specs/005-mesh-m4-connectors/contracts/`; all CI gates green; dark-mode contrast verified (don't trust forced-light Storybook).

### Key Entities
SourcingAdapter (+verified), declarative query plan, record/replay harness (pure extract), sourcing snapshot (folded summary + full-set attachment), payload decoder, assertClaimable choke-point, coverage statement (typed + wholeOfMarket), results shortlist, G5 recommendation.

## Success Criteria
- **SC-001**: An MSE sourcing run drives the visible browser via a declarative plan, folds a summary + full-set attachment, and shows an adviser-only ranked shortlist with a pinned honest coverage line — verified by a pure recorded-replay in CI + a live canary.
- **SC-002**: `assertClaimable` blocks every `verified:false` / evidence-less snapshot from the results surface, evidence export, and client surfaces — test-covered in the writer/fold.
- **SC-003**: No client-facing component can embed a sourcing snapshot (CI test); the literal "whole of market" is impossible unless `wholeOfMarket:true`.
- **SC-004**: The Mortgage Brain scaffold runs against a fixture, ships `verified:false` with a red replay that documents the "add a recorded session → green" path.
- **SC-005**: Kill-the-laptop convergence holds with sourcing entries; every gate green; dark-mode verified.
- **SC-006**: An evidence-of-research export from a verified snapshot carries the MCOB 4.7A spine and refuses when not claimable.

## Assumptions
- v1 = mse + mortgage-brain; other broker tools plug onto the framework later. The framework is the "connectors for all" answer; adapters are incremental.
- Which licensed tool is design-partner #1's (→ the first real recorded session + a paid reference) is a **deferred founder input**, not an M4 build input.
- Real client PII + off-device inference gated by the data-residency decision; MSE is public.
- Build on Opus 4.8; the pre-merge review runs on Fable 5 @ xhigh.

## Tradeoff Resolutions
buildQuery=declarative plan (no lb4Driver); MSE isolated/console-fetch vs licensed DOM-scrape; pure-extract replay + MSE-only live canary; folded summary + attachment; derived verified + assertClaimable; v1 two adapters, framework supports all. (Dissent record: `.lm-flow/personas/mesh-m4-connectors/`.)

---

## Appendix: Persona dissent record
| # | Seat | Position | Resolution |
|---|---|---|---|
| 1 | Architect, Engineer | No callable lb4Driver — buildQuery is a declarative plan | FR-001 |
| 2 | Architect, Engineer | API-intercept impossible behind a login; licensed=DOM-scrape | FR-002 |
| 3 | Architect | Replay can't catch drift; only a live canary does | FR-003 |
| 4 | Architect | Full result set silently dropped by the fold (oversize) | FR-004 |
| 5 | Engineer | decodeSourcingSnapshot validates only the spine | FR-005 |
| 6 | Architect, Engineer, Compliance | verified must be derived + a single assertClaimable choke-point | FR-006 |
| 7 | Compliance | Invariant 2 needs a structural surfaceClass + CI test | FR-007 |
| 8 | Compliance | Coverage as wholeOfMarket bool + lint gate + copied not pointer | FR-008 |
| 9 | Engineer | Local sourcing serialized (singleton window) | FR-010 |
| 10 | UX | Narrating ribbon + always-hot take-control + Running-as-you | FR-011 |
| 11 | UX | verified:false watermark + disabled export | FR-006/011 |
| 12 | UX | G5 needs pick + rationale, not rubber-stamp | FR-012 |
| 13 | Sales, Architect | v1 two adapters; recorded-session as a 10-min trial-day-1 ask | FR-009; Assumptions |
| 14 | Architect | writeBack/DIP out until G8 (no browser-action idempotency key) | FR-013 |
Source: architecture + personas/mesh-m4-connectors/*.md + synthesis.md.
