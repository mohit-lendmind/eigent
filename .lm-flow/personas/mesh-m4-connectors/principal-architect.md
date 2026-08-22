# Principal Architect perspective on mesh-m4-connectors

## What I support
- The plugin seam: `SourcingAdapter` as declarative `buildQuery→steps|apiPlan` / `extract→Product[]`, adapters as data. Riding `lm.directive/1` dispatch and writing `lm.sourcing.snapshot/1` (family known, major 1, `decodeSourcingSnapshot` exists) folds with zero new coupling to M1.
- Framework-not-adapter as the deliverable; the honesty gate — no "live" without a passing replay.

## What I want changed (Dissent:)
- Dissent: "API-intercept-first" is undeliverable for licensed adapters. `agentBrowser.ts` blocks `console_exec` in `logged_in` mode and `CDP_ALLOWED` carries no Network/Fetch domain. The adapters that need login are forced onto DOM-scrape — the brittle path; only isolated MSE gets intercept. Don't sell durability the executor can't give.
- Dissent: replay against a frozen fixture catches OUR `extract` regressions, never the portal's drift (doc line 48 is wrong). Only the live canary catches drift. Scope replay to extract.
- Dissent: `lb4Driver` must not call `browserDelegationExecutor` directly. The executor assumes it is the sole driver of one serialized window (chain/pump/kill-switch keyed by runId). A second caller forks the model. The adapter emits a plan; the agent loop + delegation pump execute it.

## What I would not ship without
- Snapshot as a small folding summary + the full set (recon: ~1,746 products) as a referenced attachment. A full set inline hits `foldSource` oversize and is silently skipped.
- Provenance the UI can't exceed: `verified` derived from a `verificationRef` + fixtureHash + `ratesAsAt` + a pointer to the raw enquiry evidence — not a self-set boolean. Enforce at the G5/evidence boundary, mechanically.
- Fixtures scrubbed of session tokens/CSRF/client PII — otherwise a residency leak and non-replayable.

## Acceptance criteria from my lens
- Two callers never drive the agent window; the adapter holds no `execute` reference.
- Oversize snapshot: summary folds, full set resolves by id; nothing dropped silently.
- `verified:false` mechanically blocks whole-of-market / evidence use at consumption.
- Every product traces to source bytes (the halifax grounding rule), by `traceId`.

## Edge cases I want addressed
- Tenancy: one `persist:user_login` partition = single-tenant-per-desktop; state it, scope coverage by directive `firmId`, never ambient desktop state.
- `writeBack?`/DIP: no browser-action idempotency key — drop from the M4 surface until G8 has one.
- Zero-results vs Cloudflare-challenge vs layout-drift: distinct typed failures, never one "empty".
