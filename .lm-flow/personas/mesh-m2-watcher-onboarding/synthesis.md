# Synthesis: mesh-m2-watcher-onboarding

Five personas, 2026-08-22. Sources: ux-designer.md, principal-architect.md, software-engineer.md, product-manager.md, head-of-sales.md (same dir). Architecture: `.lm-flow/architecture/mesh-m2-watcher-onboarding.md`. Founder steer: proceed autonomously on recommended calls; the only decision that gates the build (M4 connector target) is not an M2 input.

## Unanimous / convergent (≥2 seats, adopted)
1. **Firm index = per-case pointer artifacts, not one mutable `cases.json`.** Architect proved the single-file lost-update (uploadAttachment has no If-Match/Idempotency-Key — a retried/concurrent write just mints a version and the watcher's "latest" drops one). Engineer added: the case-project onboarding run can't write the coordinator project's file anyway (cross-project edge writes unproven). Resolution: **the desktop publishes an append-only, one-pointer-per-case index** (it alone holds the fold head); the watcher reads the set.
2. **The needs-you queue is fold-sourced, not N live SSE subscriptions.** Architect + Engineer both flagged that a cross-project aggregator holding one `ProjectSession`/reducer per active case leaks sockets (bindings are private, minted only by startAionTask; each `.start()` fails after 5 retries). Resolution: **mirror `approval_required`/`approval_resolved` into the M1 fold / eventLogStore so the queue reads from persisted state; keep exactly one live subscription — for the single open gate card the adviser is acting on.**
3. **Gates are a distinct interrupt class in the queue** (UX): pinned, SLA-timered, sorted by priority (SLA → tier → age), never naive recency — else an at-SLA G1 buries under fresh low-value rows. Every row carries a `live · as-of · stale` freshness badge (consuming M1's `lastFoldedAt`/`sourceStatus`).
4. **Loud degraded banner when a queue source fails** (UX would-not-ship-without): a silently truncated needs-you list = a missed regulated sign-off.
5. **The G1 onboarding card is the make-or-break trust moment** (UX): it must show the **full draft**, allow **inline edit** (v1 send is manual anyway), and show **provenance** (disclosure ref + why each checklist item) — not approve/reject on gate metadata.
6. **Watcher writes dispatch-ready decisions** (Architect + PM): `lm.watcher.decision/1` carries the same envelope `dispatch.ts` consumes, so M3 flips propose→dispatch by **adding a consumer, not rewriting the watcher**; every decision + supervision record carries a `passId` correlation id.
7. **Bespoke GateCard built to G4b shape now** (UX resolved arch open-Q4): tier/SLA visible, batch-select present-but-inert in M2, so M6's G4b batch approvals aren't a full re-plumb. `GateDescriptor` already carries tier/slaMinutes/batchable from M1.
8. **FX is static config but audit-stamped** (Architect): store the rate + effective-date on every spend/supervision record, or a later config edit silently reprices historical audit rows. Bigint end-to-end (Engineer). The default `watcherPassMicroGbp` 20_000 (£0.02) trips on essentially any LLM pass (Engineer) → raise the default / meter per-pass realistically.
9. **Discoverability + a11y** (UX): a real nav entry to `/crm` (URL-only = undiscovered); dark-mode contrast verified (CrmTone anchors are light-mode hex, Storybook forced-light); SLA timers `aria-live=polite`, rendered as text not a ticking focus-stealing region.
10. **Build artifacts beyond code** (Sales + PM): a named **demo case** + a **compliance one-pager** as M2 deliverables; a named user persona + leading-indicator metrics (time-to-fact-find, % drafts approved unedited, adviser-minutes-saved).
11. **Enterprise-readiness stated, not silently absent** (Sales): SSO / RBAC / data-residency deferred to a **named** milestone.

## Tradeoffs — RESOLVED (founder said proceed on recommended calls; each is overridable)
- **T1 — client upload portal.** Spec §12 puts "micro-portal v1" in M2; the architecture split it. **Resolved: split to the immediate next milestone (M-portal), NOT vague "later."** M2 onboarding drafts the doc-request; interim inbound collection is **adviser-logged-manual** and must NOT default to client-emails-docs-back (PM: that reopens the §9 PII/phishing surface). Consequence recorded for Mohit: real design-partner cases (§11's 10+/month) need M-portal, so it is the very next milestone. *(Sales flagged this as a Mohit sign-off item — surfaced, not silently decided.)*
- **T2 — watcher act vs propose.** **Resolved: propose-only in M2**, but ≥1 trigger must be real chase-work (fixed-rate-end radar + stalled-case), not a restatement of state; onboarding carries the "AI did something" moment. Dispatch-ready payloads (see #6) make M3 additive.
- **T3 — firm index concurrency.** **Resolved: per-case pointer artifacts, desktop-published** (see #1).
- **T4 — aggregator sockets.** **Resolved: fold-sourced queue + single live subscription** (see #2).
- **T5 — FX source.** **Resolved: static config, stamped per record, bigint** (see #8).
- **DEFERRED (not an M2 input): the M4 connector target** (Mortgage Brain vs 27Tec vs Mortgage Magic vs MSE). Needed before M4 planning; the founder owns it. M2 proceeds without it.

## Acceptance criteria (union, deduplicated)
- A directive round-trips: envelope → `application/json` artifact (non-`aion-` name) → submitCommand → run → an `lm/case/<id>/…` entry the M1 fold ingests; completion observed via the fold (not an await — dispatch is fire-and-forget).
- The watcher entry run, executing on the edge with no localStorage, **fetches the firm index as an artifact** and reads each case's log head — proven in Phase 1 (Engineer would-not-ship-without) or the watcher is blind.
- A firm watcher pass skips unchanged cases (pre-LLM fast path), writes dispatch-ready decisions + worklist items for actionable ones, respects the breaker (12/case/hr), records per-pass spend with the FX basis stamped.
- Onboarding on a new case builds the checklist + drafts the request with disclosure refs; the G1 card shows full draft + inline edit + provenance; approving logs the manual send.
- The Today queue merges persistent (fold/eventLogStore) + the single live gate; gates pinned + SLA-sorted; freshness badge per row; degraded-source banner; empty/loading/all-clear/first-run states all defined.
- Bespoke GateCard renders from GATE_REGISTRY alone (tier/SLA shown, batch inert).
- `/crm` reachable from a nav entry; dark-mode contrast verified; SLA timers aria-live polite.
- All existing CRM tests green; new UI passes design-token + i18n-parity (new `crm` namespace, 11 locales) + storybook a11y; vitest baseline unmoved.
- Demo case + compliance one-pager checked in; leading-indicator metrics wired.

## Out of scope (M2)
Client upload portal (→ M-portal, next); live agent-to-agent dispatch (→ M3); doc intelligence, sourcing, criteria, affordability, comms-send automation, DIP; in-app calling; multi-firm SaaS/SSO/RBAC/data-residency (→ named enterprise milestone).

## User Journeys (for post-merge validation)

### Journey 1 — First open: approve the onboarding message
**As an** adviser **I want** to open the app and act on what the AI prepared **so that** my first experience is "it already did work."
Steps: launch → nav to /crm Today → see needs-you queue with a G1 onboarding card → open it (full draft + disclosure ref + provenance) → edit a line → Approve & send → manual send logged.
Success: queue renders from seeded state; G1 card shows the full draft and provenance; approving flips the card and writes the send to the case log; nothing sent without the click.

### Journey 2 — The watcher's pass surfaces the next step
**As an** adviser **I want** a background pass to tell me what each case needs **so that** nothing waits on my memory.
Steps: seed cases incl. a fixed-rate-ending case → run a watcher pass (schedule tick / manual) → pass skips unchanged cases → writes a "remortgage?" proposal + a stalled-case chase → both appear in the queue, SLA-sorted, with a Why? trace.
Success: fast-path skips unchanged; ≥1 real chase trigger fires; decisions are dispatch-ready; per-pass spend recorded with FX basis; breaker respected.

### Journey 3 — Kill-the-laptop still holds with agents writing
**As a** compliance officer **I want** the case to rebuild from the log even though agents wrote to it **so that** the desktop is never the source of truth.
Steps: agent runs write lm/case entries → fold ingests → wipe stores → refold → converged + chain-verified.
Success: converges byte-identical (M1 invariant holds with M2's real agent-written entries); export v2 verifies.

## Brief for /speckit-specify
Build `mesh-m2-watcher-onboarding`: the first agents (A1 onboarding, A2 watcher) and the first mortgage UI (a `/crm` Today "needs you" queue + gate approval cards), on branch `lendmind-crm`, extending the merged M1 layer (`src/crm/agentContracts` + `src/crm/fold` + `eventLogStore`). Authoritative design: `.lm-flow/architecture/mesh-m2-watcher-onboarding.md`. System contract: `.lm-flow/spec/lendmind-agent-mesh-spec-v2.md` §§4,5,12. No new dependencies; `src/api/aion/v1/**` and the M1 frozen contracts stay frozen; every CI gate green (design-token, i18n parity for a new `crm` namespace across 11 locales, vitest baseline unmoved, license headers).

Three strands. **(1) Invocation plumbing (no UI):** `src/crm/agents/` — `dispatch.ts` (carry the `lm.directive/1` envelope as an `application/json` artifact referenced via attachment_ids, non-`aion-` name; fire-and-forget, completion observed via the fold), `caseProject.ts` (ensure `Case.aionProjectId`; firm coordinator project), `budget.ts` (static-config USD→GBP FX stamped per record, bigint, breaker 12/case/hr — raise the unrealistic £0.02 default), `skillDeploy.ts` + `resources/lm-skills/lm-onboarding` & `lm-watcher` (deploy via direct putAionSkill, PascalCase document). Prove in this strand that an edge run can fetch the firm index artifact and read a case's log head. **(2) The two agents:** A1 onboarding (checklist + disclosure-embedded draft + G1 gate + writes lm/case entries + lm.onboarding.request artifact); A2 watcher (firm coordinator project + `*/5` schedule whose task is a watcher entry directive; the run reads the desktop-published **per-case pointer index**, pre-LLM fast-path skips unchanged cases, writes **dispatch-ready** `lm.watcher.decision` + worklist items + G7 proposals with a `passId`; ≥1 real trigger: fixed-rate radar + stalled-case; breaker + budget enforced; supervision metrics). Watcher PROPOSES in M2 — no live child-agent dispatch. **(3) Thin surface:** `/crm` route (sibling to Layout, inside ProtectedRoute) + `CrmLayout` + `TacticalRail` (copy ProjectPageSidebar/NavTab) + a nav entry so it's discoverable; the Today queue built on HomeHubListTable/HomeHubItemShell, **fold-sourced** (persistent worklist/fold items) with gates as a pinned, SLA-sorted, distinct interrupt class and a per-row freshness badge, plus a loud degraded-source banner and all four empty/loading states; a bespoke `GateCard` rendered from `GATE_REGISTRY` (tier/SLA shown, batch inert) with the G1 card showing full draft + inline edit + provenance; CRM tones (new `CrmTone` union, stage ramp per f02 recon, dark-mode contrast verified); the `crm` i18n namespace; storybook stories (add jetbrains-mono to preview if mono used); SLA timers aria-live polite. Keep exactly one live approval subscription (the open card); everything else reads the fold — do NOT hold a subscription per case.

Resolve nothing further — the five tradeoffs are settled above (portal→next milestone with adviser-logged-manual interim; watcher propose-only with real triggers + dispatch-ready payloads; per-case pointer index; fold-sourced queue + single live sub; static stamped FX). Hard requirements: a named demo case + a compliance one-pager as build artifacts; leading-indicator metrics (time-to-fact-find, % drafts approved unedited, adviser-minutes-saved); enterprise-readiness (SSO/RBAC/data-residency) explicitly deferred to a named milestone, not silently absent; contract freeze via `.d.ts` under `specs/003-mesh-m2-watcher-onboarding/contracts/`; the kill-the-laptop M1 invariant must still hold with real agent-written entries. Include a "## User Journeys" section in the spec with the three journeys above — hard requirement, validate-feature depends on it.
