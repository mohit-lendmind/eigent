# Feature Specification: mesh-m2-watcher-onboarding

**Feature Branch**: `feature/mesh-m2-watcher-onboarding` (cut from `lendmind-crm`; spec authored on `lendmind-crm`)

**Created**: 2026-08-22

**Status**: Ready for planning

**Input**: brief at `.lm-flow/personas/mesh-m2-watcher-onboarding/brief.txt`; architecture `.lm-flow/architecture/mesh-m2-watcher-onboarding.md`; system contract `.lm-flow/spec/lendmind-agent-mesh-spec-v2.md` §§4,5,12; builds on merged M1 (`src/crm/agentContracts` + `src/crm/fold`).

M2 is the first milestone that does work and shows it: two agents (A1 onboarding, A2 watcher) and the first mortgage UI (a `/crm` Today "needs you" queue + gate approval cards). Its users are the adviser (who finally sees and steers agent work) and the M3+ teams (who inherit the invocation plumbing and a dispatch-ready watcher). The client upload portal is explicitly the next milestone, not M2.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - First open: approve the onboarding message (Priority: P1)

An adviser installs the app, opens the Today screen, and finds the onboarding agent has already prepared the first client message for a new case — checklist built, disclosure embedded. They read the full draft, tweak a line, and approve. The message is logged as sent.

**Why this priority**: This is the "it already did work" moment — the first time the product is tangible. It exercises the whole spine (agent run → case-log entry → fold → queue → gate → approval) end to end and is independently demoable.

**Independent Test**: Seed a new case, run onboarding, open `/crm` Today, act on the G1 card. No other agent needed.

**Acceptance Scenarios**:

1. **Given** a newly created case, **When** the onboarding agent runs, **Then** a document checklist is built for the case type and a welcome + doc-request message is drafted with the firm's disclosure references embedded (never generated per-send).
2. **Given** the drafted message, **When** the adviser opens the Today queue, **Then** a G1 gate card shows the **full draft**, allows **inline edit**, and shows **provenance** (which disclosure, why each checklist item).
3. **Given** the adviser approves, **Then** the (manual) send is logged to the case as a stream entry and the card resolves; nothing was sent without the approval.
4. **Given** the onboarding run wrote its output, **When** the fold ingests it, **Then** the checklist + activity appear in case state and the M1 chain still verifies.

---

### User Story 2 - The watcher's pass surfaces the next step (Priority: P2)

Every few minutes a background pass reads each active case and, for the ones that need something, drops a proposal or chase into the adviser's queue — so nothing waits on the adviser's memory.

**Why this priority**: This is "stage-aware orchestration v1" and the always-on layer the product is named for. It's valuable alone (chases + retention radar) and it lays the seam M3 turns into real dispatch.

**Independent Test**: Seed cases including one with a fixed-rate end date approaching; run one watcher pass; inspect the decisions and queue items.

**Acceptance Scenarios**:

1. **Given** a set of active cases, **When** a watcher pass runs, **Then** cases whose log head is unchanged since the last pass are skipped (pre-LLM fast path) and only changed/eligible cases are processed.
2. **Given** an eligible case, **When** the watcher decides, **Then** it writes a `lm.watcher.decision` carrying a **dispatch-ready** payload (the same envelope a future dispatcher consumes) plus a `passId`, and raises a worklist item — it does **not** itself run a downstream agent.
3. **Given** a case with a fixed rate ending within the window, **Then** the watcher proposes opening a remortgage case; **and** a case stalled past its SLA raises a chase — at least these two triggers are real, not restatements of state.
4. **Given** any pass, **Then** the breaker (max auto-invocations/case/hr) is respected and per-pass spend is recorded with the FX rate + effective-date stamped on the record.

---

### User Story 3 - The needs-you queue holds under real agent writes (Priority: P2)

The Today queue is a single trustworthy list: agent gate-approvals as a distinct pinned interrupt class, plus persistent worklist/fold items, sorted so the most urgent regulated item is never buried — and it degrades loudly, never silently.

**Why this priority**: The queue is the surface. If it silently drops a source or mis-sorts, an adviser misses a regulated sign-off. It must be right before more agents feed it.

**Independent Test**: Seed persistent worklist items + fixtures for a pending gate; render the queue; fail one source; verify the banner and ordering.

**Acceptance Scenarios**:

1. **Given** persistent items and a pending gate, **When** the queue renders, **Then** it reads persistent items from the fold/eventLogStore and shows the gate as a **pinned, distinct interrupt** with an SLA timer; the list sorts by SLA → tier → age, never naive recency.
2. **Given** each row, **Then** it carries a `live · as-of · stale` freshness badge derived from M1's per-case freshness.
3. **Given** a source fails to load, **Then** a loud degraded-source banner appears (never a silently truncated list).
4. **Given** the queue is live, **Then** exactly one live approval subscription is held (the open gate card); the rest reads persisted state — no per-case socket fan-out.
5. **Given** first-run / empty / loading / all-clear, **Then** each state has its own defined, non-broken-looking treatment.

---

### Edge Cases

- The watcher entry run executes on the edge with no local storage: it must fetch the firm index as an artifact and read each case's log head via its own tool — if it can't, it's blind (must be proven in Phase 1).
- Two onboarding runs add cases at once: the per-case pointer index must not lose one (no single mutable file).
- A directive dispatch is fire-and-forget: callers observe completion via the fold, not a returned await.
- The £0.02 default watcher-pass budget would trip on any LLM-touching pass — the default must be realistic or the breaker fires constantly.
- Dark mode: CRM tone anchors are light-mode hex and Storybook is forced-light — contrast must be verified in both themes.
- A gate resolves while the adviser isn't looking: the card must reflect the resolved decision from folded state, not wait forever on a dropped live event.
- The kill-the-laptop wipe now happens with real agent-written entries in the log — convergence must still be byte-identical.

## User Journeys

*(Post-merge validation drives these; the surface is real UI so these are browser-drivable.)*

### Journey 1 — First open: approve the onboarding message
**As an** adviser **I want** to open the app and act on what the AI prepared **so that** my first experience is "it already did work."
Steps: launch → nav to `/crm` Today → see the needs-you queue with a G1 onboarding card → open it (full draft + disclosure ref + provenance) → edit a line → Approve & send → the manual send is logged.
Success: queue renders from seeded state; the G1 card shows the full draft and provenance; approving flips the card and writes the send to the case log; nothing sends without the click.

### Journey 2 — The watcher's pass surfaces the next step
**As an** adviser **I want** a background pass to tell me what each case needs **so that** nothing waits on my memory.
Steps: seed cases incl. a fixed-rate-ending case → run a watcher pass → unchanged cases skipped → a "remortgage?" proposal + a stalled-case chase written → both appear in the queue, SLA-sorted, with a Why? trace.
Success: fast-path skips unchanged; ≥1 real chase trigger fires; decisions are dispatch-ready with a passId; per-pass spend recorded with FX basis; breaker respected.

### Journey 3 — Kill-the-laptop still holds with agents writing
**As a** compliance officer **I want** the case to rebuild from the log even though agents wrote to it **so that** the desktop is never the source of truth.
Steps: agent runs write `lm/case` entries → fold ingests → wipe stores → refold.
Success: converges byte-identical (the M1 invariant holds with M2's real agent-written entries); export v2 verifies.

## Requirements *(mandatory)*

### Functional Requirements

**Invocation plumbing**
- **FR-001**: The system MUST submit an agent invocation carrying a typed `lm.directive/1` envelope by publishing it as an `application/json` artifact (non-`aion-` reserved name) and referencing it via the command's attachment ids; the envelope's identity and the transport command id are mapped at that one call site.
- **FR-002**: Dispatch MUST be fire-and-forget — the caller receives the run/command ids and observes completion through the fold and approval state, never a blocking await on the run.
- **FR-003**: The system MUST ensure a case has a linked project before dispatch, and MUST maintain a firm coordinator project for the watcher.
- **FR-004**: Budgets MUST convert edge spend (micro-USD) to firm caps (micro-GBP) via a static firm-config rate, with the rate + effective-date stamped on every spend/supervision record; all money math is 64-bit-safe; the default watcher-pass cap MUST be realistic (not trip on a normal LLM pass); the per-case breaker (default 12/hr) MUST be enforced.
- **FR-005**: The two agent skills (onboarding, watcher) MUST be authored in-repo and deployable to the edge via direct skill upload (canonical document shape); non-prompt document fields are expected to be reported ignored.
- **FR-006**: Phase 1 MUST prove that an edge run can fetch the firm index artifact and read a case's log head — before any watcher logic depends on it.

**A1 onboarding**
- **FR-007**: On case creation the onboarding agent MUST build the document checklist for the case type and draft a welcome + doc-request message embedding the firm's disclosure references from config.
- **FR-008**: The outbound send MUST be G1-gated; the gate card MUST present the full draft, inline edit, and provenance; approval logs the manual send to the case.
- **FR-009**: The agent MUST write its output as `lm/case/<caseId>/…` entries (checklist, activity, stream) plus an onboarding artifact, all ingested by the M1 fold.

**A2 watcher**
- **FR-010**: A firm-level schedule (~5 min) MUST fire a watcher entry run against the coordinator project; the run MUST read the desktop-published **per-case pointer index** and each case's log head.
- **FR-011**: The pass MUST skip cases whose log head is unchanged since the last pass (pre-LLM fast path).
- **FR-012**: For eligible cases the watcher MUST write a `lm.watcher.decision` with a **dispatch-ready** payload + a `passId`, raise worklist items, and propose G7 transitions — without running downstream agents in M2.
- **FR-013**: At least two real triggers MUST fire: fixed-rate-end radar (propose remortgage) and stalled-case chase.
- **FR-014**: Each pass MUST record supervision metrics (breaker trips, decision sampling, per-pass spend with FX basis).

**Thin surface**
- **FR-015**: A `/crm` route MUST mount inside the auth guard with its own shell (not the default chrome) and MUST be reachable from a visible nav entry.
- **FR-016**: The Today needs-you queue MUST read persistent items from the fold/eventLogStore, present gates as a pinned distinct interrupt class with SLA timers, and sort by SLA → tier → age (never naive recency).
- **FR-017**: Each queue row MUST show a `live · as-of · stale` freshness badge; a failed source MUST raise a loud degraded-source banner; first-run / empty / loading / all-clear states MUST each be defined.
- **FR-018**: The queue MUST hold exactly one live approval subscription (the open gate card) and read everything else from persisted state — no per-case socket fan-out.
- **FR-019**: A bespoke gate card MUST render from the frozen `GATE_REGISTRY` (tier + SLA shown; batch-select present but inert in M2) so M6's batch approvals are not a re-plumb.
- **FR-020**: New UI MUST use the ds-* token engine with a CRM tone set (stage ramp per the F02 recon), verified for contrast in light AND dark; a `crm` i18n namespace MUST be added across all 11 locales; SLA timers MUST be `aria-live=polite` text, not a focus-stealing region; primitives MUST have storybook stories.

**Cross-cutting**
- **FR-021**: Contract surfaces MUST be frozen as `.d.ts` under `specs/003-mesh-m2-watcher-onboarding/contracts/`.
- **FR-022**: A named demo case and a compliance one-pager MUST be checked in as build artifacts; leading-indicator metrics (time-to-fact-find, % drafts approved unedited, adviser-minutes-saved) MUST be wired.
- **FR-023**: The M1 kill-the-laptop convergence + chain verification MUST still hold with real agent-written entries; all existing CRM tests stay green; design-token, i18n-parity, and vitest-baseline gates MUST pass unmoved.

### Key Entities

- **Directive envelope** — a typed agent invocation, carried as an artifact.
- **Firm coordinator project** — the project the watcher schedule fires against.
- **Per-case pointer index** — the desktop-published, append-only set of active cases the watcher enumerates.
- **Watcher decision** — a dispatch-ready proposal with a passId; the M3 seam.
- **Gate card** — a standalone approval rendered from the gate registry; G1 is the onboarding send.
- **Needs-you queue** — the merged, SLA-sorted list; gates are its pinned interrupt class.
- **Budget/FX record** — spend with the conversion basis stamped, for audit.

## Success Criteria *(mandatory)*

- **SC-001**: An adviser opens `/crm` and completes the G1 onboarding approval (full draft → edit → send-logged) with zero un-approved client sends.
- **SC-002**: A watcher pass over the seeded caseload skips unchanged cases, fires ≥2 real triggers, writes dispatch-ready decisions, and records per-pass spend with FX basis — within the breaker.
- **SC-003**: The needs-you queue renders both sources, keeps gates pinned and SLA-sorted, holds exactly one live subscription, and shows a loud banner when a source fails (verified by fault injection).
- **SC-004**: Kill-the-laptop convergence stays byte-identical and the chain verifies with real agent-written entries in the log.
- **SC-005**: A later milestone can turn a watcher proposal into a live dispatch by adding a consumer of the decision payload — no watcher rewrite (proven by a spike consuming the payload).
- **SC-006**: Every CI gate green; vitest baseline unmoved; i18n parity holds across 11 locales; dark-mode contrast verified.
- **SC-007**: The demo case runs the first-open journey end to end, unattended, from a clean checkout.

## Assumptions

- Golden fixtures (c417/c392) remain the test data; a fixture firm index + coordinator project stand in where live minting isn't built.
- The edge fires the watcher schedule server-side; per-case fan-out happens inside the watcher run, not in the schedule plane.
- v1 client sends are adviser-manual and logged; automated connector send is a named v2.
- Inbound client document collection is **adviser-logged-manual** in M2 and MUST NOT default to client-emails-docs-back; the hosted upload portal is the **immediate next milestone (M-portal)**, not vague "later".
- Enterprise readiness (SSO / RBAC / data-residency) is deferred to a **named** milestone, not silently absent.
- The M4 connector target (which sourcing/CRM tool first) is a founder decision needed before M4 — it is **not** an M2 input.

## Tradeoff Resolutions *(from the persona dissent record — all settled)*

- **T1 client portal**: split to the immediate next milestone; interim collection adviser-logged-manual, never email-back-default.
- **T2 watcher**: propose-only in M2 with ≥2 real triggers and dispatch-ready payloads.
- **T3 firm index**: per-case pointer artifacts, desktop-published (no single mutable file).
- **T4 queue**: fold-sourced + one live subscription (no per-case socket fan-out).
- **T5 FX**: static config rate, stamped per record, 64-bit-safe.

---

## Appendix: Persona dissent record

| # | Persona(s) | Position | Resolution |
|---|---|---|---|
| 1 | Architect, Engineer | Single `cases.json` is a lost-update / cross-project-write hazard | Per-case pointer index, desktop-published — FR-010, T3 |
| 2 | Architect, Engineer | Cross-project aggregator leaks sockets | Fold-sourced queue + one live sub — FR-018, T4 |
| 3 | UX | Gates must be a pinned, SLA-sorted interrupt class w/ freshness badges | FR-016, FR-017 |
| 4 | UX | Loud degraded-source banner (won't-ship-without) | FR-017 |
| 5 | UX | G1 card = full draft + inline edit + provenance (the trust moment) | FR-008 |
| 6 | Architect, PM | Watcher decisions must be dispatch-ready + passId for additive M3 | FR-012, SC-005 |
| 7 | UX | Bespoke GateCard to G4b shape now (tier/SLA/batch) | FR-019 |
| 8 | Architect, Engineer | Static FX but stamped per record; bigint; £0.02 default trips | FR-004 |
| 9 | UX | /crm nav entry; dark contrast; aria-live timers | FR-015, FR-020 |
| 10 | Sales, PM | Demo case + compliance one-pager + leading metrics as deliverables | FR-022 |
| 11 | Sales | Portal split has a real commercial cost — a Mohit sign-off item, surfaced | Assumptions; T1 → next milestone |
| 12 | Sales | Enterprise readiness deferred to a NAMED milestone, not absent | Assumptions |
| 13 | Engineer | Prove edge run can fetch index + read log head in Phase 1 | FR-006 |
| 14 | Engineer | Dispatch is fire-and-forget; completion via fold not await | FR-002 |

Source files: architecture `.lm-flow/architecture/mesh-m2-watcher-onboarding.md`; personas `.lm-flow/personas/mesh-m2-watcher-onboarding/*.md`; synthesis `…/synthesis.md`.
