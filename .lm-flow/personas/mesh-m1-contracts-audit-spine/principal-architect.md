# Principal Architect perspective on mesh-m1-contracts-audit-spine

## What I support
Artifact-canonical with F01 as derived cache is the right inversion; the fold transposing reducer.ts's seven invariants (verified: BigInt watermark reducer.ts:401, referential no-op :439) is exactly how I want it done. Not touching `src/api/aion/v1/**` and subscribing at `aionArtifactsStore` is the correct blast wall. House decode over zod — agreed; open-set typing IS the quarantine mechanism. Idempotency is explicit everywhere (envelope sha256+nonce, attachment POST keyed by content hash). Per-case halt beats global halt.

## What I want changed (Dissent:)
- **Dissent (two-writer):** settle-by-hash is underdefined. The canonical writer stamps `seq`/`prevHash`/`hash`; a full-content hash of the echo can never equal the unsequenced candidate's. Pin `settleHash = sha256(canonical entry minus writer-assigned fields)` in the M1 contract — M2's writer must reproduce it byte-for-byte.
- **Dissent (convergence):** "settled → mark applied without re-applying" breaks batch≡incremental when the echo sequences the local edit after non-commutative canonical entries. Either constrain M1 outbox kinds to last-writer-wins field ops, or refold-from-0 on out-of-position settle. Pick one; the convergence test must cover it.
- **Dissent (env-key wipe):** eventLogStore mixes derived state (watermarks, pending, quarantine — safely wiped and refolded) with source data (unflushed outbox — destroyed, unreconstructable). Split the policy: wipe derived; stash or loudly surface unflushed outbox. Silent adviser-edit loss is not "converge".
- **Dissent (quarantine stranding):** quarantine+advance means a later build that understands the major can never reinsert mid-stream. Stamp the contracts version in eventLogStore; widened kind set → refold-from-0.

## What I would not ship without
- The settle-hash contract (above) — it is a cross-milestone wire contract, not an implementation detail.
- A chain-break recovery mechanism: halt is right, but reserve a `chain-anchor` union member NOW (record-never-repair means repair is writer-side); halted cases must also warn on local writes; gap and tamper get distinct worklist kinds.
- `firmId` on `lm.caselog/1` — close open Q5 as yes. Field is cheap; migration is not. That is the tenancy story.

## Acceptance criteria from my lens
- Kill-the-laptop test asserts unflushed-outbox fate is surfaced.
- Convergence fixture includes a non-commutative interleaved echo.
- Upgrade test: quarantined entry + widened kinds → refold converges.

## Edge cases I want addressed
- Two outbox candidates with equal content hash (CAS dedupes the attachment; one echo, two records).
- Echo never arrives: outbox-age threshold worklist item.
- Chain break at seq 1.
- Quarantine/outbox payloads are PII at rest in localStorage — spec §9 tension deepens (outbox cannot be ephemeral); record it.
