# Software Engineer perspective on mesh-m4-connectors

## What I support
- Reusing the proven LB4 stack, no new deps. `agentBrowserVerbs` is Electron-free and vitest-covered — keep adapters' `extract()` equally pure so it replays without a browser.
- Additive model, no schema bump; adviser-only, no send path.

## What I want changed (Dissent:)
- **Dissent: there is no callable "lb4Driver".** `browserDelegationExecutor.notePending` (fed only by aionChatBridge `onState`:352) executes `browser_*` calls the *cloud model already parked* — no buildQuery→run entry, no synchronous drive. So `buildQuery(case)` is the **directive plan** the edge agent runs; "the driver" is per-firm session-mode config (isolated=MSE, logged_in=licensed) via `browserSubmitFields`, not a browser RPC.
- **Dissent: "API-intercept" is a misnomer.** `CDP_ALLOWED` has no Network domain. MSE JSON only arrives via `browser_console_exec` fetch, **blocked in logged_in mode** (agentBrowser:832). It works for MSE solely because MSE is no-login→isolated. Licensed (logged_in) adapters get NO fetch — snapshot/click only.

## What I would not ship without
- **A verified:false choke-point in code.** Nothing enforces it today — `adapters.sourcing` is a bare string, no verified flag exists. Registry carries `verified`; writer stamps it; one `assertClaimable(snapshot)` the Results surface and any evidence-of-research export MUST call, blocking verified:false. Convention won't hold an FCA invariant.
- **A dedicated payload decoder.** `decodeSourcingSnapshot` validates only the spine and spreads the rest unchecked — accepting a snapshot with no coverageStatement/products/verified. Add one requiring coverageStatement, ratesAsAt, products[] (full set incl. declines), verified:boolean.

## Test & replay strategy
- halifax/local-browser evals are LIVE (bootstrap.json, real edge/model) — unrunnable in CI, blocked by 08-22 headless-auth. Don't copy them as the gate.
- Record = capture ordered `{tool,args,result_json}` from `tool_result` events (both evals already parse this). Replay = feed recorded `result_json` to `extract()` in vitest — no browser/login/model. That is the deterministic gate, and how a licensed adapter goes green on access. Fixtures (committed): recorded snapshot strings + the MSE JSON blob.

## Acceptance criteria from my lens
- ~75% unit (extract/replay, coverage enforcement, registry, assertClaimable), ~20% fold integration, ~5% one nightly MSE canary (not per-PR).
- Local dev: adapters run from committed fixtures — no key, no edge.

## Edge cases I want addressed
- Concurrency: AgentBrowser is a singleton — one window, one logged_in partition; `beginRun` resets tabs on runId change. Two cases sourcing at once thrash the same window — serialize local sourcing per desktop.
- Portal drift / zero results → typed failure + screenshot; replay catches drift nightly.
