# Principal Architect perspective on mesh-m5-criteria-affordability

## What I support

Side-car artifact kinds + `origin.artifactId`-stamped fold entry kinds is the correct additive pattern — it mirrors M3's `lm.docintel.extraction/1` and keeps state living in the artifact, not the fold. **Source of truth** for every new entity is the immutable artifact; the fold holds a derived summary. That is coherent with the M1 hash-chain and kill-the-laptop convergence: re-folding replays content-hashed entries and re-derives ids, so identical input yields identical state. Pure/LLM-free calculators (mirroring `detectConflict`) are the right determinism boundary. `assertIndicative` as the M4-`assertClaimable`-shaped single choke-point **in the writer/fold, not UI**, is correct — UI hiding is not a control.

## What I want changed (Dissent:)

Dissent: derived ids must be pinned like M3's `derivedId(kind, documentId, contentHash, fieldKey)`. The doc never states how `lm.scenario.run/1`/assessment ids are formed. **By what mechanism** is a re-run idempotent? Require: assessment/scenario ids are pure functions of `(packRef, caseFactsHash, deltaHash)`. Absent this, a re-dispatch double-writes and convergence is a coin toss.
Dissent: "the calculators are pure" is asserted, not enforced. Floating-point in stress-rate/LTI math is non-determinism drift. Require integer-pence + rational/basis-point arithmetic only; ban `number` division that isn't pinned by golden vectors across platforms.
Dissent: M4 coupling is called "optional" but the artifact embeds product terms. State the failure type when a scenario references a **stale/superseded** sourcing snapshot — this is M4's `assertClaimable` stale case leaking into M5. `assertIndicative` should refuse an A6 payload whose product came from a snapshot that no longer passes `assertClaimable`.

## What I would not ship without

1. **Idempotent derived ids** for every artifact and fold entry (external-write-equivalent: the fold IS the ledger).
2. **Observability**: structured log with a correlation id per scenario run (caseId, adviserId, packRef, scenarioHash) so an on-call can reconstruct why a verdict flipped from the log alone.
3. **Pack versioning**: `packRef` must be a content-hashed, immutable pin; an assessment records the exact pack version it ran against — never "latest".
4. **Typed failure enum** on `assertIndicative` (`client-surface|not-indicative|g9-unverified|wrong-surface|stale-product`) covered by the no-client-embed CI test.

## Acceptance criteria from my lens

- Re-fold of any scenario/criteria/affordability/override log yields byte-identical derived state (convergence test, new kinds included).
- Same `(pack, caseFacts, delta)` → identical artifact id and pence outputs across two machines (cross-platform golden vector).
- No client-facing component can decode `lm.affordability.assessment/1` (CI).

## Edge cases I want addressed

- Two advisers assess the same case concurrently → first-wins counter, no id collision.
- Pack mutated mid-scenario-set → each scenario pins its own `packRef`.
- `refer` on `syn`/missing input never silently promotes on re-run.
- Oversize working exceeds the fold refuse-threshold → attachment path, summary folds.
