# RESUME — Lendmind agent-mesh autonomous build (2026-08-22 late)

Read this + the `mesh-build-state` memory before continuing. Plan of record: `.lm-flow/spec/lendmind-agent-mesh-spec-v2.md`. ROADMAP.md is stale — ignore.

## Where the build is
- **M1** contracts + audit spine — MERGED (PR #53).
- **M2** watcher + onboarding + /crm surface — PR **#54 OPEN**. Fable-5 xhigh review = **BLOCK** (findings at `.lm-flow/runs/mesh-m2-watcher-onboarding/review-findings-iter-1.md`, 7 blockers; headline: /crm surface unwired). A **fix runner is in-flight** (Opus 4.8, log `.lm-flow/runs/mesh-m2-watcher-onboarding/log-fix1.jsonl`) fixing all 21 findings; it writes `.lm-flow/runs/mesh-m2-watcher-onboarding/done.flag` when done.
- **M3** docintel — PLANNED, launch-ready: `specs/004-mesh-m3-docintel/`, graph `.lm-flow/tasks/mesh-m3-docintel.json`, flow `.lm-flow/mesh-m3-docintel.flow.json`, milestone #4. Blocked on M2 merge (needs M2 dispatch code).
- **M4** connectors — PLANNED, launch-ready: `specs/005-mesh-m4-connectors/`, milestone #5. Framework + MSE(verified) + Mortgage Brain(verified:false scaffold).
- **M5–M8 + M-portal** — roadmapped, not planned (plan each when its dependency merges; don't speculatively plan against unmerged code).

## Exact next actions (in order)
1. **Finish the M2 loop** (M3 can't launch until M2 merges): when `done.flag` exists, re-review PR #54 with `claude -p --model claude-fable-5 --effort xhigh` using `.lm-flow/runs/mesh-m2-watcher-onboarding/review-prompt.md` (re-check all 21 findings). BLOCK → relaunch fix runner with new findings; loop until APPROVE. Never merge on BLOCK.
2. On **APPROVE**: `git fetch`; merge lendmind-crm into the M2 branch (resolve the trivial `.github/workflows/gates.yml` overlap from the CI-hole fix commit 364899f2 — both add `lendmind-crm`, keep one); confirm gates green locally; `gh pr merge 54 --squash --delete-branch`; `git worktree remove --force ../eigent-mesh-m2-watcher-onboarding`.
3. **Launch M3 runner** (Opus 4.8) from freshly-merged lendmind-crm — same pattern as M1/M2 (worktree from lendmind-crm, prompt referencing specs/004 + the flow json, pre-push guard, detached `claude -p --model claude-opus-4-8`, monitor for done.flag → Fable-5 review → merge). Then M4.

## Rules (do not violate)
- Build = Opus 4.8; review/gate = Fable 5 @ xhigh. Never merge on BLOCK. PRs → lendmind-crm, never main. GH issues disabled → tasks.md is the queue. No new deps; src/api/aion/v1/** + frozen contracts frozen.
- Runner auth: headless `claude -p` needs a fresh `claude /login` if it dies with oauth_org_not_allowed. Subscription only — Bharat does NOT want API-key billing.

## Deferred founder inputs (NOT build blockers)
- Design-partner #1 + their tool → first live licensed connector (M4).
- Model-inference location + IDTA → real-PII doc processing (M3).
- ~50 real redacted docs → M3's ≥0.95 accuracy claim.
- FINGERPRINT_SCRIPT (agentBrowser.ts) bot-evasion → Bharat's call; don't remove unilaterally.
- CI baseline (test/vitest-baseline.json) → regenerate from first Linux CI run.
