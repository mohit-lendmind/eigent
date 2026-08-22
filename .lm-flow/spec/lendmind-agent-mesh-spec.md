# Lendmind Agent Mesh — System Contract v1 (for panel review)

Status: SUPERSEDED by lendmind-agent-mesh-spec-v2.md (panel-hardened, 2026-08-22). Kept for the dissent record.
Inputs: Bharat's 8-point brief (2026-08-20) · `.lm-flow/recon/eigent-codebase-map.md` · `.lm-flow/recon/lendmind-advisor-design-reference.md` · `.lm-flow/recon/fca-agentic-compliance.md` (FCA, citations verified) · `.lm-flow/recon/sourcing-mse-recon.md` (MSE) · F01 domain layer (`src/crm/`).

## 0. System thesis

Lendmind is a mesh of specialised agents running on the eigent/aion engine, assisting one FCA-authorised human adviser per case. Agents work autonomously up to hard regulatory gates; the adviser owns every regulated judgement. The CRM (adviser view) and portal (client view) are projections of agent state. Everything every agent does is audited with provenance, citations, and calibrated confidence — the audit record IS the product for compliance buyers.

**The three FCA design invariants (non-negotiable, from fca-agentic-compliance.md):**
1. **Advised-sale journey.** Interactive agent dialogue kills execution-only (MCOB 4.8A.16B). Design for advice; never present the journey as execution-only.
2. **No steering of clients by agents.** Product shortlists, rankings, and comparisons are adviser-facing only (PERG 4.6.16A/4.6.25B). Clients see products only after adviser approval, as approved financial promotions.
3. **Human monopolies:** suitability assessment, the recommendation, "no suitable product", ESIS issuance (verbatim, MCOB 5A.5.5R), vulnerability judgement, and every client-facing send.

## 1. Core mapping onto the engine

| Concept | Engine primitive |
|---|---|
| Case | aion **project** (one per case), filed in the firm's Space; project id stored on `Case.aionProjectId` |
| Agent invocation | `submitCommand` with a typed **directive envelope** (§3); run = SSE event fold |
| Agent capability | aion **Skill** per agent (`lm-onboarding`, `lm-watcher`, `lm-docintel`, `lm-sourcing`, `lm-criteria`, `lm-affordability`, `lm-comms`), versioned in-repo under `resources/lm-skills/`, deployed via PUT /skills |
| Agent output | versioned JSON **artifact** named `lm/<agent>/<seq>-<kind>.json` conforming to schemas in `src/crm/agentContracts/` (single source of truth, zod) |
| Human gate | **approvals plane** (`approval_required` → ApprovalCard → response), one approval kind per gate id (§5) |
| Watcher | **schedules plane** (poll cadence 5 min) + artifact/attachment SSE events when live |
| Browser-use sourcing | **LB4 local delegation** (adviser's logged-in session, visible window, take-control) or pod browser for MSE (no login needed) |
| Audit | F01 domain layer: `FieldChangeEvent` (append-only), `ConflictRecord`, stream `ReasoningTrace`s + artifact version history; case-file export = regulator-facing record (3-yr MCOB floor; retain life-of-mortgage + 6 yrs; FCA-retrievable ≤ 2 days) |
| Client comms | drafts as artifacts + approval gate; sends via adviser's channels (v1: mailto/manual + logged; v2: connectors) |
| Config | per-firm `lm/config.json` artifact: sourcing portal adapter, lender panel, fee model, disclosure texts, chase cadences |

## 2. The workflow state machine

Stages: `LEAD → FACT_FIND → SOURCING → DIP → APPLICATION → VALUATION → OFFER → COMPLETION` (+ `DORMANT`, `DECLINED`).
- **A2 Watcher proposes transitions**; transitions that only advance internal work (LEAD→FACT_FIND on intake complete) auto-apply; transitions with regulatory meaning (→SOURCING when fact find ≥ threshold; →DIP after recommendation) require adviser confirmation.
- Every transition writes an `ActivityEvent` + stream entry with the trigger evidence.
- Trigger matrix (event → agent): `case.created→A1` · `attachment/artifact added→A2→A3` · `factfind.section-complete→A2→(A6, A4 when eligible)` · `A4.snapshot→A5→A6` · `A5+A6 done→A7 draft "rates ready"` · `checklist overdue→A7 chase draft` · `client message in→A2 classify→A7 draft reply`.

## 3. Directive envelope (every agent invocation)

```json
{ "kind": "lm.directive/1", "agent": "lm-sourcing", "caseId": "...", "directive": "...",
  "inputs": { "factFindDigest": "sha256...", "artifacts": ["lm/docintel/3-extraction.json"] },
  "constraints": { "portal": "mse", "maxLtiCap": null },
  "issuedBy": {"kind": "adviser"|"watcher"|"schedule", "id": "..."},
  "gatePolicy": "per §5", "traceId": "..." }
```
Idempotency: `command_id` = hash(envelope); re-issue is safe. Every run MUST end with exactly one result artifact (or a typed failure artifact `lm/<agent>/<seq>-failure.json` with reason + retry hint).

## 4. Per-agent contracts

### A1 — Client Onboarding (`lm-onboarding`)
- **Trigger:** case created (from AI intake or manual).
- **Reads:** case, applicants, checklist template, firm config (disclosure texts, fee model).
- **Does autonomously:** builds the document checklist per case type; drafts the welcome + doc-request message (channel per client preference); prepares the client-view intake session script pre-filled from known facts.
- **Gate G1 (MANDATORY):** adviser approves the outbound send. The first message MUST embed/attach initial disclosure (scope of service, fees, commission basis — MCOB 4.4A.1R/4R/8R) in durable form + GDPR privacy notice; template text comes from firm config, never generated per-send.
- **Writes:** `lm/onboarding/<n>-request.json` (checklist, message, disclosure refs), comms record, checklist state `requested`, audit.
- **Failure modes:** missing disclosure config → typed failure, never send; unknown client email → gate to adviser.
- **v1 collection channel:** email with secure link to the client view; inbound uploads land via [PANEL-DECIDE §8.1].

### A2 — Watcher (`lm-watcher`)
- **Trigger:** schedule (5-min poll) + event stream when live.
- **Does autonomously:** classifies new material (document/message/portal event) to case + applicant; decides next step per trigger matrix; issues directive envelopes to downstream agents; proposes stage transitions; maintains chase timers.
- **Gate:** none of its own — it may only *invoke* agents whose own gates then apply. It may never message a client or alter the fact find itself.
- **Writes:** `lm/watcher/<n>-decision.json` (event, classification, action taken, reasoning trace), ActivityEvents.
- **Invariants:** at-most-once dispatch per event (dedupe on event id); circuit breaker — max N automatic invocations per case per hour (config, default 12) → beyond that queue for adviser.

### A3 — Document Intelligence (`lm-docintel`)
- **Trigger:** A2 on new document.
- **Does autonomously:** classify type (passport, payslip, P60, contract, bank statement, gift letter, accounts…); OCR/extract typed insights with per-insight confidence; attribute to applicant (name/NI/address cluster); write `det` fact-find fields with `hint` = document + locator; run cross-document consistency checks (materiality threshold 1%); raise `ConflictRecord`s; update checklist items to `received`.
- **Gates:** attribution confidence < 0.85 or joint docs → G2 confirm-attribution; ALL conflicts → G3 adviser resolution (never auto-resolve); synthesized inferences (`syn`) always await confirmation.
- **Writes:** `lm/docintel/<n>-extraction.json` (insights, citations with page/line locators, confidences), FieldChangeEvents (`actor:'agent'`, origin artifact id), conflicts, checklist updates.
- **Quality bar:** every written field carries a verbatim quote + locator from the source doc; no quote → goes in as `syn`, not `det`.

### A4 — Sourcing (`lm-sourcing`, browser-use)
- **Trigger:** fact-find completeness ≥ 0.8 with income det-confirmed, or adviser directive.
- **Adapter architecture:** `SourcingAdapter` interface (`buildQuery(case) → portal steps`, `extract(page/api) → products[]`, `coverageStatement()`); v1 adapter `mse` (deep-link query params + JSON API per recon: `/mse/best-buys/api/v1/enquiry`; cookie-consent "essential only"; real-Chrome profile); later `mortgage-brain`, `twenty7tec`, `mortgage-magic` adapters using LB4 logged-in delegation.
- **Does autonomously:** runs the scan; captures the FULL result set (not just top N — evidence rule), rates-as-at timestamp, coverage statement ("MSE Best Buys (Podium data): all direct deals + most broker deals" — NEVER "whole of market" for MSE; MCOB 4.4A.4R(3)); normalizes to the Product schema (rate, APRC, fees by type, monthly, revert rate, ERC, incentives, true cost).
- **Gate:** output is ADVISER-FACING ONLY (invariant 2). Recommendation selection = human. Client never sees this artifact.
- **Writes:** `lm/sourcing/<n>-snapshot.json` — immutable, referenced by evidence of research; full result set retained (execution-time capture, per FCA record rules).
- **Failure modes:** portal layout change → typed failure with screenshot artifact; Cloudflare challenge → retry via LB4 real browser; zero results → escalate, never silently retry with loosened constraints.

### A5 — Criteria Search (`lm-criteria`)
- **Trigger:** after A4 snapshot.
- **Reads:** fact find, docintel extractions, comms context (calls/emails/messages — e.g. "job started in January" from a portal message), firm lender panel.
- **Does autonomously:** derives applicable criteria facts (employment tenure/probation, income composition, gift deposits, adverse credit, property construction, visa status…); checks each shortlisted lender's published criteria; verdict per lender-criterion with citation (source doc/page/version + retrieval date); produces counterfactuals ("re-source after 6 Jul when tenure crosses 6 months").
- **Gates:** warnings surfaced to adviser; **criteria overrides are adviser-only and compliance-flagged** (design ref pattern 6).
- **Writes:** `lm/criteria/<n>-verdicts.json`; execution-time capture of cited criteria text (lender criteria change — the quote at decision time is the evidence).

### A6 — Affordability & Stress (`lm-affordability`)
- **Trigger:** income section det-complete; re-runs on any income/expenditure/product change.
- **Does autonomously:** LTI (flag >4.5x — flow-limit context), per-lender caps and max-borrowing table, stress at reversion rate ≥ +1pp over 5 yrs (MCOB 11.6.18R mirror), scenario runs (adviser-directed: "6% reversion", "£270k purchase").
- **Labelling invariant (MCOB 11.6.2R):** every output carries "Indicative — the lender's own assessment decides" — affordability is legally the lender's; the agent must never present its model as a lending decision. Pure arithmetic, so no approval gate; but any CLIENT-visible figure travels only inside A7's gated comms.
- **Writes:** `lm/affordability/<n>-model.json` with full working (inputs, formulas, stress basis) — the trace IS the artifact.

### A7 — Comms Drafting (`lm-comms`)
- **Trigger:** milestones (rates ready post-recommendation, chase due, client question in, status update), or adviser directive.
- **Does autonomously:** drafts in client's channel + reading level (Consumer Duty consumer-understanding); tone-matches thread; schedules auto-chases (schedules plane); routes third-party asks via client as conduit; classifies inbound client messages.
- **Gate G4 (MANDATORY, every send):** adviser approves each outbound client message. Any message naming products/rates is a **financial promotion**: template from network-approved set (MCOB 3A.2.4R evidence retained), APRC representative example where triggered (3A.5), repossession risk warning hard-coded in template not generated. ESIS is NEVER drafted or paraphrased by this agent — verbatim lender/sourcing-system document only, issued by the adviser.
- **Vulnerability:** inbound classification includes vulnerability signals → flags to adviser, never acts on them autonomously; human escape hatch in every client surface (PRIN 2A.6.2R).
- **Writes:** `lm/comms/<n>-draft.json`, comms records with send/approval audit, chase schedule refs.

### Cross-cutting — Audit
Every agent: reasoning trace (claim/working/evidence-with-quotes/alternatives/confidence/calibration) on every material output; FieldChangeEvents for every fact-find write with `origin {artifactId, runId}`; artifact immutability (new version, never mutate); case-file export bundles all agent artifacts + approvals + comms; retention life-of-mortgage + 6 yrs, tamper-evident (content-hash chain in export envelope).

## 5. Gate registry

| Gate | What | Who | FCA basis |
|---|---|---|---|
| G1 | outbound onboarding/doc-request send | adviser | MCOB 4.4A disclosure at first contact |
| G2 | doc attribution < 0.85 / joint | adviser | data accuracy; audit |
| G3 | conflict resolution | adviser | suitability evidence integrity |
| G4 | every client-facing message | adviser | fin-promo MCOB 3A; Consumer Duty |
| G5 | recommendation selection + suitability | adviser (monopoly) | MCOB 4.7A.2R/5R |
| G6 | criteria override | adviser + compliance flag | audit; network supervision |
| G7 | stage transitions with regulatory meaning | adviser | journey control |
| G8 | DIP/application submission (later phase) | adviser watches + approves | agent-as-agent-of-adviser |

## 6. Failure & recovery doctrine
Typed failure artifacts; idempotent directives; watcher circuit breaker; agent runs never partially mutate the fact find (extract-then-commit: propose artifact → apply step writes atomically via F01 actions); every silent-failure path is forbidden — unwired/unavailable dependencies fail loud into the worklist.

## 7. Evaluation harness
Per agent: golden-path fixtures (c417/c392) as eval inputs + recorded `e2e/*.eval.ts` runs (house pattern); A4 gets a live MSE eval with pinned query and schema assertions; A3 gets a document corpus (synthetic payslips/P60s/contracts) with extraction F1 targets (≥0.95 det-field precision — a wrong det field is worse than a missing one); A7 drafts scored against template conformance (disclosure present, no unapproved product claims).

## 8. PANEL-DECIDE items
1. **Inbound client uploads**: (a) hosted micro-portal (new infra), (b) email-reply ingestion into a monitored mailbox (the codebase has `get-email-folder-path` IPC — an email-folder watcher exists in embryo), (c) aion attachment relay. Recommendation: (b) for v1 with strict sender-matching + virus scan, (a) as v2.
2. Sourcing portal ToS/permission for automation per adapter (MSE robots signals allow AI access; Mortgage Brain/Twenty7Tec need firm's own licensed seats via LB4) — [VERIFY] per adapter before build.
3. Where firm config lives (artifact vs settings surface) and who edits it.
4. Comms send mechanism v1 (draft→adviser sends manually vs connector-automated send post-approval).
5. Watcher cadence + circuit-breaker defaults.
6. Whether A6 outputs may appear in the client view at all pre-recommendation (recommendation: no).

## 9. Implementation phasing (post-panel; each = autonomous runner feature)
M1 agent contracts + directive/artifact schemas + audit spine (extends F01) · M2 watcher + onboarding (email v1) · M3 docintel · M4 sourcing (MSE adapter) · M5 criteria + affordability · M6 comms + gates UI · M7 adviser CRM surfaces over agent state (reuses F02 recon) · M8 client view · M9 DIP submission (browser-use, G8) · M10 evidence-of-research + compliance pack.

---

## 10. SCOPE CHANGE v1.1 (Bharat, 2026-08-20, binding on panel synthesis)

**Lendmind is the workflow glue, not a CRM.** The marriage is: Lendmind's caseload vision (stage machine, fact find, audit, gates) + eigent's agents. We do NOT build CRM journeys or replace the adviser's existing tools. We build:

1. **Stage-aware orchestration** — agents that understand which stage a case is in and what the next step is, then do it: product sourcing → source it; criteria search → do it; affordability test → run it.
2. **Browser-use connectors to EXISTING tools** — the adviser's current CRM, sourcing systems (Mortgage Brain / Twenty7Tec / Mortgage Magic — per-firm config), lender portals. Agents read from and write into those tools under the adviser's logged-in session (LB4).
3. **The gaps between tools** — the rekeying, chasing, checking, evidencing that today happens by hand between systems.

**Deprioritized (not deleted):** M7 adviser CRM surfaces, M8 client view as full products. The adviser-facing surface shrinks to: the Today/needs-you queue, approval gates, the case stream/audit trail — the minimum window onto agent work. Client-facing surfaces limited to what collection strictly requires.
**Elevated:** the stage-detection capability (agents infer stage from the EXISTING tools' state, not only our store), the connector adapter framework, and per-firm tool configuration.
**Panel synthesis instruction:** apply all agent/gate/FCA/ops feedback to this narrowed scope; park CRM-surface feedback in a "if we ever build surfaces" appendix.
