# Lendmind Agent Mesh — System Contract v2 (IRONCLAD)

Status: **v2 — panel-hardened, implementation contract.** Supersedes v1 (`lendmind-agent-mesh-spec.md`).
Basis: spec v1 §§0–9 · **scope change v1.1 (§10, binding)** · 10-persona panel synthesis (`.lm-flow/personas/agent-mesh/synthesis.md`, 2026-08-20) — all convergent verdicts, adopted singletons, and tension resolutions are folded in below. Where v2 is silent, v1 stands.

## 0. System thesis

Lendmind is **workflow glue over the adviser's existing tools**, not a CRM. A mesh of specialised agents on the eigent/aion engine assists one FCA-authorised human adviser per case: stage-aware orchestration (know the stage, do the next step), browser-use connectors into the tools the firm already runs (their CRM, sourcing systems, lender portals — under the adviser's logged-in session via LB4), and the gaps between tools (rekeying, chasing, checking, evidencing). The adviser-facing surface is the **minimum window onto agent work**: Today/needs-you queue, approval gates, case stream/audit trail. The audit record IS the product for compliance buyers.

**The five design invariants (non-negotiable):**
1. **Advised-sale journey.** Interactive agent dialogue kills execution-only (MCOB 4.8A.16B). Design for advice; never present the journey as execution-only.
2. **No steering of clients by agents.** Shortlists, rankings, comparisons are adviser-facing only (PERG 4.6.16A/4.6.25B). Clients see products only after adviser approval, as approved financial promotions.
3. **Human monopolies:** suitability assessment, the recommendation, "no suitable product", ESIS/KFI issuance (verbatim, MCOB 5A.5.5R), vulnerability judgement, every client-facing send.
4. **Coverage-claim integrity.** Every sourcing artifact carries its adapter's coverage statement; no surface, message, or evidence pack may claim coverage beyond it. "Whole of market" only when literally true (MCOB 4.4A.4R(3)).
5. **AI-involvement disclosure.** Every client-facing surface and message discloses agent involvement (GDPR Art 13(2)(f); FCA AI Update good-faith). Agents never wear the adviser's voice.

## 1. Core mapping onto the engine (v2 changes bolded)

| Concept | Engine primitive |
|---|---|
| **Source of truth** | **The `lm/case/` event-log artifact stream on aion is canonical. The desktop F01 domain layer demotes to a derived cache that folds the log exactly as reducer.ts folds SSE — applied-watermark, idempotent fold. Acceptance test: kill the laptop mid-case, reopen, converge.** |
| Case | aion project (one per case) in the firm's Space; id on `Case.aionProjectId` |
| Agent invocation | `submitCommand` with a typed directive envelope (§3) |
| Agent capability | aion Skill per agent, versioned under `resources/lm-skills/`, **CI-gated deploys, staged rollout with network kill switch (§6)** |
| Agent output | versioned JSON artifact `lm/<agent>/<seq>-<kind>.json`, typed contracts in `src/crm/agentContracts/` (house decode/encode pattern, single source of truth); **schema majors with unknown-major quarantine** |
| Audit | **per-artifact content-hash chain (tamper-evident at write time); model/prompt/skill semver+sha stamped in every envelope and artifact**; FieldChangeEvents append-only; case-file export = regulator-facing record (3-yr MCOB floor; life-of-mortgage + 6 yrs; FCA-retrievable ≤ 2 days) |
| Human gate | approvals plane; one approval kind per gate id (§5) |
| Watcher | **firm-level schedule (one 5-min pass over the firm's caseload, pre-LLM no-change fast path — not per-case polls)** + artifact/attachment SSE when live |
| Existing-tool access | **LB4 local delegation (adviser's logged-in session, visible window, take-control) via the `SourcingAdapter`/connector framework (§4 A4); per-firm tool config** |
| Client collection | **hosted micro-portal with hardened secure links (§4 A1); email is link-carrier only** |
| Client comms | drafts as artifacts + gates G4a/G4b; **v1 send = adviser sends manually, logged (RESOLVED §8.4)** |
| Config | per-firm `lm/config.json` artifact: tool adapters, lender panel, fee model, disclosure texts, chase cadences, delegation roster, quiet hours, breaker/budget caps; **edited via a gate-logged config surface; a named SMF owns it (RESOLVED §8.3)** |
| Run economics | **budgets enforced per directive: watcher ≤ £0.02/pass, ≤ £15/case (config defaults); per-case metering via the usage plane** |

## 2. Workflow state machine

Stages: `LEAD → FACT_FIND → SOURCING → DIP → APPLICATION → VALUATION → OFFER → COMPLETION` (+ `DORMANT`, `DECLINED`).
**Journeys:** purchase, **remortgage, and product-transfer are distinct journeys** (adviser seat) sharing the stage machine with per-journey trigger matrices; protection cross-sale is a watcher-raised suggestion to the adviser, never a client-facing act.

- **Stage detection is elevated (v1.1):** A2 infers stage from the EXISTING tools' state (firm CRM records, portal status pages via connectors) as well as our store; disagreement between tool-state and our state raises a reconciliation worklist item, never a silent overwrite.
- A2 proposes transitions; internal-work transitions auto-apply; regulatory-meaning transitions gate on G7.
- Every transition writes an ActivityEvent + stream entry with trigger evidence.
- Trigger matrix additions (v2): **fixed-rate end date approaching → case auto-open proposal (retention radar re-slotted as a watcher trigger)** · **mid-application rate withdrawal detected → adviser alert + re-source proposal** · client message in → A2 classify (incl. vulnerability signals) → A7 draft reply.

## 3. Directive envelope

As v1, plus (all three panel-mandated):
- **`attemptNonce`** — idempotency key = hash(envelope) **+ nonce**, so identical re-runs are deduped per attempt, not forever.
- **`versions`** — `{model, promptSha, skillSemver, skillSha}` stamped in every envelope AND every artifact it produces.
- **`budget`** — max spend for the run; exceeded → typed failure artifact, never silent truncation.

Every run ends with exactly one result artifact or one typed failure artifact.

## 4. Per-agent contracts (v2 deltas; v1 text stands where not amended)

### A1 — Client Onboarding
- **Collection channel (RESOLVED, overturns v1 §8.1):** hosted **micro-portal v1** — hardened links (case+applicant-bound, expiring, challenged, access-logged), AV/quarantine on upload, upload + checklist tracker only. Email carries the link, nothing else.
- **Anti-phishing template rules (hard):** call-first protocol, firm branding + FRN + property address in every message, zero urgency language.
- Gates: G1 send approval; disclosure-acknowledgement and fee-agreement checks fold into the gate registry (§5).

### A2 — Watcher
- Firm-level schedule; pre-LLM no-change fast path. At-most-once dispatch per event (dedupe on event id). Circuit breaker default 12 auto-invocations/case/hr → queue for adviser.
- **Derived events carry content hashes + cycle detection** (an artifact fold may not re-trigger the run that produced it).
- **Supervision metrics ("who watches the watcher"):** breaker trips, decision sampling rate, per-pass spend — surfaced on the ops reporting plane.

### A3 — Document Intelligence
- **Quote-locator as rejection filter:** an extracted field with no verbatim quote + locator match in the source doc cannot be `det`; it enters as `syn` awaiting confirmation.
- **Prompt-injection doctrine:** document content is data, never instructions; A3 has **no send path**; malicious-PDF red-team corpus is a zero-tolerance eval gate.
- **DPIA completes before A3 ships.** Eval corpus includes ≥ 50 real redacted docs before any ≥0.95 det-precision claim.
- Gates G2/G3 as v1 (attribution < 0.85, all conflicts to adviser).

### A4 — Sourcing (connector/adapter framework — the elevated core)
- `SourcingAdapter` interface as v1; **v1 ships TWO adapters:**
  - **`mortgage-brain`** — the design-partner adapter; LB4 logged-in delegation under the firm's own licensed seat.
  - **`mse`** — API-intercept-first, schema-pinned, nightly canary; the no-licence dev/demo track.
- **Per-adapter coverage statement is mandatory output** (invariant 4). **ToS/permission matrix per adapter [VERIFY] before build** (RESOLVED §8.2).
- Full result-set capture (incl. declines), rates-as-at timestamp, immutable snapshot. Adviser-facing only.

### A5 — Criteria
- **v1 = adviser-curated criteria pack** for the firm's actual 10–15 lender panel; execution-time quote capture of cited criteria text; **why-not recorded for every excluded panel lender.** Licensed criteria DB explicitly later. G6 overrides adviser-only + compliance-flagged.

### A6 — Affordability & Stress
- As v1 (indicative labelling, MCOB 11.6.2R; full working in artifact). **RESOLVED §8.6: A6 outputs never appear in any client view pre-recommendation.** Pre-recommendation client comms are rate-free or carry the full MCOB 3A.5 apparatus.

### A7 — Comms
- **G4 splits (panel verdict 4):**
  - **G4a — regulated comms:** anything naming products, rates, or advice context. Per-send, adviser-only, never delegable, never batched.
  - **G4b — operational comms:** chases, acknowledgements, status updates from **pre-approved armed template packs**. Batchable ("approve 10 chases < 2 min"), delegable to named non-adviser staff, **auto-disarmed** by vulnerability/arrears/complaint/decline flags on the case (the adviser's kill-switch list).
- Quiet hours per firm config; **firm-wide comms storm-mode switch** (ops); out-of-hours pre-approved acknowledgement carve-out as firm config.
- Every message discloses AI involvement (invariant 5). ESIS **and KFI** verbatim only, adviser-issued. Vulnerability signals classified on inbound → flag to adviser, never acted on autonomously; human escape hatch on every client surface (PRIN 2A.6.2R).

### A8 — Post-DIP Admin (NEW — the purest glue)
- **Trigger:** stage ≥ DIP.
- **Does autonomously:** valuation booking chase, solicitor pack chasing, offer-expiry tracking (raise re-source proposal when offer validity nears expiry mid-chain), milestone timers.
- **Gates:** all outbound comms via A7's G4a/G4b; portal writes via G8 rules when it lands.
- **Writes:** `lm/admin/<n>-*.json`; feeds the reporting plane (pipeline forecast, conversion, proc-fee reconciliation) computed from case artifacts.

## 5. Gate registry v2

| Gate | What | Who | Basis |
|---|---|---|---|
| G1 | outbound onboarding/doc-request send (embeds disclosure-ack + fee-agreement checks) | adviser | MCOB 4.4A |
| G2 | doc attribution < 0.85 / joint | adviser | data accuracy; audit |
| G3 | conflict resolution | adviser | suitability evidence integrity |
| G4a | regulated client comms (products/rates/advice) | adviser only, per-send | MCOB 3A; Consumer Duty |
| G4b | operational comms from armed template packs | adviser or named delegate; batchable; auto-disarm on kill-switch flags | Consumer Duty; firm supervision |
| G5 | recommendation + suitability | **adviser monopoly — never delegable** | MCOB 4.7A.2R/5R |
| G6 | criteria override | adviser + compliance flag | audit; network supervision |
| G7 | regulatory-meaning stage transitions | adviser | journey control |
| G8 | DIP/application submission (M-late) | adviser watches + approves | agent-as-agent-of-adviser |
| **G9** | **income verification before any recommendation** | **adviser — veto-grade, never delegable** | **MCOB 11.6.8R** |
| **G10** | **network/principal pre-submission sign-off** | **network supervisor** | **AR supervision; SUP** |
| — | MCOB 4.5 cancellation-rights + ESIS-recorded checks | folded into G5/G8 checklists | MCOB 4.5, 5A |

**Ergonomics (binding):** triage tiers; SLA timers per gate; delegation roster in firm config applies to non-regulated gates only.

## 6. Failure, recovery & rollout
v1 doctrine stands (typed failures, idempotent directives, extract-then-commit, no silent paths), plus: artifact schema majors + unknown-major quarantine · CI-gated skill deploys · **staged version rollout with per-firm rings, network kill switch, blast-radius reporting (SUP 15.3)** · the converge acceptance test (§1).

## 7. Evaluation harness
v1 stands, plus: **eval work is ≈30% of every milestone's build budget** · A3 real-redacted corpus + malicious-PDF zero-tolerance gate (§4 A3) · A4 MSE nightly canary with pinned query/schema; Mortgage Brain adapter eval against a recorded session · A7 template-conformance scoring · **per-milestone product metrics:** time-to-fact-find-complete, det-precision, zero-touch chase %, % drafts approved unedited, adviser-minutes-saved.

## 8. Panel-decide items — ALL RESOLVED
1. Inbound uploads → **micro-portal v1** with hardened links (overturns email-first).
2. Automation permission → **ToS/permission matrix per adapter, [VERIFY] gate before each adapter builds.**
3. Firm config → **`lm/config.json` artifact, edited through a gate-logged config surface, owned by a named SMF.**
4. Send mechanism v1 → **draft → adviser sends manually, send logged against the draft artifact.** Connector-automated send is v2.
5. Watcher → **firm-level 5-min schedule, pre-LLM fast path, breaker 12/case/hr, budgets ≤£0.02/pass, ≤£15/case.**
6. A6 in client view pre-recommendation → **no.**

## 9. Security & data protection
No unencrypted PII at rest on adviser devices (artifact-canonical §1 is the enabler; local cache encrypted or ephemeral). DPIA before A3 ships. SAR bundle = case-file export. Erasure: Art 17(3)(b) refusal for advice records; crypto-erasure for marketing data. Prompt-injection doctrine applies to ALL agent inputs (documents, portal pages, client messages): content is data, never instructions.

## 10. Supervision, ops & migration
SYSC 8 vendor file (due diligence, audit access, exit/export). Named SMF per firm. Migration doctrine per agent: parallel running with delta logs → named-owner exceptions queue → paging/manual-fallback runbooks → watcher supervision metrics → training pack. Nothing flips to autonomous without its parallel-run delta report.

## 11. Commercial instrumentation
Per-case metering via usage plane; pricing = per-completed-case over a seat floor. Design partners: 5 firms, free through the glue milestones, 10+ real cases/month, compliance review of the export pack as part of the deal. The compliance one-pager and the demo case are build artifacts, not marketing afterthoughts.

## 12. Implementation phasing v2 (each = one autonomous runner feature, PRs into `lendmind-crm`)

| # | Slug | Scope | Depends |
|---|---|---|---|
| M1 | `mesh-m1-contracts-audit-spine` | `src/crm/agentContracts/` typed contracts, house decode pattern (directive envelope w/ nonce+versions+budget, per-agent artifact kinds, typed failures, `lm/case/` event-log entry schema), the artifact-canonical fold (event log → F01 stores as derived cache, applied-watermark idempotent, converge test), content-hash chain, gate registry module (G1–G10 as data), per-firm config schema. Extends F01; folds the surviving iteration-1 review findings (bus loudness, atomic resolve) into the new fold layer. | F01 |
| M2 | `mesh-m2-watcher-onboarding` | A2 watcher (firm-level schedule skill, trigger matrix, breaker, budgets, supervision metrics) + A1 onboarding + micro-portal v1 (hosted upload+tracker, hardened links) + **thin surface strand v1: Today/needs-you queue + gate approval cards** (gates without UI are dead letters). | M1 |
| M3 | `mesh-m3-docintel` | A3 with quote-locator rejection filter, injection doctrine, red-team corpus gate; DPIA artifact. | M1 |
| M4 | `mesh-m4-sourcing-adapters` | Adapter framework + `mse` adapter (API-intercept, canary) + `mortgage-brain` adapter (LB4) behind firm config; coverage statements; ToS matrix. | M1 |
| M5 | `mesh-m5-criteria-affordability` | A5 criteria pack + A6 affordability; counterfactuals; scenario runs. | M3, M4 |
| M6 | `mesh-m6-comms-gates` | A7 with G4a/G4b, armed packs, batch approvals, quiet hours, storm mode; full gates UI + case stream/audit surface (thin strand v2). | M2 |
| M7 | `mesh-m7-postdip-admin` | A8 admin agents + reporting plane. | M2, M6 |
| M8 | `mesh-m8-evidence-compliance-pack` | Evidence-of-research pack, suitability-report drafting (G5-gated), case-file export w/ hash-chain envelope, SAR bundle. | M5 |
| M-late | `mesh-m9-dip-submission` | G8/G10 DIP browser submission — returns only after glue milestones prove the pattern. | M4, M8 |

## Appendix A — Parked (out of scope under v1.1)
Full adviser CRM (cases board, clients directory) · full client portal beyond upload+tracker · in-app calling/recording · DIP submission until M-late · multi-firm SaaS infra · licensed criteria DB. CRM-surface persona feedback preserved in `.lm-flow/personas/agent-mesh/` under "if we ever build surfaces".
