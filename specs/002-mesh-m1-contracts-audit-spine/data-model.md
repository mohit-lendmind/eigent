# Data Model: mesh-m1-contracts-audit-spine

Phase 1 output. Types are normative in `contracts/*.d.ts` (frozen surface, FR-006); this file explains entities, invariants, and state transitions. All ids reuse F01 alias conventions (`CaseId`, etc.); all timestamps are `EpochMs`; all sequences are decimal strings compared via BigInt.

## DirectiveEnvelope (`lm.directive/1`)
One agent invocation. Fields: `kind`, `agent` (open set over `lm-onboarding|lm-watcher|lm-docintel|lm-sourcing|lm-criteria|lm-affordability|lm-comms|lm-admin`), `caseId`, `firmId`, `directive`, `inputs {factFindDigest?, artifacts[]}`, `constraints` (bag), `issuedBy {kind: 'adviser'|'watcher'|'schedule', id}`, `gatePolicy`, `traceId`, `attemptNonce`, `versions {model, promptSha, skillSemver, skillSha}`, `budgetMicroGbp`.
**Invariants**: identity = sha256(canonical envelope) — nonce inside, so re-issue with a new nonce is a new command; decode rejects missing required strings with `ContractDecodeError`.

## CaseLogEntry (`lm.caselog/1`)
The unit of audit. Fields: `kind`, `caseId`, `firmId`, `seq` (per-case, monotonic, decimal string), `at`, `actor {kind: 'adviser'|'agent'|'watcher'|'schedule'|'system', id}`, `event` (union below), `origin {artifactId, runId}`, `versions`, `prevHash`, `hash`.
**Event union** (each mirrors an F01 write path): `field-change`, `activity`, `stream-entry`, `worklist-upsert`, `worklist-resolve`, `conflict-upsert`, `conflict-resolve`, `checklist-status`, `stage-transition`, `case-upsert`, `client-upsert`, `document-upsert`, **`chain-anchor`** (reserved; fold = chain re-base no-op). Unknown member → quarantine.
**Invariants**: `hash = sha256HexCanonical(entry − {hash})`; `prevHash` = predecessor's `hash` (`'genesis'` for seq 1); settleHash = `sha256HexCanonical(entry − {seq, prevHash, hash})`.
**State transitions**: entries are immutable; the only "transition" is applied (watermark ≥ seq) / pending (buffered) / quarantined (pointer).

## AgentArtifact kinds
`lm.onboarding.request/1`, `lm.watcher.decision/1`, `lm.docintel.extraction/1`, `lm.sourcing.snapshot/1`, `lm.criteria.verdicts/1`, `lm.affordability.model/1`, `lm.comms.draft/1`, `lm.admin.chase/1`, `lm.failure/1`. Each: typed payload + `versions` + `traceId`. `classifyKind(kind)` → `{family, major}`; major > known → quarantine route.

## GateDescriptor (registry entry, G1–G10)
`id`, `name`, `approver: 'adviser'|'delegate-ok'|'network-supervisor'`, `regulated: boolean`, `batchable: boolean`, `autoDisarmFlags: string[]`, `basis` (regulatory citation), `tier: 1|2|3`, `slaMinutes: number`. Pure data; `GATE_REGISTRY` is the only export M2 cards need (SC-005).

## FirmConfig (`lm/config.json`)
`firmId`, `adapters {sourcing: 'mse'|'mortgage-brain'|…}`, `lenderPanel[]`, `feeModel`, `disclosureTextRefs`, `chaseCadences`, `delegationRoster[]`, `quietHours`, `breaker {maxInvocationsPerCaseHour}`, `budgets {watcherPassMicroGbp, caseMicroGbp}`. Decode fills documented defaults per field.

## EventLogStore state (persisted, `crm-eventlog-store` v1)
- `storageEnvironmentKey` (house convention, first field)
- `contractsVersion: number` — build's contracts version at last fold (T4 refold trigger)
- `watermarks: Record<CaseId, string>` — DERIVED (wiped on env change)
- `pendingByCase: Record<CaseId, CaseLogEntry[]>` — DERIVED, NOT persisted (partialize excludes)
- `quarantine: QuarantineRecord[]` — DERIVED pointer records, capped N=200
- `quarantineTombstones: {hash, kind, at}[]` — PERMANENT (survive eviction)
- `quarantineEverCount: number` — cumulative, monotonic
- `outbox: OutboxRecord[]` — SOURCE (survives env wipe; never evicted unflushed)
- `anomalies: Record<CaseId, {duplicateSeq: number, oversize: number}>`
- `freshness: Record<CaseId, {lastFoldedAt: EpochMs, sourceStatus: 'never'|'live'|'stale'|'failed'|'no-project'}>`
- `haltedCases: Record<CaseId, {reasonCode, atSeq}>`

**QuarantineRecord**: `id ('quarantine' prefix)`, `caseId?`, `artifactId`, `artifactVersion`, `contentHash`, `reasonCode`, `kindSeen`, `preview` (≤ 16 KB), `at`.
**OutboxRecord**: `id ('outbox' prefix)`, `caseId`, `entryCandidate` (CaseLogEntry − writer fields), `settleHash`, `state: 'queued'|'flushed'|'settled'`, `queuedAt`, `flushedAt?`, `settledAt?`. Transitions: queued → flushed (attachment POST ok) → settled (echo folds, matched by settleHash). Duplicate echo on settled → no-op. Quota block: refuse enqueue synchronously (typed refusal), raise `OUTBOX_QUOTA` item.

## Worklist reason codes (T5)
`FOLD_GAP`, `CHAIN_BREAK`, `QUARANTINE_UNKNOWN_MAJOR`, `OUTBOX_QUOTA`, `DUPLICATE_SEQ`, `ENTRY_TOO_LARGE`. Item id = `wl_fold_<caseId>_<reasonCode>_<seq|'-'>` (stable → upsert dedup). WorklistItem gains additive optional `reasonCode?`, `reasonParams?`.

## CaseFileExport v2
Envelope: `exportVersion: 2`, `exportedAt`, `crmSchemaVersion`, `contractsVersion`, `caseId`, `firmId`, `chainHead {seq, hash}`, `chainVerified: boolean`, `artifactManifest [{name, artifactId, version, sha256}]`, `gatePolicySnapshot {registry, delegationRoster}`, `versionsStamp`.
Records: v1 records + `caseLogEntries[]`, `outboxUnflushed[]`, `quarantine[]`, `quarantineTombstones[]`.
Import: `exportVersion 1` → integrity `null` ("not verifiable"); `2` → verify chain before accepting `chainVerified: true`.

## F01 additive changes (no schema bump)
- `Case.aionProjectId?: string`
- `ActivityEvent.origin?: Origin`
- `WorklistItem.reasonCode?`, `WorklistItem.reasonParams?`
- `CrmIdPrefix` += `'outbox' | 'quarantine'`
