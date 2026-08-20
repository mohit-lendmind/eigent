# Lendmind Broker CRM — Build Roadmap

> The plan of record for refactoring Eternyl (eigent fork) into **Lendmind Advisor**, the AI-native
> UK mortgage broker CRM. Written 2026-08-20 from two recon reports:
> - [recon/eigent-codebase-map.md](recon/eigent-codebase-map.md) — what the engine gives us
> - [recon/lendmind-advisor-design-reference.md](recon/lendmind-advisor-design-reference.md) — the canonical product design
>
> Integration branch: **`lendmind-crm`**. All feature PRs target it, never `main`.

## Architecture thesis

**The CRM is the surface; the orchestrator is the engine.**

- The desktop has **no backend** — every AI capability is an aion edge run (`POST /projects/{id}/commands` → SSE events → artifacts). Each mortgage AI feature = **an agent flow on aion + a CRM surface that folds its output**.
- **CRM domain data lives in a new renderer domain layer** (typed zustand stores, persisted; durable export via Electron file IO). Cases map onto aion Spaces/Projects: one aion project per case carries its agent runs, artifacts, and comments. Agent outputs land as **structured JSON artifacts** with a versioned schema; the CRM ingests them into domain state with provenance.
- **Provenance is the product**: every field carries `src: 'det'|'syn'`, a hint naming its source, and confidence — the design's 13 AI patterns (det/syn epistemology, Why?-traces, auto-vs-approval grammar, materiality suppression) are non-negotiable requirements on every feature.
- **Human-in-the-loop grammar**: classification/extraction/sourcing runs are auto; anything client-facing or lender-facing is approval-gated (reuse `ApprovalCard`/approvals plane).
- **Browser-use** (LB4 local delegation stack, visible window + take-control) is the submission mechanism for lender portals — already proven against `halifax.eval.ts`.
- Reuse aggressively: HomeHub list/board/table kit, artifact viewer + anchored comments, attachments API, schedules (chases/retention), memory plane, theme engine (default theme id is already `lendmind`).

## Feature sequence

Sized so each feature is one autonomous runner's zero-shot scope. Order = dependency order.
`[EXT]` = needs external credentials/services the user must supply; build behind config.

### Phase 0 — CRM foundation

| # | Feature slug | Scope | Depends |
|---|---|---|---|
| F01 | `crm-domain-core` | The typed domain layer: entities Client, Case, Applicant (join), fact-find field model (`F(k,label,v,{src,hint,flag,conflict,t,mono})`, sections personal/contact/address/employment/income/expenditure/credit, per-section `_c` completeness), 8 pipeline STAGES, Document+insights, DocChecklist, Worklist kinds, Activity/Stream entry (+trace shape: claim/working/evidence/alternatives/confidence/calibration), Criteria, Product, Retention. Zustand stores + persistence + migration versioning; seed fixtures = design's golden path (c417 Aisha/Daniel, c392 Tom, pipeline rows); selectors; unit tests. No UI. | — |
| F02 | `crm-shell-and-primitives` | Lendmind IA: `/crm` routes (today/cases/clients/case/:id), TacticalRail (Today/Cases/Clients/New case/recent cases/client-view footer), and the design-system primitives mapped onto the ds-* token engine: PipelineBadge, SourceDot, EpistemologyTag, CompletenessRing, AvatarStack, StatusPill, WhyPill, kind chips, mono micro-label convention. Storybook stories. | F01 |
| F03 | `cases-and-clients-views` | Cases board (per-stage columns, CaseCard) + table toggle; Clients directory + ClientProfile (case history, contact); Retention radar card (urgency <90 days, statuses case-open/due/horizon). Reuses HomeHub kit patterns. | F02 |
| F04 | `case-workspace-stream` | The case workspace: CaseHeader (interactive PipelineBadge, CompletenessRing), stream-first layout — CaseStream sections (LIVE/NEEDS YOU/YOUR DIRECTIVES/ACTIVITY), StreamEntry anatomy w/ kind chips + timeline rail, StatePane (pinned facts w/ provenance dots, recommendation card, open flags), ReasoningDrawer (claim→working→evidence chips→alternatives→calibration), deep-view switcher (Open view pill + slash commands), NotesPanel. Stream renders from F01 domain events. | F02 |
| F05 | `today-decision-queue` | Today screen: header + 3-stat strip ('Need you'/'Handled by AI' with Why? trace/'Completing in {month}'), WorklistCards by kind (conflict/criteria/doc/approval/retention/signature) with CTAs deep-linking into case tabs, "What Lendmind did" log, Pipeline mini-bar, retention teaser. | F03, F04 |

### Phase 1 — Fact find (pillar 1)

| # | Feature slug | Scope | Depends |
|---|---|---|---|
| F06 | `fact-find-view` | Fact find deep view: applicant tabs w/ completeness, SectionCards, InlineField editing (select/date/number/toggle/text, mono), det/syn legend + AI banner, flags & conflicts surfaced, joint Property/Deposit/Requirement/Affordability view. Field edits update domain store w/ audit note. | F04 |
| F07 | `new-case-ai-intake` | First real agent integration. NewCaseOverlay (Source→Read→Review pips): paste call notes/email/free text → aion run extracts ~24 fields w/ per-field src/conf/quote citations + flags + missing list → streamed extraction UI → review w/ per-field traces → approve creates Client+Case+seeded fact find + queued next actions. Defines the **structured-artifact ingest seam** (JSON schema, versioned) every later agent feature reuses. | F04, F06 |
| F08 | `call-capture-and-recording` [EXT for PSTN] | In-app calls: WebRTC video/voice room per case (recording via MediaRecorder, mic+remote mix), call log in NotesPanel, recording saved to case (attachment/artifact) with consent prompt. Phone-out via Twilio Voice behind config `[EXT]`. New preview tab kind `call`. | F04 |
| F09 | `fact-find-from-call` | Post-call pipeline: recording → transcription (aion skill run) → fact-find field extraction w/ provenance `src:'det', hint:'Call · {date}'` vs syn inference → diff review UI (accept per field) → conflicts vs existing values raised as worklist items. Completeness recompute. | F07, F08 |

### Phase 2 — Documents (pillar 2)

| # | Feature slug | Scope | Depends |
|---|---|---|---|
| F10 | `document-vault` | Documents deep view: upload dropzone (drag/drop/paste, HEIC/PDF/img), person-scoped DocCards w/ type chips, owner filter, checklist (received/partial/pending/requested) driving the comms rail, statuses PROCESSING/COMPLETED. Files stored via attachments API + local case folder. | F04 |
| F11 | `intelligent-doc-analysis` | The Veris-class engine: on upload, aion run classifies (payslip/P60/passport/contract/statement/gift letter…), extracts typed insights w/ per-insight confidence, **attributes to applicant** (name/NI cluster match, confirm gate <0.85 or joint), writes det fields into fact find w/ hints, and runs **cross-document conflict detection** (e.g. contract £38,500 vs payslip annualised £37,300 > 1% materiality) → conflict propagates to field, doc tile, worklist card, stream entry w/ resolution actions. | F07, F10 |
| F12 | `secure-doc-collection` [EXT for hosted portal] | Collection requests: per-checklist-item request objects, drafted client messages (email/WhatsApp templates, channel choice recorded), auto-chase schedules via /schedules plane, received-item reconciliation. Client portal preview mode in-app (design's portal tracker/documents). Hosted external portal flagged `[EXT]` — needs a web deployment target. | F10, F11 |

### Phase 3 — Sourcing, evidence, submission (pillar 3)

| # | Feature slug | Scope | Depends |
|---|---|---|---|
| F13 | `criteria-engine-and-solver` | Sourcing solver: constraint chips (locked vs mutable), NL constraint edits (5yr fix / exclude lender / LTI cap / model price / probation override w/ compliance flag), edit trail, eligible list ranked by true cost w/ rationale + Why? traces, rejected list w/ exact criterion cites + counterfactuals ('re-source after 6 Jul'). Criteria checks (10-gate model: construction, LTV, FTB, probation-per-lender, gift policy, credit, income, LTI, stress, surplus) computed deterministically over fact find + a lender-criteria dataset artifact. | F06 |
| F14 | `whole-of-market-scan` | The scan agent: aion run (web research + browser-use) reads lender rate tables + criteria sources, produces the products dataset (rate/fee/monthly/true-cost/APRC) + per-lender criteria verdicts w/ citations ('Halifax criteria § 4.2 v24.6') as a versioned sourcing-snapshot artifact; scanning UI (live lender counter, step checklist); affordability panel (per-lender LTI caps, max-borrowing bars vs requested marker). | F13 |
| F15 | `evidence-of-research` | Evidence pack: immutable sourcing snapshot (ref, generated-at, rates-as-at, lenders scanned, all products considered incl. declines w/ reasons), auto-recorded rationale, MCOB 4.7A suitability report generation (agent-drafted, adviser-approved), disclosures list, PDF export via pdf skill. 'Retained for 3 years · reproducible'. | F14 |
| F16 | `dip-submission-browser-agent` | Agentic DIP: DipOverlay w/ side-by-side field mapping (fact find → lender portal, provenance dots, approve-before-submit) driving the **local browser delegation stack** against the lender broker portal under the adviser's logged-in session; take-control escape hatch; result (DIP ref, max borrowing, validity) written back to case + stage advance. | F13, F15 |
| F17 | `application-engine-and-comms` | Post-DIP: application milestones timeline w/ owners + SLA bars, auto-chase engine (schedules), parties; unified Comms tab (email/WhatsApp/portal threads, AI-drafted replies approval-gated, checklist rail); Compliance tab (disclosures, ID&V, AML, vulnerability, Consumer Duty, AR supervision checklist). | F05, F12 |

## Runner protocol

- One feature = one milestone = one runner in a worktree cut from `lendmind-crm`; PR back into `lendmind-crm`.
- Every feature must pass the existing gates (type-check, lint incl. design-token usage, i18n parity, vitest baseline) and add tests for its domain logic.
- Agent-facing features (F07, F09, F11, F14, F16) must define/extend the structured-artifact schema in `src/crm/agentContracts/` and degrade gracefully when the edge is unreachable.
- Concurrency: respect `max_concurrent_runners: 4`; only launch a feature whose dependencies are merged.
- Launch order: F01 solo → F02 solo (both touch foundational wiring) → then parallelize per dependency table.
