---
description: "Tasks — mesh-m3-docintel (M3)"
---
# Tasks: mesh-m3-docintel
Additive under src/crm/agents, src/crm/ui, resources/lm-skills/lm-docintel, test/unit/crm, docs; named mods: src/crm/domain/types.ts (DocInsight +locator, flip src default — additive), the M2 thin surface for the vault tab. src/api/aion/v1/** + M1/M2 contracts frozen. Branch feature/mesh-m3-docintel from lendmind-crm; PR to lendmind-crm. Synthetic fixtures only — no real PII.

## P1 — ingest + skill + guardrails
- [ ] T001 Baseline gates green on lendmind-crm (record)
- [ ] T002 DocInsight +locator field; flip `src ?? 'det'` → unverified defaults to `syn` (FR-004); additive, no schema bump
- [ ] T003 Ingest seam: FileAttachment → uploadAttachment(projectId) → artifact_id → directive.inputs.artifacts[] → submitCommand (FR-001)
- [ ] T004 lm-docintel skill scaffold (no send path) + closed `lm.docintel.extraction/1` schema per contracts (FR-002/009)
- [ ] T005 Side-car apply: extraction → case-log field-change/document-upsert/checklist-status entries w/ origin.artifactId (never feed extraction kind to fold) (FR-002)
- [ ] T006 derivedId() pure fn(documentId,contentHash,fieldKey); re-process idempotent (FR-003)
- [ ] T007 Write-path red-team harness (fixture bytes + stubbed model): assert no false-det, no attribution-leak, no conflict-suppression, no outbound — hard CI gate (FR-009)
- [ ] T008 docs/dpia-docintel.md (Art 6(1)(b), processor+inference location, Art 9, Art 13(2)(f), Art 22, per-docType retention) (FR-010/014)
- [ ] T009 [P] Tests: ingest round-trip → folded entry; idempotent re-process; classifySrc det/syn

## P2 — classify + extract + attribute (G2)
- [ ] T010 Classification (payslip/P60/passport/contract/statement/gift/accounts); out-of-scope ⇒ quarantine (FR-005)
- [ ] T011 extractionApply.ts: coded substring match of quote vs born-digital text ⇒ det, else/vision-only ⇒ syn (FR-004)
- [ ] T012 attribution.ts: deterministic name/NI/address cluster; <0.85 or joint ⇒ G2; special-category ⇒ flag (FR-006/010)
- [ ] T013 [P] Tests: extract det with verified quote (c417 payslips); vision-only ⇒ syn; G2 fires on ambiguous; special-category flagged

## P3 — conflict (G3) + checklist + G9
- [ ] T014 conflicts.ts: deterministic Pence recompute at 1% materiality ⇒ conflict-upsert + G3 + stream (never LLM) (FR-007)
- [ ] T015 Checklist reconcile (received/partial) from extraction (FR-005)
- [ ] T016 incomeGate.ts: G9 blocks recommendation until income det-verified; syn income never satisfies; surfaces blocking field (FR-008)
- [ ] T017 [P] Tests: d7 £38,500/£37,300 fires G3 deterministically; resolution logged; refold byte-identical (SC-002/004); G9 blocks on syn income

## P4 — doc vault surface + polish
- [ ] T018 DocVault.tsx + DocCard QUEUED→PROCESSING→COMPLETED; upload dropzone (reuse InputBox/attachments); vault tab on the M2 surface (FR-011)
- [ ] T019 det fact deep-links to highlighted quote span in ArtifactViewer; syn non-color channel + confidence + confirm; collapse unmapped insights (FR-011)
- [ ] T020 G2/G3 cards decidable without opening the doc; G9 shows why blocked; typed error cards; aria-live; crm i18n keys added ×11 (FR-011)
- [ ] T021 [P] Tests: vault state machine; deep-link; syn non-color; G2/G3/G9 cards; storybook stories
- [ ] T022 Per-field precision report harness + nightly live-model eval scaffold e2e/lm-docintel.eval.ts (FR-013)
- [ ] T023 convergenceDocintel.test.ts — kill-the-laptop byte-identical with docintel entries (SC-004); m3ContractFreeze.test.ts vs specs/004/contracts (FR-012)
- [ ] T024 demo-mesh-m3.mjs (upload fixture→det+checklist→d7 conflict) + full gate run + PR into lendmind-crm w/ per-FR checklist (SC-006)

## Deps
P1 blocks all; T007 red-team is a hard gate before real extraction ships. P2 after T002/T005/T011-dep. P3 after T014-dep on T011. P4 after P2/P3. US2/US3 vault parallel after P2.
## MVP
P1+P2 (extract det with verified quote, idempotent, red-team green) = the "drop a payslip, fact-find fills" core; conflict + vault follow.
