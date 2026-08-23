## Summary

M4 — the sourcing connector framework + adviser-only results surface. An adapter
is a **declarative plan + a pure extractor**: `buildQuery` emits a `lm.directive/1`
plan the existing parked-delegation pump runs (it never drives the browser
executor), and `extract` turns a captured `tool_result` into normalized `Product[]`
with no browser/login/model in the loop — which is what makes a replay eval a real
verification.

**The honesty spine is load-bearing, not decorative:**

- `verified` is **derived** from a `VerificationRef` (fixtureHash + ratesAsAt +
  raw-evidence pointer + a passing canary), never hand-set. MSE ships a ref with no
  `canaryPassedAt`, so it is `verified:false` until a live canary runs.
- `assertClaimable(snapshot)` is the **single choke-point** for the results surface
  and every evidence export; it **re-derives** and never trusts the stored flag, so
  a hand-set `verified:true` with no evidence is refused (`no-evidence`).
- The one verified adapter is **MSE** (isolated, API-intercept). The licensed
  **Mortgage Brain** adapter ships as a `verified:false` scaffold: DOM-scrape behind
  a login, a fixture explicitly labelled SYNTHETIC, and a canary that stays red
  until a real captured session is supplied. **No fabricated evidence or recorded
  sessions.**

v1 ships exactly two adapters on one interface; adding more brokers needs no core
change.

## Per-FR checklist

- [x] **FR-001** — `SourcingAdapter` = declarative `buildQuery` + pure `extract` +
  `coverage` + `id`; registry resolves from firm config and carries derived
  `verified`; plan runs via the pump, never the executor directly.
- [x] **FR-002** — MSE isolated (console fetch); Mortgage Brain DOM-interaction only
  under `logged_in`; no adapter claims API-interception beyond MSE.
- [x] **FR-003** — record/replay harness feeds captured `result_json` to a pure
  `extract()` in CI; MSE live canary authored (nightly); Mortgage Brain replay is
  red until a real session is supplied.
- [x] **FR-004** — a run writes `lm.sourcing.snapshot/1`: a **folded summary** on the
  case-log entry, full result set (incl. declines) as a **referenced attachment**,
  never inline.
- [x] **FR-005** — dedicated `decodeSourcingSnapshotPayload` requires coverage /
  ratesAsAt / products / verified (beyond the generic M1 spine decoder).
- [x] **FR-006** — `verified` derived from a `VerificationRef`; `assertClaimable`
  choke-point gates the surface + every evidence export; re-derives, never trusts.
- [x] **FR-007** — every snapshot carries `surfaceClass:"adviser-only"`; a structural
  CI test proves no module outside `src/crm` can decode or embed a snapshot (the app
  router mounts `/crm/*` and the CRM owns its own child routing).
- [x] **FR-008** — coverage is a typed enum + `wholeOfMarket:boolean`; a lint gate
  rejects the literal phrase "whole of market" unless the flag is true (only the
  negation is allowed); the statement is copied into each artifact.
- [x] **FR-009** — v1 ships `mse` (verified path) + `mortgage-brain` (scaffold); the
  interface supports Twenty7Tec / Mortgage Magic / … without core changes.
- [x] **FR-010** — sourcing serialized per desktop (`SOURCING_SERIALIZED_PER_DESKTOP`);
  every action stamps the acting adviser id; per-portal ToS recorded before build.
- [x] **FR-011** — adviser-only ranked cards + collapsed why-not + pinned coverage
  line; `verified:false` shows a watermark band with export disabled; narrating run
  ribbon + always-hot take-control + "Running as you".
- [x] **FR-012** — G5 disabled until a product is picked AND a one-line rationale is
  typed; the choice + rejected-reasons fold; a staleness warning shows on old rates.
- [x] **FR-013** — **out of scope by design**: `writeBack`/DIP is deliberately NOT in
  the M4 interface (no browser-action idempotency key yet); returns with G8/M-late.
- [x] **FR-014** — build + verify on MSE + scrubbed fixtures; the kill-the-laptop
  convergence holds with a sourcing entry (`sourcingConverge.test.ts`); contract
  freeze under `specs/005-.../contracts/`; dark-mode contrast asserted via ds-tokens;
  all CI gates green.

## Honesty-spine guarantees (do not regress)

- MSE is verified-for-real only (canary-earned); Mortgage Brain ships
  `verified:false`. No `verified:true` is ever hand-set and no evidence/recorded
  session is fabricated.
- `assertClaimable` + `surfaceClass:"adviser-only"` + the `wholeOfMarket` lint gate
  all hold, enforced by tests (no `package.json` / `gates.yml` change — new gates run
  from vitest).

## Test plan

- [x] `type-check` + `type-check:freeze` (M4 contract pins load-bearing) green
- [x] full CRM vitest suite green (247 tests); vitest baseline unchanged
- [x] design-token, i18n locale-parity, no-legacy-backend, no-dead-brain, electron-access gates green
- [x] eslint 0 errors
- [x] `node scripts/demo-mesh-m4.mjs` self-asserts the full spine end to end
- [ ] MSE live canary (nightly / on real-session capture) — authored, red until a session is supplied

🤖 Generated with [Claude Code](https://claude.com/claude-code)
