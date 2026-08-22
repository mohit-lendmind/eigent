# Software Engineer perspective on mesh-m2-watcher-onboarding

## What I support
Dispatch composition is real: `uploadAttachment`→`submitCommand({attachment_ids})` is how `startAionTask` already works. Skill PUT too — `putAionSkill` builds the PascalCase `{Name,Description,PromptText,Metadata,Files:[{Path,Content,Mode}]}` doc, rejects unknown top-level keys, returns `{changed, ignored_fields}`. `Case.aionProjectId` exists; the fold already reads `lm/case/<id>/` and quarantines malformed rows. Clean cut on the micro-portal.

## What I want changed (Dissent:)
**Dissent (Q1 — nothing awaits the run).** `startAionTask` is fire-and-forget; resolves on admission. There is NO terminal await, and `dispatchDirective` returning `{commandId,runId}` gives no completion signal. State plainly: completion is observed via fold entries + reducer `pendingApprovals`, not awaited. Directive artifact must be `media_type:application/json` and must NOT start with `aion-` (refused).

**Dissent (Q4 — the firm index is unwritable as drawn).** Watcher runs in the coordinator project; artifacts are per-project. Onboarding runs in the *case* project and cannot write the coordinator's `cases.json` unless edge runs write cross-project — Open Question #1, still open. So the **desktop** must publish `lm/firm/<id>/cases.json` into the coordinator (it alone holds the fold's log-head). Also unverified: that the edge run can read its own artifacts by name — `readAionArtifact` is desktop-only. Prove both in Phase 1 or the watcher is blind.

**Dissent (Q3 — budget can't see per-run spend).** `consumption.cost.costMicroUSD` lands only if a live session observes `run_completed`. Fire-and-forget misses it; `getUsage` (settled, bigint, tenant-wide) lags and isn't pass-scoped. Pick one: hold the session to terminal, or accept delayed reconciliation. FX must be bigint end-to-end; name the field's direction and pin the formula.

## What I would not ship without
- **Q2 aggregator lifecycle.** `ProjectSession` is standalone but each `.start()` is one SSE stream that `failed`s after 5 retries. Cross-case gates need a ref-counted pool keyed by projectId, `.stop()` on case-inactive, dedup against live `bindings`, concurrency cap. No pool = N leaked sockets.
- Fold liveness fires only from a live binding's `onState`. Dispatch must keep a session (or `attachCaseLogLiveSource`), else the checklist never appears.

## Acceptance criteria from my lens
- Phase 1: fixture directive round-trips envelope→JSON artifact→command→run→`lm/case` entry the fold ingests, AND the edge run reads a coordinator artifact by name.
- Budget test asserts bigint FX + breaker (12/case/hr) with zero float drift.
- Aggregator test: subscribe/unsubscribe leaves zero live sessions.

## Edge cases I want addressed
- Pass >5min → next tick `skipped_busy` silently; surface it.
- `watcherPassMicroGbp` default 20_000 (£0.02) trips on any LLM-touching pass — fast-path must skip to ~1 actionable case/pass, or raise the cap.
- Re-PUT is LWW unless `deployLendmindSkills` lists first to seed `knownVersions`.
- Firm index concurrency: append newest version per case; watcher reads highest.
