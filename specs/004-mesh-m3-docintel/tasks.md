---
description: "Tasks — mesh-m3-docintel (M3)"
---
# Tasks: mesh-m3-docintel

Additive under src/crm/agents, src/crm/ui, resources/lm-skills/lm-docintel, test/unit/crm, docs; named mods: src/crm/domain/types.ts (DocInsight +locator, flip src default — additive), the M2 thin surface for the vault tab. src/api/aion/v1/** + M1/M2 contracts frozen. Branch feature/mesh-m3-docintel from lendmind-crm; PR to lendmind-crm. Synthetic fixtures only — no real PII.

## P1 — ingest + skill + guardrails

- [x] T001 Baseline gates green on lendmind-crm (record)
- [x] T002 DocInsight +locator field; flip `src ?? 'det'` → unverified defaults to `syn` (FR-004); additive, no schema bump
  - DONE: the fold + live write default now key on the writer via `defaultFieldSrc(actorKind)` in `src/crm/domain/fieldSrc.ts` — only a human/manual adviser edit defaults to `det` (so every historic M1/M2 refold stays byte-identical, guarded by fr004FoldFloor.test.ts + convergenceDocintel), any agent/watcher/unknown writer floors to `syn`. `caseLogFold.ts` and `casesStore.setFactFindField` both route through it.
- [x] T003 Ingest seam: FileAttachment → uploadAttachment(projectId) → artifact_id → directive.inputs.artifacts[] → submitCommand (FR-001)
- [x] T004 lm-docintel skill scaffold (no send path) + closed `lm.docintel.extraction/1` schema per contracts (FR-002/009)
- [x] T005 Side-car apply: extraction → case-log field-change/document-upsert/checklist-status entries w/ origin.artifactId (never feed extraction kind to fold) (FR-002)
- [x] T006 derivedId() pure fn(documentId,contentHash,fieldKey); re-process idempotent (FR-003)
- [x] T007 Write-path red-team harness (fixture bytes + stubbed model): assert no false-det, no attribution-leak, no conflict-suppression, no outbound — hard CI gate (FR-009)
- [x] T008 docs/dpia-docintel.md (Art 6(1)(b), processor+inference location, Art 9, Art 13(2)(f), Art 22, per-docType retention) (FR-010/014)
- [x] T009 [P] Tests: ingest round-trip → folded entry; idempotent re-process; classifySrc det/syn

## P2 — classify + extract + attribute (G2)

- [x] T010 Classification (payslip/P60/passport/contract/statement/gift/accounts); out-of-scope ⇒ quarantine (FR-005)
- [x] T011 extractionApply.ts: coded substring match of quote vs born-digital text ⇒ det, else/vision-only ⇒ syn (FR-004)
- [x] T012 attribution.ts: deterministic name/NI/address cluster; <0.85 or joint ⇒ G2; special-category ⇒ flag (FR-006/010)
  - DEFERRED (documented, not faked): confirming a G2 gate (`confirmAttributionGate`) records the confirmation and closes the gate but does NOT re-project the held fact-find fields onto the confirmed applicant — those land on the next re-ingest with the applicant known. The re-run-applyExtraction-on-confirm hookup is P5 follow-up T026.
- [x] T013 [P] Tests: extract det with verified quote (c417 payslips); vision-only ⇒ syn; G2 fires on ambiguous; special-category flagged

## P3 — conflict (G3) + checklist + G9

- [x] T014 conflicts.ts: deterministic Pence recompute at 1% materiality ⇒ conflict-upsert + G3 + stream (never LLM) (FR-007)
- [x] T015 Checklist reconcile (received/partial) from extraction (FR-005)
- [ ] T016 incomeGate.ts: G9 blocks recommendation until income det-verified; syn income never satisfies; surfaces blocking field (FR-008)
  - DONE: `assessIncomeGate` (coded, syn never satisfies), and it is wired into the running vault via `selectCaseIncomeGate` + a mounted `IncomeGateCard` that names the blocking applicant/field (US3).
  - DONE (iter-2 trust-spine hardening): G9 now counts only `det` MONEY facts — `IncomeFactState` carries the value type and `assessIncomeGate` requires `src === 'det' && valueType === 'money'`, so a fabricated/never-verified `det` TEXT income value can never satisfy the gate. Mirrored in `selectCaseIncomeGate`, with defense-in-depth in `extractionApply` (a money-semantic fieldKey whose value fails money parsing floors to syn). Pinned by redteamWrite.test.ts (det-text income leaves G9 open).
  - DEFERRED (de-scoped, not faked): actually *blocking a recommendation* — there is no recommendation/G5 flow in M3 (G5 is only a gate descriptor in the registry, no caller), so there is no transition to gate yet. The block-the-recommendation hookup lands with the recommendation surface in a later milestone.
- [x] T017 [P] Tests: d7 £38,500/£37,300 fires G3 deterministically; resolution logged; refold byte-identical (SC-002/004); G9 blocks on syn income

## P4 — doc vault surface + polish

- [x] T018 DocVault.tsx + DocCard QUEUED→PROCESSING→COMPLETED; upload dropzone (reuse InputBox/attachments); vault tab on the M2 surface (FR-011)
  - DONE (iter-2): the QUEUED state now has a production producer — `uploadVaultDocuments` emits a QUEUED document-upsert at ingest admission (`admitQueuedDocument`) so a live upload shows the document immediately (was previously only reachable via fixtures/coercion). The vault list is scoped to the case (owner ∈ case applicants ∪ joint) so a second case never leaks documents.
  - DEFERRED (documented, not faked): the vault is bound to the seeded preview case `c417`; a case-picker is P5 follow-up T027. The QUEUED→PROCESSING→COMPLETED flip is driven by the run→side-car observer (P5 follow-up T025).
- [x] T019 det fact deep-links to highlighted quote span; syn non-color channel + confidence + confirm; collapse unmapped insights (FR-011)
  - DONE: the det-fact deep-link is WIRED in-product. DocumentVault supplies a default `onOpenSource` that opens a self-contained `SourceQuoteViewer` (role=dialog) showing the verbatim `sourceQuote` HIGHLIGHTED at its page/line locator — the trust-spine evidence, never a model summary. Syn non-color channel + confidence + Confirm + unmapped-insight collapse are wired too; the Confirm control promotes exactly the mapped fact-find field syn → det via `casesStore.confirmSynthesizedField`. Tested end to end in documentVaultWiring.test.tsx (view-source opens the viewer at the quote; Confirm flips the store field to det) + docVault.test.tsx (component-level).
  - Follow-up (not blocking, honestly noted): integrating the highlight into the generic `ArtifactViewer` so the SAME span renders inside the full-document viewer. The vault deep-link does not depend on it; it lands when ArtifactViewer grows a locator-highlight surface.
- [x] T020 G2/G3 cards decidable without opening the doc; G9 shows why blocked; typed error cards; aria-live; crm i18n keys added ×11 (FR-011)
- [x] T021 [P] Tests: vault state machine; deep-link; syn non-color; G2/G3/G9 cards; storybook stories
- [x] T022 Per-field precision report harness + nightly live-model eval scaffold e2e/lm-docintel.eval.ts (FR-013)
- [x] T023 convergenceDocintel.test.ts — kill-the-laptop byte-identical with docintel entries (SC-004); m3ContractFreeze.test.ts vs specs/004/contracts (FR-012)
- [x] T024 demo-mesh-m3.mjs (upload fixture→det+checklist→d7 conflict) + full gate run + PR into lendmind-crm w/ per-FR checklist (SC-006)

## P5 — follow-up milestone (deferred, honestly tracked)

These are the spec-sanctioned deferrals surfaced by the iter-2 final-gate review. They are NOT faked in M3; each closes a loop that needs the live model or a second case.

- [ ] T025 run→side-car observer TRIGGER (FIRST task of this milestone): turn a completed docintel run into a published `lm.docintel.extraction/1` side-car and drive `applyExtractionSidecar`, flipping the QUEUED document to PROCESSING→COMPLETED. Deferred in M3 because there is no live docintel model in the synthetic build — fabricating the trigger would fake the ≥0.95 precision claim (spec Assumptions). The projection path it feeds (`applyExtractionSidecar → applyExtraction → fold`) is already real and fully tested.
- [ ] T026 G2-confirm re-projection: on `confirmAttributionGate`, re-run `applyExtraction` for the confirmed applicant so the held fact-find fields land without a re-ingest (finding 9).
- [ ] T027 vault case-picker: replace the hardcoded `caseId="c417"` preview binding in `src/routers/index.tsx` with a real case selector (finding 8).
- [ ] T028 value↔quote heuristic for TEXT facts: extend the money-only value↔quote relate check to non-money text facts so a fabricated value paired with an unrelated genuine quote cannot earn `det` on a text field (finding 5). The income-specific corridor is already closed in M3 (money-semantic fields floor to syn on parse-fail; G9 counts only det money).
- [ ] T029 ArtifactViewer locator-highlight: render the same highlighted quote span inside the generic full-document `ArtifactViewer` (finding 10 / T019 follow-up). The vault deep-link does not depend on it.

## Deps

P1 blocks all; T007 red-team is a hard gate before real extraction ships. P2 after T002/T005/T011-dep. P3 after T014-dep on T011. P4 after P2/P3. US2/US3 vault parallel after P2.

## MVP

P1+P2 (extract det with verified quote, idempotent, red-team green) = the "drop a payslip, fact-find fills" core; conflict + vault follow.
