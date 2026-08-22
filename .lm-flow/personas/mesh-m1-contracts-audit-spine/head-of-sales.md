# Head of Sales perspective on mesh-m1-contracts-audit-spine

## What I support
- The hash chain + export v2 IS my compliance one-pager spine. "Tamper-evident audit trail" — yes, `verifyChain` plus `chainVerified: false` on a broken export is provable, not marketing. "SAR-ready export" — yes, export v2 with caseLogEntries, chain head, artifact manifest is what the design partners' compliance reviewers inspect (§11 makes the export pack part of the deal — this milestone builds that artifact).
- Gate registry as data — yes, I can show a prospect their own gate policy: G1–G10 with approver, delegable-or-not, and `basis` citing MCOB chapter and verse. That table sells itself.
- Kill-the-laptop converge test is a security-questionnaire answer, not just engineering hygiene.
- No new dependencies, no third-party processors, WebCrypto hashing — clean answers for a prospect's security team.

## What I want changed (Dissent:)
- Dissent: export v2 omits the gate policy. Add a `gatePolicySnapshot` (registry + firm config delegation roster) to the export envelope — a SAR pack that shows *who could approve what* is a bake-off winner.
- Dissent: quarantine eviction (open question 4). An audit product that silently evicts malformed records loses the bake-off to that exact question. Retain at minimum hash + kind + timestamp of evicted records forever; export them.
- Dissent: open question 5 — stamp `firmId` now. Five design-partner firms is multi-firm on day one of pilots; migration mid-pilot is a deal risk.

## What I would not ship without
- A written "claims I can/cannot make" list. After M1 I CANNOT say: no live agents, no gates *enforced* (data only, M2), no DPIA (M3), no encrypted-at-rest local cache (§9 — localStorage PII is a questionnaire landmine; name its milestone), retention/FCA-2-day-retrieval unproven edge-side.
- A scripted demo: export fixture case c417, flip one byte, watch `chainVerified` fail. Five minutes, one wow moment, no UI needed.

## Acceptance criteria from my lens
- Export v2 verifies its own chain and a tampered bundle visibly fails.
- Gate registry renders to a human-readable policy table with regulatory basis, from data alone.
- Deferred-claims list exists per milestone.

## Edge cases I want addressed
- Prospect asks "where does my data live?" — localStorage answer must not be improvised.
- Export taken while outbox unflushed — pack must state incompleteness loudly.
- v1 bundle import (`chainVerified: null`) shown to a regulator — needs explanation text.
