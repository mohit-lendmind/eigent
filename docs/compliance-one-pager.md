# Lendmind M2 — Compliance One-Pager

_Agent mesh, milestone M2 (`mesh-m2-watcher-onboarding`). Deliverable for FR-022 /
SC-007. Reproduce every claim below with `node scripts/demo-mesh-m2.mjs`._

## What M2 ships

Two agents and a thin `/crm` surface, layered on the M1 tamper-evident case log:

- **A1 — onboarding.** Builds a per-case-type checklist, drafts a welcome +
  document-request that carries the firm's disclosure refs verbatim, and raises
  **gate G1**. It never sends: the draft sits behind an approval the adviser
  edits and approves. Approval logs the _manual_ send onto the case chain.
- **A2 — watcher.** Runs on the firm's coordinator project on a `*/5` schedule.
  Each pass reads the firm case index + log heads, fast-path skips unchanged
  cases before any model spend, and fires real triggers (fixed-rate-end retention
  radar, stalled-case chase). Its decisions are **propose-only** — dispatch-ready
  payloads with the M3 directive seam left empty, plus worklist items and G7
  transition proposals. Nothing is dispatched live in M2.

## The audit spine (unchanged from M1, still holds under agent-written entries)

- **Tamper-evident chain.** Every agent write is a hash-chained `lm/case/<id>/<seq>`
  artifact. `verifyChain` recomputes the chain and names the exact seq of any
  break.
- **Kill-the-laptop convergence (SC-004).** Derived state is a fold of the log.
  Wipe every store to the floor and a refold reproduces the projection
  byte-for-byte — proven on an _agent-written_ chain in
  `test/unit/crm/convergenceWithAgents.test.ts`.
- **Compliance export v2.** `exportCaseFileV2` re-verifies the chain from the
  artifact store (never trusting a stored flag), stamps the verified head, and
  bundles the gate-policy snapshot + version provenance a reviewer needs. The
  demo emits the envelope to `test-results/demo-mesh-m2/envelope.json`.
- **Supervision metrics per pass (FR-014).** Each watcher pass records
  scanned/decided/skipped, breaker trips, and a `SpendRecord` with the FX basis
  (rate + effective date, GBP derived from USD in integer micros).

## Human-in-the-loop gates

G1 (onboarding send) and G7 (regulatory-meaning stage transition) are raised and
mirrored into the queue as **open** approvals. No regulated action leaves the
building without an adviser approving the specific gate instance. The gate
registry and delegation roster ride along in every v2 export.

## Leading-indicator metrics (FR-022)

Derived from the same fold the queue renders (`src/crm/ui/leadingMetrics.ts`), not
a separate telemetry pipe. Each metric carries its sample size so "0%" is
distinguishable from "no data yet".

| Metric | Definition | Source |
| --- | --- | --- |
| **Time-to-fact-find** | Median case-start → fact-find-ready duration | Fact-find spans |
| **% drafts approved unedited** | Approved onboarding drafts sent without an edit ÷ all approved | G1 gate mirror |
| **Adviser-minutes-saved** | _Modeled_ time reclaimed across drafts + watcher proposals | See constants |

The minutes-saved figure is a **modeled estimate**, not measured wall-clock:

- `MINUTES_SAVED_PER_DRAFT = 12` — an agent-drafted welcome + doc-request pack the
  adviser did not have to type.
- `MINUTES_SAVED_PER_WATCHER_DECISION = 8` — a proposal surfaced instead of a
  manual case review.

These constants are the documented assumptions for the leading dashboard and are
to be revisited with real timing data after M2.
