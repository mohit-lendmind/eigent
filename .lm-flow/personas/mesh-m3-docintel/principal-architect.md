# Principal Architect perspective on mesh-m3-docintel

## What I support
- (Q1) M3 rides M1's fold with **zero fold changes**: `field-change`, `conflict-upsert`, `document-upsert`, `checklist-status` et al. are already reduced, and `lm.docintel.extraction/1` is in `KNOWN_MAJORS`. Genuinely additive — no new coupling. No external tool access, per connector-access §22.
- (Q5) M3 develops against the **frozen** M2 contracts without M2 being MERGED; only the doc-vault surface needs the merge. Integration-gate on merge.

## What I want changed (Dissent:)
Dissent (Q1): The doc conflates two records. `lm.docintel.extraction/1` is an artifact **family**, not a case-log **event** kind — feed it to the fold and `isKnownCaseLogEventKind` quarantines it. State deltas MUST ride as case-log entries whose `origin.artifactId` points back to the extraction side-car. Say this, or M3 builds the wrong writer.

Dissent (Q3): Do not let A3 emit `conflicts:[]`. 1% materiality is arithmetic over two Pence values — a **deterministic recompute** over the fold's projection (conflicts.ts), never an LLM opinion; agent-authored conflict is non-reproducible and breaks refold-equality. Attribution: model proposes `clientId` + features; the 0.85 gate stays deterministic.

Dissent (Q2): The fold dedupes at the **log** level only (seq/watermark). Re-processing mints new seqs → double writes; `directiveIdentity` includes `attemptNonce`, so dispatch won't dedupe retries. Every id M3 derives — conflictId, worklistId, field-change target — MUST be a pure function of `(documentId, contentHash, fieldKey)`, never runId/random. Unstated and load-bearing.

## What I would not ship without
- Doc-scoped deterministic id derivation (above), with a re-process test.
- (Q4) Quote-locator enforced in extractionApply as a deterministic **substring match** against source text — not a non-empty check, not prompt-only. Trap: `applyFieldChange` and casesStore default `src ?? 'det'`, so absence silently yields `det`; agent writes must set `src`, unmatched ⇒ `syn`.
- `traceId` on every entry; DPIA checked in before merge.

## Acceptance criteria from my lens
- Refold-from-zero lands byte-for-byte.
- Re-process (same bytes) → identical projection, no duplicate conflicts/items.
- Fabricated-quote doc → field enters `syn`.
- d7 £38,500/£37,300 fires one deterministic G3.

## Edge cases I want addressed
- Same doc re-uploaded / retried (nonce differs).
- Amended doc (new bytes, same fieldKey) — supersede vs conflict?
- Quote matches only after whitespace/OCR normalisation.
- Attribution to a placeholder applicant.
- Oversize entry (>128KB) — fold refuses but advances chain; insight must not be lost.
