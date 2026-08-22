# Architecture: mesh-m4-connectors

## TL;DR
- M4 is **the connector framework + computer-use** — the milestone that makes eigent operate the adviser's *existing* tools. A `SourcingAdapter` interface, the LB4 logged-in browser-delegation driver (already in the repo, proven against a lender portal), per-firm tool config, and a **record-and-replay eval harness** are the deliverable.
- **MSE adapter** (public, no login, API-intercept-first) is built AND verified end-to-end tonight. **Licensed adapters** (Mortgage Brain / Twenty7Tec / Mortgage Magic) are built as **config-gated scaffolds** against documented/fixture DOM, `verified:false`, with replay evals that go green when a firm login/recorded session arrives. Per [[connector-access]] — no adapter is claimed live until its replay eval passes against a real recorded session.
- Rides M2 dispatch (agent invoked via `lm.directive/1`) + M1 fold; writes an immutable `lm.sourcing.snapshot/1` artifact (already a known kind) capturing the **full** result set. **Adviser-facing only** (FCA invariant 2 — clients never see an agent-ranked list); the recommendation is the human (G5).

## Inputs
- Recon: codebase-map §3 (the LB4 stack: `electron/main/agentBrowser.ts`, `agentBrowserVerbs.ts`, `browserDelegationExecutor.ts`, `aionLocalBrowserStore`, take-control, `halifax.eval.ts`) + `.lm-flow/recon/sourcing-mse-recon.md` (MSE deep-link/API).
- Brief: spec v2 §4-A4, §0 invariants 2 & 4 (no steering; coverage-claim integrity), §5 (G5); decisions connector-access + data-residency.
- Constraints: base `lendmind-crm`; depends on **M2 merged** (dispatch + the surface to show results); develops against frozen M2 contracts otherwise; no new deps; `src/api/aion/v1/**` + M1/M2 contracts frozen; CI gates green.

## Components
### SourcingAdapter interface + registry
- **Lives at:** `src/crm/connectors/SourcingAdapter.ts` + `registry.ts`.
- **Surface:** `buildQuery(case) → steps|apiPlan`, `extract(page|api) → Product[]`, `coverageStatement() → string`, `writeBack?(case, portal)` (for DIP later); `verified: boolean`; `id`. Registry resolves the adapter from per-firm config.

### LB4 delegation driver (compute-use)
- **Lives at:** `src/crm/connectors/lb4Driver.ts` — thin wrapper over the existing `browserDelegationExecutor` + `aionLocalBrowserStore` (`browser_execution:'local'`, `browser_session_mode:'logged_in'`), visible window + take-control. **No new browser stack** — reuses what's proven.

### Record-and-replay eval harness
- **Lives at:** `src/crm/connectors/replay/` + `e2e/connector-*.eval.ts`.
- **Does:** record a real session's DOM/network to a fixture; replay in CI to assert the adapter's `extract` still yields the expected `Product[]`. This is how a licensed adapter is *verified* the day access arrives, and how MSE is verified now.

### MSE adapter (verified)
- **Lives at:** `src/crm/connectors/adapters/mse.ts` — API-intercept-first per recon; cookie-consent essential-only; coverage statement "MSE Best Buys (Podium) — direct + most broker deals; NEVER 'whole of market'".

### Licensed scaffolds (config-gated, verified:false)
- **Lives at:** `src/crm/connectors/adapters/{mortgageBrain,twenty7tec,mortgageMagic}.ts` — LB4 logged-in delegation against documented/fixture DOM; each ships behind per-firm config, `verified:false`, coverage statement, and an authored (not-yet-green) replay eval.

### Sourcing run + snapshot
- **Lives at:** `src/crm/agents/sourcing.ts` (A4) — dispatched when fact-find income is det-verified (G9 upstream); runs the adapter, captures the **full** result set + rates-as-at + coverage statement, writes an immutable `lm.sourcing.snapshot/1` artifact + case-log entries via the fold. Adviser-facing only.

### Results surface + G5
- **Lives at:** `src/crm/ui/SourcingResults.tsx` on the M2 thin surface — the ranked shortlist with true-cost + "why not" per rejected lender + the coverage statement; the **recommendation is a human G5 action**; clients never see this.

## Data model changes
Additive. `FirmConfig.sourcingAdapter` (which adapter) already implied by M1's `adapters`. `lm.sourcing.snapshot/1` payload (M1-decodable): `{ adapterId, coverageStatement, ratesAsAt, products:[...full set incl. declines...], verified }`. No schema bump.

## External integrations
| Provider | Access | Tonight |
|---|---|---|
| MSE | public, no login | build + verify (API-intercept, nightly canary) |
| Mortgage Brain / 27Tec / Mortgage Magic | firm licensed seat (LB4 logged-in) | scaffold + replay eval authored, `verified:false` — live when access arrives |
| lender broker portals (DIP) | firm login | framework-ready; DIP submission is M-late |

## Failure modes
- Portal layout change → typed failure + screenshot artifact (existing LB4 pattern); replay eval catches drift nightly.
- Cloudflare/challenge → retry via LB4 real browser; never loosen constraints silently.
- Zero results → escalate, never silent-retry-loosened.
- Coverage overclaim → forbidden by invariant 4; the snapshot carries the exact coverage statement; UI/evidence may never exceed it.
- An unverified adapter used in a live claim → blocked; `verified:false` gates any "whole of market"/evidence-of-research use.

## Test strategy
- Unit: adapter registry, coverage-statement enforcement, snapshot writer via fold, config resolution.
- MSE: live eval with a pinned query + schema assertions (nightly canary) + a recorded replay in CI.
- Licensed: replay eval authored against fixture DOM; asserts `verified:false` blocks live claims; goes green on a real recorded session.
- Convergence: sourcing entries fold; kill-the-laptop holds.

## Phasing
### Phase 1 — Framework + harness
Goal: `SourcingAdapter` interface + registry + `lb4Driver` wrapper + record/replay harness + per-firm config + snapshot writer + coverage-statement enforcement. Success: a fixture adapter runs → snapshot artifact folds; coverage enforcement blocks overclaim.
### Phase 2 — MSE (verified)
Goal: the MSE adapter, API-intercept-first, verified by a replay + nightly canary. Success: a real MSE query returns a normalized Product set with the correct coverage statement; replay green in CI.
### Phase 3 — Licensed scaffolds
Goal: Mortgage Brain / 27Tec / Mortgage Magic adapters via LB4 against fixture DOM, `verified:false`, replay evals authored. Success: each scaffold runs against its fixture; `verified:false` blocks live claims; the "add a login → eval goes green" path is documented.
### Phase 4 — Results surface + G5
Goal: the adviser-facing shortlist on the M2 surface, true-cost + why-not + coverage; the G5 recommendation gate; demo + gates. Success: an adviser sees a ranked shortlist (adviser-only), picks the recommendation (G5); clients never see it.

## Open questions for the spec phase
1. Which licensed adapter is design-partner #1's — determines which scaffold gets the first real recorded session (founder input, per connector-access).
2. MSE ToS/robots re-verify before the canary ships (recon says AI-access allowed; [VERIFY]).
3. True-cost/APRC normalization source of truth across adapters — recommend a shared normalizer the adapters feed.

## Evidence
Codebase-map §3 (LB4 stack real + `halifax.eval.ts`); sourcing-mse-recon; spec v2 §4-A4/§0/§5; M1 `artifactKinds.decodeSourcingSnapshot` + fold; M2 dispatch + surface; [[connector-access]].
