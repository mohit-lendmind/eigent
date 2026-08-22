# Research: mesh-m2-watcher-onboarding

Phase 0 decisions (from two 2026-08-22 codebase explorers + the panel). No open NEEDS CLARIFICATION.

## D1 — Directive carriage: artifact, not wire field
Decision: publish `lm.directive/1` as an `application/json` artifact (non-`aion-` name) and reference via `attachment_ids`; map `command_id`↔`directiveIdentity` at the call site. Rationale: `SubmitCommandRequest` has only text/attachment_ids/comment_ids/browser flags — no directive field; the artifact is auditable and `lm.directive` is already a known kind. Alt: JSON-in-text (rejected: not auditable as an artifact).

## D2 — Dispatch is fire-and-forget
Decision: `dispatchDirective` returns ids; completion observed via the fold + reducer approval state. Rationale: `startAionTask` resolves on admission, never awaits a terminal (engineer verified). Alt: await run completion (no such API without holding a live session).

## D3 — Firm index: per-case pointer artifacts, desktop-published
Decision: the desktop publishes one append-only pointer artifact per case (id + projectId + stage + log head); the watcher reads the set. Rationale: `uploadAttachment` has no If-Match/Idempotency-Key so a single mutable `cases.json` loses concurrent writes; and a case-project run can't write the coordinator project (cross-project write unproven). Alt: single file (rejected: lost-update); edge maintains it (rejected: unproven).

## D4 — Watcher = coordinator project + schedule, proposes only
Decision: firm coordinator project + `*/5 * * * *` schedule whose `task` is a watcher entry directive; the run reads the index + log heads, fast-path skips unchanged, writes dispatch-ready `lm.watcher.decision` + worklist items (no live child dispatch in M2). Rationale: a schedule fires one plain task against one project, edge-side; per-case fan-out happens inside the run. Alt: per-case schedules (rejected: spec wants firm-level; N schedules unmanageable).

## D5 — Queue: fold-sourced + one live subscription
Decision: mirror approval_required/resolved into the fold/eventLogStore; the queue reads persisted state; hold exactly one live `ProjectSession` — the open gate card. Rationale: a cross-project aggregator holding one session per case leaks sockets (each `.start()` fails after 5 retries; bindings private). Alt: N live subscriptions (rejected: leak).

## D6 — Budget: static FX, stamped, bigint
Decision: firm-config `fxUsdPerGbpMicro` (additive optional, defaulted); stamp rate + effective-date on every spend/supervision record; all math bigint; raise the £0.02 default. Rationale: edge spend is micro-USD, caps are micro-GBP; static is audit-reproducible but a later edit must not reprice history. Alt: fetched rate (rejected: not reproducible for audit).

## D7 — Skills: direct PUT, not bundle-sync
Decision: deploy `resources/lm-skills/*` via `putAionSkill` (PascalCase document); don't touch the electron bundle scanner. Rationale: avoids electron-main changes; skill docs live in-repo. Non-prompt fields return in `ignored_fields` (expected).

## D8 — Edge-reads-index is a Phase-1 proof gate
Decision: before watcher logic, prove an edge run can fetch the firm index artifact + read a case log head via its own tool (readAionArtifact is desktop-only). Rationale: if it can't, the watcher is blind — engineer's ship-blocker.

## D9 — UI: reuse the kit, build CRM tones + GateCard + shell
Decision: /crm sibling route + CrmLayout; rail from ProjectPageSidebar/NavTab; queue from HomeHubListTable/HomeHubItemShell; bespoke GateCard from GATE_REGISTRY (ApprovalCard reusable but gate ergonomics need tier/SLA/batch); new CrmTone union (don't extend UiTone); crm i18n namespace ×11; storybook + jetbrains-mono in preview. Rationale: f02 recon binding conclusions. Alt: reuse ApprovalCard verbatim (rejected: no tier/SLA/batch affordances).
