# Data Model: mesh-m2-watcher-onboarding

Additive to M1. Types normative in `contracts/*.d.ts`.

## FirmConfig additions (additive optional; M1 firmConfig stays frozen for existing fields)
- `fxUsdPerGbpMicro?: number` — static FX for budget conversion.
- `fxEffectiveDate?: string` — ISO date stamped onto spend records.
- `coordinatorProjectId?: string` — the watcher's firm coordinator project.

## CaseIndexPointer (new artifact `lm/firm/<firmId>/case/<caseId>.json`)
`{ caseId, aionProjectId, stage, logHeadSeq (decimal string), updatedAt, firmId }` — one append-only pointer artifact per case, desktop-published. The watcher enumerates the set; "latest per caseId" derived at read time.

## WatcherDecisionPayload (inside `lm.watcher.decision/1`, already a known kind)
`{ passId, caseId, kind ('propose-transition'|'chase'|'retention-open'|…), directive?: DirectiveEnvelope (dispatch-ready, unset in M2 for propose-only but shaped), reason: ReasoningTrace, worklistItemId }`. The `directive` field is the M3 seam — populated later, shape frozen now.

## SpendRecord (supervision)
`{ passId, caseId?, runId, costMicroUsd (bigint-string), fxUsdPerGbpMicro, fxEffectiveDate, costMicroGbp (derived), providerCalls, at }` — FX basis stamped so history never reprices.

## QueueRow (UI model, derived — not persisted)
`{ id, kind, source: 'gate'|'worklist'|'fold', tone, title, meta, sla?: {dueAt, tier}, freshness: 'live'|'as-of'|'stale', gate?: GateDescriptor, caseId }`. Sort key: SLA asc → tier asc → age desc. Gates pinned above non-gates.

## GateCardProps (frozen surface)
Renders from `GATE_REGISTRY` + a pending approval: `{ gate: GateDescriptor, draft?: {full: string, editable: true}, provenance?: {disclosureRef, reasons[]}, onApprove, onEdit }`. G1 requires `draft` + `provenance`.

## i18n
New `crm` namespace: `src/i18n/locales/<locale>/crm.json` ×11, registered in each `index.ts`. Keys kebab-case; English placeholders pass parity.

## Additive domain
`WorklistItem` already has `reasonCode?`/`reasonParams?` (M1). No schema bump. New id prefixes if needed via `CrmIdPrefix` (e.g. `'pass'`).
