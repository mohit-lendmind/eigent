# Lendmind Agent Mesh — System Spec (outline v0, pending FCA + MSE research integration)

> The reframe (Bharat, 2026-08-20): Lendmind is a multi-agent system running on eigent. Agents do the work;
> the CRM is the adviser's window onto agent state; the client view is the customer's window.
> This outline becomes the full spec once fca-agentic-compliance.md and sourcing-mse-recon.md land,
> then goes to the extended persona panel until ironclad.

## 1. The agent roster (from Bharat's brief, normative)

| # | Agent | Trigger | Autonomous scope | Human gate | Writes |
|---|---|---|---|---|---|
| A1 | Client Onboarding | case created | drafts doc-request email w/ secure link; runs client-view intake | adviser approves send (FCA: financial-promotion + disclosure check) | comms record, checklist, portal session |
| A2 | Watcher | new upload / message / portal event on any case | classifies the event, decides + triggers next workflow step | none for triggering analysis; gates inherited from triggered agent | workflow transitions, activity log |
| A3 | Document Intelligence | A2 on new document | classify, extract, attribute, write det fields into fact find w/ provenance + confidence; raise conflicts | low-confidence attributions + all conflicts to adviser | fact-find fields, insights, conflicts, FieldChangeEvents |
| A4 | Sourcing (browser-use) | fact-find threshold or adviser directive | drives configured sourcing portal (MSE first; Mortgage Magic / Mortgage Brain / Twenty7Tec adapters later) with case details; extracts product set | adviser selects recommendation | sourcing snapshot artifact (products, rates, coverage statement) |
| A5 | Criteria Search | after A4 shortlist | checks each shortlisted lender's criteria against fact find + doc intelligence + comms context (calls, emails, messages) | criteria warnings surfaced; overrides are adviser-only + compliance-flagged | criteria verdicts w/ citations |
| A6 | Affordability & Stress | fact-find income complete or A4/A5 run | LTI, per-lender caps, stress at reversion + configurable scenarios | none (arithmetic), but outputs labelled per FCA MCOB 11.6 boundaries | affordability model artifact |
| A7 | Comms Drafting | milestones (rates ready, chase due, reassurance) | drafts client comms in channel + tone; schedules chases | EVERY client-facing send is adviser-approved (Consumer Duty / fin-promo) | draft comms, audit of send + approval |
| — | Audit (cross-cutting) | every agent action | append-only audit trail: actor, inputs, outputs, citations, confidence, approvals | n/a | the case audit record (3-yr retention, exportable) |

## 2. Mapping onto eigent/aion primitives (the engine we already have)

- **Agent run** = aion project command (`submitCommand`) + SSE event fold; each case = an aion project (or space) so runs, artifacts, approvals, comments attach natively.
- **Skills** = each agent's capability packaged as an aion Skill (PUT /skills) — versioned, auditable.
- **Watcher** = /schedules plane (cron poll) + event-driven triggers; upload detection via attachments/artifacts events.
- **Browser-use sourcing** = LB4 local delegation stack (visible window, logged-in session, take-control) — pod browser for headless MSE.
- **Human gates** = approvals plane (`approval_required` → ApprovalCard → response), already wired.
- **Audit** = F01 domain layer (FieldChangeEvents, ConflictRecords, stream w/ ReasoningTraces) + artifact versioning; case-file export is the regulator-facing record.
- **Client view** = the portal surface (design ref §4.18–4.19); secure links = presigned artifact grants + a hosted upload target [OPEN: hosting surface for inbound client uploads — needs decision].
- **Configurability** = sourcing portal adapter registry (per-firm config: which portal, credentials via connectors plane).

## 3. Contracts to be specified per agent (the ironclad part)

For EACH agent: purpose; trigger contract (event schema); input contract (what case state it reads); output contract (versioned structured artifact JSON schema); provenance rules (det/syn, citations, confidence, calibration); failure modes + retries + idempotency; human-gate definition; audit records; FCA constraints (from research); test/eval harness (golden-path fixtures + recorded evals).

## 4. Workflow state machine

Case stages (LEAD→…→COMPLETION) with agent-driven transitions; A2 owns transition proposals; adviser can always override; every transition audited. [Full statechart in v1.]

## 5. Open questions for the persona panel

- Inbound client uploads: hosted portal surface vs email-reply ingestion vs aion attachment grants — what's buildable now vs needs infra?
- Where agent prompts/skills live: repo (versioned, reviewable) vs aion skill store (deployable) — likely both, repo as source of truth.
- MSE as first sourcing source: it is NOT whole-of-market — how the evidence-of-research report must caveat coverage [depends on MSE recon + FCA research].
- Per-firm configuration surface (portal choice, lender panel, fee model) — where does it live?
- Which agents run scheduled vs event-driven vs directive-only.

## 6. Persona panel (task #8)

mortgage adviser (daily user) · FCA compliance officer · AR network supervisor · the client · principal architect · agent/ML engineer · security + DPO · product manager · head of sales · operations manager. Each reviews the full spec; dissents recorded; spec iterated until no persona would block; result = the ironclad contract that the autonomous pipeline implements feature-by-feature.
