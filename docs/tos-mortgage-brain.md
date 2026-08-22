# Mortgage Brain connector — Terms-of-Service & recording record

> **Status: SCAFFOLD, `verified: false`.** The Mortgage Brain adapter ships with
> no recorded session and no `verification` reference. It derives `verified:false`
> and `assertClaimable` refuses any snapshot built from it out of the evidence
> pack and every client-facing surface. This document is the placeholder record a
> firm completes **before** a real session may be recorded, and the checklist the
> connector must clear before it can ever become `verified:true`.

## Why this connector is unverified by default

Mortgage Brain is a **licensed portal behind a firm login**. Unlike MSE (a public
tool served from an interceptable JSON endpoint), Mortgage Brain:

- exposes no interceptable results endpoint, so the adapter runs in a
  **logged-in session and scrapes the DOM results grid**;
- can only be accessed under a **firm's own credentials and licence**;
- must be used strictly within **Mortgage Brain's Terms of Service**.

We therefore **do not** bake a checked-in recording captured behind Mortgage
Brain's login, and we **never** hand-set `verified`. The honesty spine holds: a
licensed portal is unverified until a firm records a genuine session itself.

## ToS record (complete before recording)

| Field | Value |
| --- | --- |
| Portal | Mortgage Brain (Criteria Hub / sourcing) |
| Licence held by | _firm name — TBD_ |
| ToS reviewed on | _date — TBD_ |
| ToS permits automated retrieval under firm login | _yes / no — TBD_ |
| Data-scrubbing owner | _name — TBD_ |
| Credentials source | firm's own login (never Lendmind-held) |

Automated retrieval must be confirmed as permitted by the firm's Mortgage Brain
licence and ToS **before** any recording is made. If in doubt, do not record.

## Path to `verified: true`

The adapter becomes claimable only by earning a `canaryPassedAt`, and only in
this order — there is no shortcut and no hand-set flag:

1. **Record a real session** yourself, behind your firm's own Mortgage Brain
   login and within its ToS. Scrub it (see the scrubbing owner above).
2. **Run the live canary** against that recording:
   `EIGENT_MORTGAGE_BRAIN_CAPTURE=/path/to/scrubbed-capture.json \`
   `  npx playwright test --config e2e/eval.config.ts connector-mortgage-brain`
   The skipped test runs and the **same pure `mortgageBrainExtract`** parses the
   real grid. Only a passing live run emits a `canaryPassedAt`.
3. **Let the nightly writer** stamp that `canaryPassedAt` onto a
   `VerificationRef` (with the capture's `fixtureHash`, `ratesAsAt`, and
   `rawEvidencePointer`).
4. **Attach that ref** to `MORTGAGE_BRAIN_ADAPTER.verification`. The registry then
   derives `verified:true` — earned by evidence, never asserted.

Until step 1 happens, the connector's replay canary is **authored but red**: it
is skipped, and a companion test asserts the adapter stays `verified:false`.
