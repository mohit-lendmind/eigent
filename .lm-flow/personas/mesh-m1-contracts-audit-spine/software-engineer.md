# Software Engineer perspective on mesh-m1-contracts-audit-spine

## What I support
- No-zod decode pattern: verified — `contracts.ts:29-30` is the open-set `(string & {})` precedent; zod appears nowhere.
- The `_bus.ts` seam is real: `casesStore.ts` already registers `registerCasesReadBus` at module scope; `EventLogSideBus` fits without touching the ESLint gate.
- `canonicalise()` already exported (`caseFile.ts:269`).
- Fixture-driven local dev (no edge needed), fix-branch-first phasing, e2e gap stated not hidden.

## What I want changed (Dissent:)
1. **Dissent: fold concurrency unspecified.** The awaits sit between watermark check and setState: fetch inline → decode → `await computeEntryHash` → apply. Case-open refresh racing a live notification both pass the watermark pre-await → double/interleaved apply. `reducer.ts` never faced this — it is fully sync. Require: per-case serialized fold (`browserDelegationExecutor` pattern); hash the whole batch first, then apply + advance watermark with zero awaits between; re-check watermark after every await.
2. **Dissent: quarantine payloads verbatim in localStorage.** Quota is ~5MiB shared with four stores; inline entries run to 1MiB; zustand persist re-stringifies the whole store on every set — megabytes of JSON per watermark advance. Store a pointer instead (artifactId, version, contentHash, reason, ≤16KB preview); the artifacts plane is canonical and refetchable. Don't persist `pendingByCase` either.
3. **Dissent: "idempotency keys on attachment POSTs" is false.** `transport.ts:377` `uploadAttachment` is "No Idempotency-Key by contract", and `src/api/aion/v1/**` is frozen. Retry safety is CAS byte-dedupe + settle-by-hash; retries mint new name versions. Correct the table.
4. **Dissent: `Case.aionProjectId` does not exist** in `domain/types.ts` (verified). List it in Data-model changes as additive-optional.

## What I would not ship without
- A `crypto.subtle` canary. `test/setup.ts` provisions storage, not crypto; jsdom 26's `window.crypto.subtle` is undefined (probed). Tests work only because vitest 2.1.9 keeps Node's webcrypto on the global (verified; CI Node 20 fine). Pin ownership in setup.ts like MemoryStorage does.
- Bus registration guarantee: import-time registration means a null bus until the fold layer loads — adviser edits silently unrecorded. Barrel side-effect import; null-bus dispatch is loud; a test.
- `eslint.config.js` + `crossStoreImports.test.ts` extended so stores cannot import `./fold/*`.

## Acceptance criteria from my lens
- Racing-triggers fold test; batch ≡ incremental byte-identical.
- eventLogStore persisted blob bounded under the quarantine fixture; outbox refusal via explicit size accounting (zustand persist swallows QuotaExceeded).
- Outbox local hash chain serialized; the crash window between sync setState and persisted enqueue documented and reconciled at startup.

## Edge cases I want addressed
- Env-key wipe drops unflushed outbox — local edits unrecoverable (refold reconstructs only agent-authored state). Pin in kill-the-laptop test.
- Two identical local edits → identical content hash: which record does settle-by-hash settle?
