# Decision: building connectors without access to the brokers' tools

**Date:** 2026-08-22 · **Status:** binding on M4, M-portal, M8/DIP, and any lender/CRM/sourcing integration.

## Context
The product thesis is glue over the adviser's existing tools (Mortgage Brain, Twenty7Tec, Mortgage Magic, lender broker portals, MSE). We currently have **no credentials and no live access** to any of the licensed ones. Founder directive: build connectors for ALL of them.

## The reality
A browser-use connector to a licensed portal needs (a) a firm's logged-in session / licensed seat and (b) the live site to author selectors against and to test. Neither exists yet. Therefore a live, *verified* adapter for those tools cannot be built or claimed tonight. Pretending otherwise breaks the one thing we sell — a truthful audit record.

## Decision
1. **The framework is the deliverable, not any single adapter.** Build `SourcingAdapter`/connector interface (`buildQuery`, `extract`, `coverageStatement`, `write-back`), the LB4 logged-in delegation wiring, per-firm tool config, and a **record-and-replay eval harness** (author against a recorded session; replay in CI). Adapters are plugins.
2. **MSE is the verifiable v1 adapter** — public, no login (API-intercept-first per the recon). Build AND test it end to end.
3. **Licensed adapters (Mortgage Brain / 27Tec / Mortgage Magic) are built as config-gated scaffolds** against documented/fixture DOM, shipped behind per-firm config, each carrying a coverage statement and a **`verified: false` (pending-access)** flag. Their replay eval is written now and goes green when a real recorded session / credentials arrive.
4. **No connector is labelled "done" or demoed as live until it has a passing replay eval against a real recorded session.** Honesty over theatre.
5. **Credentials are a founder/firm input.** The single blocking input before any *live* adapter: design-partner #1 + their tool + a recorded session or a seat. Until then, framework + MSE + scaffolds.

## Consequence for the roadmap
- **M4 (sourcing/connectors)** = framework + MSE (verified) + licensed scaffolds (unverified-pending-access) + the replay harness. Fully buildable tonight; live licensed adapters are a fast-follow keyed to access.
- **M-portal** (client uploads) = our own hosted infra — buildable without third-party access (it's ours).
- **M8/DIP** (lender portal submission) = framework-ready, live-gated on lender portal access (returns as M-late per spec).
- Everything NOT requiring external access (M3 docintel, M5 criteria over a curated pack, M6 affordability, M7 admin, M8 evidence pack) is fully buildable and verifiable tonight.
