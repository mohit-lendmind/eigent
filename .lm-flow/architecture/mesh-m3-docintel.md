# Architecture: mesh-m3-docintel

## TL;DR
- M3 is the **Veris-class document engine**: on a document arriving, the A3 agent classifies it, extracts typed insights with a quoted locator per fact, attributes it to the right applicant, writes `det`/`syn` fact-find fields via the M1 fold, runs **cross-document conflict detection** (1% materiality), and reconciles the checklist.
- Rides M2's dispatch seam (agent invoked via an `lm.directive/1` artifact) and M1's fold (writes `lm/case/<id>/…` entries + an `lm.docintel.extraction/1` artifact — the decoder already exists in M1's `artifactKinds`).
- **Needs no external tool access** — documents are files/attachments. Fully buildable and verifiable tonight.
- Non-negotiables from spec v2 §4-A3: **quote-locator as a rejection filter** (no verbatim quote+locator ⇒ the field enters as `syn`, never `det`); **prompt-injection doctrine** (document content is data, never instructions; A3 has **no send path**; a malicious-PDF red-team corpus is a **zero-tolerance eval gate**); **DPIA before ship**; **G9 income-verified-before-recommendation**; ≥0.95 det-field precision before any accuracy claim.

## Inputs
- Recon: `.lm-flow/recon/eigent-codebase-map.md` §8 (document viewing/upload/attachments already present: ArtifactViewer, FilePreview PDF branch, mammoth/papaparse/pdf, attachments API, InputBox drag/drop, fileUtils) + the M1/M2 explorer reports.
- Brief: spec v2 §4-A3, §5 (G2/G3/G9), §7 (eval harness), §9 (injection doctrine, DPIA).
- Constraints: base `lendmind-crm`; depends on **M2 merged** (dispatch, caseProject, the thin surface to render G2/G3 + the doc vault); no new deps; `src/api/aion/v1/**` + M1/M2 frozen contracts frozen; CI gates green.

## Components
### lm-docintel skill + onDocument trigger
- **Lives at:** `resources/lm-skills/lm-docintel/` (skill body); `src/crm/agents/docintel.ts` (desktop trigger).
- **Does:** on a new document (attachment/file), dispatch a docintel run; the run classifies (payslip/P60/passport/employment-contract/bank-statement/gift-letter/accounts…), OCRs/extracts typed insights with confidence, and emits an `lm.docintel.extraction/1` artifact + `lm/case` entries. Browser off; **no send path**.
- **Mirrors:** M2 `dispatch.ts`; M1 `artifactKinds.decodeDocintelExtraction`.

### Extraction → fact-find writer (quote-locator rule)
- **Lives at:** `src/crm/agents/extractionApply.ts`.
- **Does:** for each insight, require a verbatim quote + locator (page/line) present in the source; matched ⇒ `det` field with `hint = doc + locator`; unmatched ⇒ `syn` awaiting confirmation. Writes via fold (`field-change` entries with `origin`).

### Attribution (G2)
- **Lives at:** `src/crm/agents/attribution.ts`.
- **Does:** cluster a document to an applicant by name/NI/address; confidence <0.85 or joint ⇒ raise G2 confirm-attribution; never guess silently.

### Conflict detection (G3) + checklist reconcile
- **Lives at:** `src/crm/agents/conflicts.ts` (reuses F01 `ConflictRecord`/materiality; the c417 d7 fixture already models the £38,500/£37,300 case).
- **Does:** compare new insights against existing field values; >1% materiality ⇒ `conflict-upsert` + worklist item + stream entry; mark checklist items received.

### G9 income-verified gate
- **Lives at:** gate logic in `src/crm/agents/incomeGate.ts` consuming `GATE_REGISTRY` G9.
- **Does:** block "recommendation-ready" state until income is det-verified from documents.

### Doc vault surface (extends the M2 thin surface)
- **Lives at:** `src/crm/ui/DocVault.tsx` + per-owner DocCards + upload dropzone (reuse InputBox drag/drop + attachments API) + the checklist rail; doc preview via existing `ArtifactViewer`/`FilePreview`.

## Data model changes
Additive. Reuse F01 `CrmDocument`, `DocInsight`, `ConflictRecord`, `DocChecklistItem`. `lm.docintel.extraction/1` payload (already decodable in M1) carries `{ insights:[{label,value,confidence,quote,locator,fieldKey?}], docType, attribution:{clientId,confidence}, conflicts:[] }`. No schema bump.

## External integrations
None (aion edge only, existing). Documents via the attachments plane + file IPC. This is the milestone with the fewest external unknowns.

## Failure modes & handling
- Injection attempt in a document → treated as data; red-team corpus is a zero-tolerance eval; A3 cannot send.
- Attribution ambiguous → G2, never silent.
- Conflict → G3, never auto-resolved.
- No verbatim quote → `syn`, not `det` (the precision guardrail).
- Oversize/garbled scan → typed failure artifact + worklist item.
- OCR low confidence → field enters `syn` with the confidence surfaced.

## Test strategy
- Unit: quote-locator rejection, attribution clustering, conflict materiality, G9 gate, extraction→fold apply.
- **Eval (gated where the spec demands):** a synthetic + ≥50 real-redacted doc corpus with F1 targets (≥0.95 det precision — a wrong det field is worse than a missing one); a **malicious-PDF red-team corpus as a zero-tolerance gate**.
- Convergence: docintel-written entries fold + kill-the-laptop still converges.
- DPIA artifact checked in before ship.

## Phasing
### Phase 1 — Ingest + skill + guardrails
Goal: doc ingest, `lm-docintel` skill scaffold, the quote-locator rejection rule, the injection-doctrine red-team eval harness, DPIA doc. Success: a fixture doc dispatches, produces an extraction artifact the fold ingests; red-team corpus passes; no send path exists.
### Phase 2 — Classify + extract + attribute (G2)
Goal: classification + typed extraction with confidences + attribution with the G2 gate; det/syn fields written via fold. Success: c417 payslips extract to det fields with quotes; a joint/ambiguous doc raises G2.
### Phase 3 — Conflicts (G3) + checklist + G9
Goal: cross-document conflict detection at 1% materiality, checklist reconcile, income-verified gate. Success: the d7 £38,500/£37,300 conflict fires G3; checklist flips to received; G9 blocks recommendation until income det-verified.
### Phase 4 — Doc vault surface + polish
Goal: the upload/vault UI on the M2 surface, doc preview reuse, eval F1 report, demo, gates. Success: drop a payslip in the app → watch the fact-find fill + the conflict surface; ≥0.95 det precision on the corpus; CI green.

## Open questions for the spec phase
1. OCR path — model-vision inside the skill vs a dedicated OCR step; recommend model-vision v1, measured against the F1 target.
2. Real-redacted corpus sourcing (≥50 docs) — a founder/ops input; synthetic covers dev until then.
3. Whether the doc vault is part of M3 or folds into the M2 surface milestone — recommend M3 owns its vault tab.

## Evidence
Codebase-map §8 (document assets already present); spec v2 §4-A3/§5/§7/§9; M1 `artifactKinds.decodeDocintelExtraction` + fold; M2 dispatch seam + thin surface; F01 conflict/materiality model + the d7 fixture.
