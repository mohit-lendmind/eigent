# Compliance perspective on mesh-m4-connectors

## What I support
- The full-result-set snapshot (declines + `ratesAsAt` + coverage, immutable, hash-chained) is the evidence-of-research spine MCOB 4.7A.9R records demand.
- Coverage statement as a mandatory adapter output; nothing labelled live until a replay eval passes ([[connector-access]] §4).
- G5 as human monopoly; MSE branded "NEVER whole of market".

## What I want changed (Dissent:)
- **Dissent (Q1):** "Adviser-facing only" prose is NOT enough. Invariant 2 (PERG 4.6.16A/4.6.25B — an agent-ranked list reaching a client is *making arrangements* / an unapproved financial promotion) needs a hard, testable control. Every `lm.sourcing.snapshot/1` and derivative carries `surfaceClass:"adviser-only"`, enforced at the render/send boundary, with a CI test asserting no client surface (A1 portal, A7 G4a/G4b) can decode or embed a sourcing artifact.
- **Dissent (Q2):** Coverage can't rely on the statement string. Make it a typed enum + machine-checkable `wholeOfMarket:boolean`; a lint gate rejects the literal phrase "whole of market" in any surface/evidence artifact unless the source snapshot's flag is true (MCOB 4.4A.4R(3), 4.4A.1R scope-of-service). Copy the coverage statement *into* every evidence pack and shortlist — never a pointer that can drift.

## What I would not ship without
- **(Q5)** A hard bar: any `verified:false` adapter MUST be excluded from suitability, evidence-of-research, and client-facing artifacts — enforced in the fold, not just UI, with the block covered by a passing test. A scaffold in an MCOB 4.7A record is mis-selling exposure.
- **(Q4)** Written confirmation each licensed portal's ToS permits automated logged-in access before that adapter builds (§8.2 [VERIFY]). Agent-as-agent-of-adviser: the adviser is accountable for every action under their seat (SYSC 8 does not transfer liability; SM&CR). Every automated action stamps acting adviser id + take-control availability in the chain.

## Acceptance criteria from my lens
- Test proves a sourcing artifact cannot render on any client surface.
- Test proves `verified:false` blocks evidence/suitability use.
- Coverage-phrase lint gate green; snapshot carries enum + flag.
- Every snapshot stamps adviser id, `ratesAsAt`, coverage, `verified`.

## Edge cases I want addressed
- Zero/partial results — coverage statement narrows accordingly, never silently implies fuller coverage.
- Portal ToS changes post-launch — kill switch disarms the adapter.
- Stale rates at recommendation — G5 warns if snapshot age exceeds a config threshold.
- Two adapters, differing coverage — evidence pack states the honest union, not the wider claim.
