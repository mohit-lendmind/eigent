# Software Engineer perspective on mesh-m3-docintel

## What I support
- Riding M1's fold + `decodeDocintelExtraction` (exists) and the outbox settle path. Writes land as data-plumbing, not a type migration; the data model is additive, no schema bump.
- No external tools, no send path — the smallest attack surface of any milestone. `lm.docintel.extraction/1` already decodes.
- Quote-locator as a hard det/syn filter is the right guardrail, and the house already has the "locate by search" pattern (ArtifactViewer `ViewerSelection` offset -1).

## What I want changed (Dissent:)
- **Dissent:** the doc says M3 "depends on M2 merged" and "reuses F01 materiality" — neither is true on `lendmind-crm` today. No `dispatch.ts`, `caseProject`, `agents/`, or `crm/ui/`. `ConflictRecord`/`upsertConflictRecords`/the fold's `conflict-upsert` case exist, but the **detection + 1% materiality computation is net-new** — `conflicts.ts` must compute it; the store only applies a pre-computed entry. Call that build, not reuse.
- **Dissent:** the ingest path is half-wired. `fileUtils` yields a local `FileAttachment{filePath}`; nothing climbs `transport.uploadAttachment` → `artifact_id` → `inputs.artifacts` → `submitCommand`. That upload seam (3 MiB/attachment, 32/cmd, 8 MiB total, edge ≥1.16) is Phase-1 work, not an assumption.

## What I would not ship without
- **Deterministic quote match against an independent text layer.** There is no in-app PDF text extraction (no pdfjs/pdf-parse; PDFs are data-URL iframes). String-searching the model's own OCR output is circular. Born-digital PDFs → pull the text layer, whitespace-normalise, exact substring-match → det. Scanned/vision-only → the quote is model-trusted → **syn, always**.
- The red-team corpus as a **hermetic** gate: committed fixture bytes + a stubbed model, asserting invariants that need no live model — empty send-capability manifest, no det without a verifiable quote, injected instructions never emit a directive/comms artifact. Zero-tolerance = the job fails on any det or outbound artifact.

## Acceptance criteria from my lens
- Test pyramid: unit-heavy (~70%: quote-match, materiality, attribution clustering, G9, extraction→fold apply); fold/outbox integration ~25%; one e2e drop-a-payslip ~5%.
- Local dev: desktop-only ingest driven by a fixture directive, model stubbed by a recorded transcript — no API key for CI.
- F1: precision ≥0.95 on det fields against a labelled corpus, run nightly/manual — **not** per-PR (live model is the 08-22 headless-auth blocker).

## Edge cases I want addressed
- Same bytes uploaded twice (CAS dedupe → same `artifact_id`): idempotent, no double-extract.
- Attachment >3 MiB / >8 MiB total → typed failure artifact + worklist item, never a swallowed 413.
- OCR "fixes" a typo the source never had → the quote match must fail (no fuzzy match).
- Two docs conflict at exactly 1.0% → define the boundary (≥ vs >).
- Vision unavailable on the stamped model → degrade to syn and surface it; never silently skip.
