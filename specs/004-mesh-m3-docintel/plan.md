# Implementation Plan: mesh-m3-docintel
**Branch**: lendmind-crm (impl feature/mesh-m3-docintel) · 2026-08-22 · [spec.md](spec.md)
## Summary
A3 docintel + doc vault. Rides M2 dispatch + M1 fold; extraction is a side-car artifact, state deltas are case-log entries with origin.artifactId. Deterministic conflict/attribution; coded quote-locator vs born-digital text; content-derived idempotent ids. Synthetic-only build; real PII residency-gated. No new deps; aion client + M1/M2 contracts frozen.
## Technical Context
TS 5.x; deps none added (reuse attachments plane, ArtifactViewer, F01 conflict model, M2 dispatch); vitest + storybook; write-path red-team = fixture bytes + stubbed model (no live model/network in CI), live-model evals nightly; per-field F1. Constraints: born-digital text is the det substring source; vision-only ⇒ syn; DPIA checked in; synthetic fixtures only.
## Constitution Check
Unfilled template. Gates: no-new-deps ✓ · frozen contracts ✓ · determinism preserves refold ✓ · design-token/i18n/baseline ✓ · residency: synthetic-only ✓. No violations.
## Structure
src/crm/agents/{docintel,extractionApply,attribution,conflicts,incomeGate}.ts · docIngest seam in dispatch path · src/crm/ui/DocVault.tsx (+DocCard, deep-link to ArtifactViewer span) · resources/lm-skills/lm-docintel/ · src/crm/domain/types.ts (DocInsight +locator, additive) · test/unit/crm/{docintel*,redteamWrite,convergenceDocintel}.test.ts · e2e/lm-docintel.eval.ts (nightly) · docs/dpia-docintel.md · specs/004-*/contracts/*.d.ts
## Phase ordering
P1 ingest seam + skill scaffold + write-path red-team harness + DPIA + closed extraction schema (FR-001/002/009/010/014). P2 classify+extract+deterministic attribution G2 + coded quote-locator (FR-004/005/006). P3 deterministic conflict G3 + checklist + G9 income gate (FR-007/008). P4 doc vault surface + per-field precision + demo + gates (FR-011/012/013/015).
