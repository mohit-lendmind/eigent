# Product Manager perspective on mesh-m1-contracts-audit-spine

## What I support
The milestone boundary is broadly right. M1 is the fan-out dependency for M2/M3/M4; keeping UI out avoids coupling the spine to M2's thin-surface decisions and the design-token/i18n CI gates. Users are named: the FCA-authorised adviser (reached via M2+) and the compliance buyer, for whom "the audit record IS the product" — hash chain + export v2 is that spine; M1's direct consumer is the M2 runner. Merging `fix/crm-review-iter1` first, zero new deps, kill-the-laptop test: all good.

## What I want changed (Dissent:)
- **Dissent: M1 has no named demo.** Add a checked-in, scripted demo: fold the golden c417 log → stores populate → wipe all five stores → refold converges byte-identical → tamper one entry → export v2 shows `chainVerified: false` → unknown-major quarantines with a count. Provable to a human without UI. Do NOT move a count badge into M1 — one number is not worth the i18n/token gates.
- **Dissent: add an M2 rendering contract instead.** Stable, test-pinned selectors — `quarantineCount(caseId)`, chain status, watermark, fold-halt reason — so M2's Today queue binds without rework. Acceptance: an M2 spike renders an approval card from `GATE_REGISTRY` data alone.
- **Dissent:** open questions #1 (outbox carrier) and #2 (case↔project binding) resolve inside M1; #3 (chat-timeline noise) gets a named owner and an M2 deadline.
- **Dissent:** stamp `firmId` in `lm.caselog/1` now (open q5). The field is cheap; the migration is not.

## What I would not ship without
- The scripted demo, green from a clean checkout.
- An explicit MVP cut in the plan: P1+P2 are the milestone; P3 may slip without blocking M2.
- Contract freeze: tagged `.d.ts` under `specs/.../contracts/`. Failure metric: any breaking contract change M2 requires (target zero; one major bump = retro).

## Acceptance criteria from my lens
- 108 existing CRM tests and vitest baseline unmoved.
- Quarantine rate on the golden corpus = 0; the counter is cumulative and survives N=200 eviction — buyers ask "how many ever", not "how many retained".
- Success metric, two weeks post-M1: M2 runner consumes the contracts with zero M1 amendment PRs.

## Edge cases I want addressed
- Fold latency budget for a 1,000-entry log on case open (propose <500ms) — case-open is M2's activation moment.
- Quota-pressure write refusal: the typed refusal must map to a worklist item the adviser actually sees in M2.
- `content_truncated` and duplicate-seq must increment visible counters, not just warn to console.
