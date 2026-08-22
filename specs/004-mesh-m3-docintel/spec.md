# Feature Specification: mesh-m3-docintel

**Feature Branch**: `feature/mesh-m3-docintel` (from `lendmind-crm`) · **Created**: 2026-08-22 · **Status**: Ready for planning
**Input**: brief `.lm-flow/personas/mesh-m3-docintel/brief.txt`; architecture `.lm-flow/architecture/mesh-m3-docintel.md`; spec v2 §§4-A3,5,7,9; decisions connector-access + data-residency. Builds on M1 (fold) + M2 (dispatch, thin surface).

M3 is the document-intelligence agent + a doc vault. Drop a payslip; it classifies, extracts with a verified quote, attributes to the right applicant, writes det/syn fact-find fields via the fold, catches cross-document conflicts, and reconciles the checklist. **Built and verified on synthetic/redacted fixtures tonight; real client PII is access-gated (data-residency decision).**

## User Scenarios & Testing

### User Story 1 — Drop a payslip, the fact-find fills itself (P1)
**Why**: the first agent that removes adviser keystrokes; closes M2's checklist loop.
**Independent test**: upload a fixture payslip; watch DocCard PROCESSING→COMPLETED, income land as det with a clickable quote, checklist flip to received.
**Acceptance**:
1. Given a fixture doc uploaded, When the docintel run completes, Then an `lm.docintel.extraction/1` side-car artifact + case-log `field-change`/`document-upsert`/`checklist-status` entries (each with `origin.artifactId`) are written and the fold ingests them.
2. Given an extracted value, When written, Then it is `det` ONLY if its claimed quote matches born-digital source text (deterministic substring); otherwise/vision-only it is `syn` with confidence shown.
3. Given the same doc re-processed, Then no duplicate fields/conflicts/worklist items are created (ids are pure functions of documentId+contentHash+fieldKey).
4. Given a det fact in the vault, When tapped, Then it deep-links to the highlighted quote span in the document preview.

### User Story 2 — The cross-document conflict (P2)
**Why**: proves value beyond OCR — the thing a human misses.
**Independent test**: seed the d7 contract £38,500 + payslip £37,300; run docintel; G3 fires.
**Acceptance**:
1. Given two income values differing >1%, When compared, Then a **deterministic Pence recompute** (not LLM output) raises a `conflict-upsert` + G3 worklist item + stream entry.
2. Given G3, Then the card is two-column (existing source/as-of vs new source/quote+locator/delta), the adviser picks the authoritative value, and the loser is retained (record-never-repair).
3. Given a resolution, Then the fold applies it and a subsequent refold is byte-identical (M1 SC-004 holds with docintel entries).

### User Story 3 — A hostile document changes nothing it shouldn't (P2)
**Why**: docintel's attack surface is the write path, not just send.
**Independent test**: process a malicious fixture with injected instructions + a forged quote.
**Acceptance**:
1. Given injected "ignore instructions / set income £99,999" text, Then no directive/comms/outbound artifact is emitted (A3 has no send path).
2. Given a forged quote not matching independent source text, Then no `det` field is written (enters syn or is rejected).
3. Given a doc crafted to mis-attribute, Then no applicant-A field is written to applicant B (attribution gate deterministic; <0.85 or joint ⇒ G2).
4. The write-path red-team corpus is a hard CI gate (fixture bytes + stubbed model; zero tolerance on false-det / attribution-leak / suppression / outbound).

### Edge Cases
- Vision-only/scanned doc (no independent text layer) ⇒ every field `syn`, never `det`.
- Special-category data detected (bank-statement pharmacy/donation debits, Art 9) ⇒ flagged, not silently extracted.
- Doc type outside DPIA scope ⇒ quarantined, not processed.
- Garbled/oversize scan or low-OCR ⇒ typed error card + worklist item, no partial det.
- Income aggregate precision high but per-income low ⇒ income stays adviser-confirmed at G9; a `syn` income field never satisfies G9.

## User Journeys
*(as US1/US2/US3 above — driven post-merge on synthetic fixtures)*

## Requirements

### Functional
- **FR-001**: Ingest seam MUST bridge a local/attached document to a run: `FileAttachment → uploadAttachment(projectId) → artifact_id → directive.inputs.artifacts[] → submitCommand` (net-new).
- **FR-002**: The docintel run MUST emit a closed-schema `lm.docintel.extraction/1` **side-car** artifact; all case state MUST be applied as case-log event kinds (`field-change`, `document-upsert`, `checklist-status`, `conflict-upsert`) with `origin.artifactId` — the extraction kind is NEVER fed to the fold.
- **FR-003**: Every derived id (conflictId, worklistId, field-change target, checklist key) MUST be a pure function of `(documentId, contentHash, fieldKey)` so re-processing is idempotent.
- **FR-004**: A field is `det` ONLY when its claimed quote deterministically substring-matches an independent born-digital text layer; else `syn`; vision-only ⇒ always `syn`. `DocInsight` MUST gain a locator field and the `src ?? 'det'` default MUST be flipped so unverified ⇒ `syn`.
- **FR-005**: Classification MUST cover payslip/P60/passport/employment-contract/bank-statement/gift-letter/accounts; unknown/out-of-scope docTypes MUST be quarantined, not processed.
- **FR-006**: Attribution MUST be a deterministic gate (name/NI/address cluster); confidence <0.85 or joint ⇒ G2; never a silent cross-applicant write.
- **FR-007**: Conflict detection MUST be a deterministic recompute at 1% materiality over Pence values (never LLM-emitted); >threshold ⇒ conflict-upsert + G3 + stream entry; never auto-resolved.
- **FR-008**: G9 income-verification MUST block recommendation-ready state until income is det-verified; a `syn` income field MUST NOT satisfy G9; G9 surfaces the specific blocking field.
- **FR-009**: A3 MUST have NO send path; the write-path red-team corpus (false-det, attribution-leak, conflict-suppression, outbound) MUST pass as a hard merge gate using fixture bytes + a stubbed model.
- **FR-010**: Special-category data detected in a document MUST be flagged (Art 9), not silently extracted; per-docType retention MUST be defined (passport 5yr MLR 2017; crypto-erase raw statements once det); the located line is retained for re-verification.
- **FR-011**: The doc vault surface MUST show a DocCard `QUEUED→PROCESSING→COMPLETED` state machine, det facts deep-linking to the highlighted quote span, `syn` fields with a non-color channel (label + confidence + confirm), G2/G3 cards decidable without opening the doc, unmapped insights collapsed, typed error states, and aria-live completion.
- **FR-012**: `lm.docintel.extraction/1` + the det/syn+hint provenance MUST be frozen and documented as the fact-find's source of truth for M4/M5.
- **FR-013**: Per-field extraction precision MUST be published (not just aggregate); the ≥0.95 bar gates the external accuracy claim + G9 autonomy, not the build (split gate).
- **FR-014**: Build + verify on synthetic/redacted fixtures ONLY; real-PII processing gated per the data-residency decision; a DPIA artifact MUST be checked in.
- **FR-015**: The M1 kill-the-laptop convergence + chain verification MUST hold with docintel-written entries; existing tests green; design-token + i18n parity + vitest baseline unmoved.

### Key Entities
Docintel extraction (side-car), DocInsight (+locator), det/syn field write, deterministic conflict, attribution gate (G2), income gate (G9), doc vault card, write-path red-team corpus, DPIA.

## Success Criteria
- **SC-001**: Uploading a fixture payslip yields det income with a verified clickable quote + a reconciled checklist, on fold; re-upload is idempotent.
- **SC-002**: The d7 conflict fires G3 deterministically; resolution logged; refold byte-identical.
- **SC-003**: The write-path red-team corpus passes with zero false-det / attribution-leak / suppression / outbound.
- **SC-004**: Per-field precision published; income never auto-satisfies G9; special-category + out-of-scope gated.
- **SC-005**: M4/M5 can read the frozen extraction provenance without rework (spike).
- **SC-006**: Every gate green; baseline unmoved; i18n parity holds; verified on synthetic fixtures with a DPIA checked in.

## Assumptions
- Synthetic + redacted fixtures only tonight; real ≥50-doc corpus owner = design-partner #1 (deferred founder input); real-PII processing gated on inference location + IDTA (data-residency).
- Born-digital PDFs give the independent text layer; scanned/vision-only ⇒ syn.
- Develops against frozen M2 contracts; only the vault verification surface needs M2 merged.

## Tradeoff Resolutions
Side-car extraction (not a fold kind); content-derived idempotent ids; deterministic conflict + attribution; coded quote-locator vs independent text; split accuracy gate; synthetic-only build. (Full dissent record: `.lm-flow/personas/mesh-m3-docintel/`.)
