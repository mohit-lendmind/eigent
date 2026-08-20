# Phase 1 Data Model — crm-domain-core

**Feature**: F01 `crm-domain-core` · **Branch**: `lendmind-crm`

Scope: entities, fields, cross-entity references, invariants, and state transitions for the pure typed CRM domain layer. Field-level types are documented at contract-level in `contracts/stores.d.ts`; this document is the authoritative narrative source and links to spec FR numbers rather than restating them.

Every stored record carries `schemaVersion: number` stamped `CRM_SCHEMA_VERSION = 1` (spec FR-003). Every entity that could be produced by a later agent-ingest pipeline (F07) carries `origin?: { artifactId: string; runId: string }` (spec FR-002).

---

## 1. Store partitioning

Four persisted zustand stores, one envelope key each. One-directional import graph (spec FR-014):

| Store | Persist key | Owns | May read (via `.getState()`) |
|---|---|---|---|
| `clientsStore` | `crm-clients-store` | `Client`, placeholder clients | — |
| `casesStore` | `crm-cases-store` | `Case`, `Applicant` (join), `FactFindField`, `FactFindSection`, `CaseProperty`, `Deposit`, `Requirement`, `Affordability`, `CriterionCheck`, `Product`, `ConflictRecord`, `ComplianceRecord` | `clientsStore` |
| `documentsStore` | `crm-documents-store` | `CrmDocument`, `DocInsight`, `DocChecklistItem` | `clientsStore`, `casesStore` |
| `workstreamStore` | `crm-workstream-store` | `WorklistItem`, `StreamEntry`, `ActivityEvent`, `RetentionEntry`, `FieldChangeEvent`, `RepairReport` (last) | all three |

Envelope version constants: `CRM_CLIENTS_PERSIST_VERSION`, `CRM_CASES_PERSIST_VERSION`, `CRM_DOCUMENTS_PERSIST_VERSION`, `CRM_WORKSTREAM_PERSIST_VERSION` — each starts at `1` and bumps independently of `CRM_SCHEMA_VERSION` and of each other (spec FR-012).

---

## 2. Core entities

### 2.1 Client (in `clientsStore`)
Durable person identity across many cases.

Fields: `id, ref, firstName, lastName, initials, tint, textCls, role?, email?, phone?, cases: string[], since, schemaVersion, repaired?, ownershipHint?, origin?`.

**Invariants**:
- `id` matches `/^client_/` (spec FR-011 id-minting rule).
- `tint` is a semantic tone key, never a hex/rgb/tailwind color (spec FR-045 / design-token gate).
- `cases[]` is a back-reference maintained by `noteClientCase(clientId, caseId)` (spec FR-017); duplicates never appear.
- `repaired: true` only ever set by the integrity-repair placeholder pass (spec FR-036 pass #1); such clients are flagged for downstream selectors to render distinctly and refuse billing (spec FR-038).

### 2.2 Case (in `casesStore`)
One advised transaction.

Fields: `id, ref, type, kind, label, stage: Stage, completeness, updated, applicants: Applicant[], property: CaseProperty, deposit: Deposit, requirement: Requirement, affordability: Affordability, retention?: {reason, daysLeft}, ownership?: {adviserId, firmId, networkId}, schemaVersion, origin?`.

**Invariants**:
- `stage` ∈ `{LEAD, FACT_FIND, SOURCING, DIP, APPLICATION, VALUATION, OFFER, COMPLETION}` (spec FR-008).
- `completeness` ∈ `[0, 1]`; recomputed after every fact-find mutation and after every integrity-repair pass touching the case (spec FR-007, FR-036 pass #5).
- `ownership?` is a **single optional object** (spec FR-022, trade-off #3); when absent, the case is unassigned; when present at seed time, values are `{adviserId:'adviser_eleanor_vance', firmId:'firm_meridian_mortgages', networkId:'network_stonebridge'}`.
- Every `Applicant.clientId` MUST resolve to either a real client or a repair-inserted placeholder (spec FR-036 pass #1); pure selectors use `ensureClient()` (spec FR-038) so they never throw on dangling refs.

### 2.3 Applicant (join, in `casesStore` as `Case.applicants[]`)
Fields: `clientId, role: 'primary'|'secondary'|'sole', profile: {[section]: FactFindSection}, completeness`.

Section keys: `personal, contact, address, employment, income, expenditure, credit` (spec FR-006 — the enumerated field keys per section per applicant category live in `src/crm/domain/factFindSchema.ts` as `as const` tuples).

### 2.4 FactFindField (nested inside `FactFindSection.fields`, in `casesStore`)
Fields: `k, label, value: FieldValue, src: 'det'|'syn', hint?, flag?, conflictId?, mono?, confirmedAt?, confirmedBy?, origin?`.

`FieldValue` is a **discriminated union keyed by `t`** (spec FR-004):
- `{t:'text', v: string}`
- `{t:'select', v: string, options?: string[]}`
- `{t:'date', v: string /* ISO YYYY-MM-DD */}`
- `{t:'number', v: number}`
- `{t:'money', v: Pence}`
- `{t:'toggle', v: boolean}`

**Invariants**:
- `src: 'det'` = deterministic (verbatim from a document); `src: 'syn'` = synthesized (AI-inferred, needs review).
- `conflictId?` references a `ConflictRecord.id`; the field is **never simultaneously** marked with a boolean `conflict:true` (spec FR-033).
- Money values NEVER appear as display strings; `parseGbp()` is the only path from input to storage (spec FR-004, FR-010).
- `confirmedAt` / `confirmedBy` are only set by `confirmSynthesizedField` (spec FR-019), which also flips `src: 'syn' → 'det'`.

### 2.5 FactFindSection (in `casesStore`)
Fields: `completeness: number, fields: FactFindField[]`.

**Invariants**: `completeness` is a pure function of `fields` and the required-key tuple for that (section, applicant-category); computed by `computeSectionCompleteness(section, requiredKeys)` (spec FR-007).

### 2.6 CrmDocument (in `documentsStore`)
Fields: `id, owner: ClientId | 'joint', name, type, status: 'PROCESSING'|'COMPLETED', size, when, iconTone, attribution: number | null, joint?, confirmedAt?, confirmedBy?, insights: DocInsight[], schemaVersion, origin?`.

State transitions:
- `PROCESSING` → `COMPLETED` via `completeDocument(id, {type, attribution, insights})` (spec FR-023).
- `attribution: null` allowed only while `status: 'PROCESSING'`.
- `confirmedAt` set only by `confirmAttribution` (spec FR-024).

### 2.7 DocInsight (nested inside `CrmDocument.insights[]`)
Fields: `id, label, value, conf: number /* [0, 1] */, good?, flag?, conflict?, sourceQuote?, origin?`.

**Invariant**: `conflict:true` on an insight is a display hint; the source-of-truth relationship is `FactFindField.conflictId → ConflictRecord` (spec FR-033).

### 2.8 DocChecklistItem (in `documentsStore`, per-owner)
Fields: `owner: ClientId | 'joint', itemKey, status: 'received'|'pending'|'partial'|'requested', note?`.

Updated only by `setChecklistStatus` (spec FR-025).

### 2.9 WorklistItem (in `workstreamStore`)
Fields: `id, caseId, kind: WorklistKind, title, detail, cta, tab, auto?, status: 'open'|'resolved', createdAt, resolvedAt?, resolvedBy?, resolution?, linkedConflictId?, linkedDocId?, origin?, schemaVersion`.

State transitions:
- `open` → `resolved` via `resolveWorklistItem(id, {resolution, resolvedBy})` — the item is **never deleted** (spec FR-027, trade-off — worklist is an audit surface).
- The state machine has no `open → open` self-transition; a second call to `resolveWorklistItem` on an already-resolved item is a no-op.

### 2.10 StreamEntry (in `workstreamStore`)
Fields: `id, caseId, kind: StreamKind, iconTone, when, title, body?, cta?, actions?, pulse?, pinned?, trace?: ReasoningTrace, schemaVersion, origin?`.

`StreamKind` includes at minimum: `live, intent, approval, conflict, external, done, blocked, activity, directive` (spec FR-020, FR-030; §3.22 of the design reference is authoritative for the full list — implementers work from the reference).

**Cap invariant (spec FR-030)**: on `pushStreamEntry`, if adding the entry would push a case above `STREAM_ENTRIES_PER_CASE_CAP = 200`:
1. Enumerate eviction-eligible entries: kinds `done`, `external`, `activity` **whose linked worklist item (if any) has `status:'resolved'`**.
2. Evict the oldest eligible entry.
3. Insert a synthetic marker `{kind:'done', id:'stream_trunc_<n>', title:'Older activity truncated', body:'<count> older entries evicted at cap.', truncatedBefore: <ts>, truncatedCount: <n>}` at the eviction point.
4. If no eligible entries exist (all unresolved), append the new entry and do NOT evict — the cap is a soft ceiling in that case, and unresolved `conflict` / `approval` entries are never evicted regardless of age.

### 2.11 ReasoningTrace (nested inside `StreamEntry.trace?`)
Fields: `claim, subject?, working: string[] /* numbered */, evidence: EvidenceCitation[], alternatives?: {option, reason, rejected?}[], confidence: number /* [0, 1] */, calibration?: string`.

Full trace is **preserved verbatim** on `pushStreamEntry` (spec FR-028); never truncated, summarized, or mutated post-write.

### 2.12 EvidenceCitation (nested inside `ReasoningTrace.evidence[]`)
Fields: `kind: 'criteria'|'field'|'document'|'policy'|'calc', label, value?, source? /* e.g. 'Halifax criteria § 4.2 v24.6' */, quote? /* verbatim */, note?`.

### 2.13 ActivityEvent (in `workstreamStore`, per-case)
Passive log distinct from stream entries. Appended by `noteActivity(caseId, activity)` (spec FR-029) and by the integrity repair for state-mutating passes (spec FR-037).

### 2.14 CriterionCheck (in `casesStore`)
Fields: `id, caseId, group: 'lending'|'affordability', cat, label, status: 'pass'|'warning'|'info', reasoning, impacts?: {lender, status, note}[], schemaVersion, origin?`.

### 2.15 Product (in `casesStore`)
Fields: `id, caseId, lender, product, rate, type, fee, monthly, ltv, total, status: 'pass'|'fail', recommended?, notes, apr, rationale?, criteriaTrail?: string[], rejectReason?, rejectCriterion?, failOn?, universe: '2yr'|'5yr', origin?, schemaVersion`.

**Invariant**: every `status: 'fail'` row MUST carry `rejectReason`, `rejectCriterion` (e.g. `'Skipton § 3.1 Employment tenure'`), and `failOn` (spec FR-044 acceptance scenario 6). Every `status: 'pass'` row MUST carry a non-empty `rationale` and `criteriaTrail`.

### 2.16 RetentionEntry (in `workstreamStore`)
Fields: `clientId, ref, endsAt, daysLeft, lender, rate, status: 'case-open'|'due'|'horizon', schemaVersion`.

Updated by `upsertRetention` keyed by `(clientId, endsAt)` (spec FR-031). Urgency selector uses `<90 days = urgent` (spec FR-042 `selectRetentionUrgency`).

### 2.17 ConflictRecord (in `casesStore`)
Fields: `id, caseId, clientId, section, fieldKey, values: ConflictValue[], detectedAt, detectedBy?, resolvedAt?, resolvedBy?, resolution?, origin?, schemaVersion`.

`ConflictValue`: `{value: FieldValue, source: {kind:'document'|'manual'|'insight', docId?, insightLabel?, quote?}, confidence?}`.

**Invariants (spec FR-032, FR-033)**:
- Composite address `(caseId, clientId, section, fieldKey)` is the resolution key — one **open** conflict per address at a time.
- `values[]` array is **never truncated**; both original competing values are preserved for the life of the case even after resolution.
- `ConflictRecord`s live in the cases store (not workstream), so they are exempt from the stream cap.
- The field-side reference is `FactFindField.conflictId?: string`, not a boolean.

State transitions: `open` (`resolvedAt` absent) → `resolved` (`resolvedAt`, `resolvedBy`, `resolution` present) via `resolveConflict()` (spec FR-020). `resolveConflict()` on an already-resolved id is idempotent (spec User Story 2 acceptance #5).

### 2.18 FieldChangeEvent (in `workstreamStore`)
Fields: `id, caseId, clientId, section, fieldKey, priorValue: FieldValue | null, newValue: FieldValue, priorSrc: 'det'|'syn'|null, newSrc: 'det'|'syn', changedAt, changedBy, reason: 'edit'|'confirm-synthesized'|'conflict-resolution'|'seed'|'import', conflictId?, origin?, schemaVersion`.

**Invariants (spec FR-034, FR-035)**:
- Appended for **every** fact-find field mutation, without exception.
- Never mutated or deleted after append.
- Included **in full** in `CaseFileExport.records.fieldChangeEvents[]`.
- Queryable by `(caseId, clientId, section, fieldKey)` and by `caseId` alone, both in ascending `changedAt` order.

### 2.19 RepairReport (transient, last-report cached in `workstreamStore`)
Fields: `ranAt, envMismatch: boolean, placeholderClientsCreated: string[], prunedWorklist: string[], prunedStream: string[], prunedActivity: string[], retargetedDocuments: string[], recomputedCases: string[]`.

Produced by `crmIntegrityRepair()` (spec FR-036); accessible via `getLastRepairReport()` (spec FR-037). Each state-mutating pass also appends an `ActivityEvent`.

### 2.20 CaseFileExport (transient, output of `exportCaseFile`)
Fields:
```
{
  envelope: { exportVersion: 1, exportedAt, crmSchemaVersion, caseId },
  records: {
    case, clients[], applicants[], documents[], checklist,
    worklist[], stream[], activity[], criteria[], products[],
    retention[], compliance, conflicts[], fieldChangeEvents[]
  }
}
```

**Invariants (spec FR-040, FR-041)**:
- Every record touching the case is included; nothing is elided or summarized.
- `stream[]` entries carry their full `trace?` verbatim.
- `conflicts[]` include both open and resolved records with both original `values[]`.
- `fieldChangeEvents[]` include every event with matching `caseId`.
- Round-trip contract: `JSON.stringify(canonicalise(exportCaseFile(id)))` after seed → export → wipe → import → re-export is byte-equal (spec SC-003).

---

## 3. Cross-entity references (foreign-key summary)

| From | Field | To | Enforcement |
|---|---|---|---|
| `Case.applicants[].clientId` | → | `Client.id` | Repair pass #1 inserts placeholder if missing (spec FR-036) |
| `CrmDocument.owner` | → | `Client.id` \| `'joint'` | Repair pass #2 retargets to placeholder if missing |
| `WorklistItem.caseId` | → | `Case.id` | Repair pass #3 prunes orphans |
| `StreamEntry.caseId` | → | `Case.id` | Repair pass #4 prunes orphans |
| `ActivityEvent.caseId` | → | `Case.id` | Repair pass #4 prunes orphans |
| `CriterionCheck.caseId` | → | `Case.id` | Type-checked at write; no runtime repair (rare) |
| `Product.caseId` | → | `Case.id` | Type-checked at write; no runtime repair (rare) |
| `ConflictRecord.(caseId, clientId)` | → | `Case`, `Client` | Composite address invariant (spec FR-032) |
| `FactFindField.conflictId?` | → | `ConflictRecord.id` | Set / cleared atomically by `resolveConflict` (spec FR-020) |
| `WorklistItem.linkedConflictId?` | → | `ConflictRecord.id` | Set at seed; cleared status only, item retained |
| `WorklistItem.linkedDocId?` | → | `CrmDocument.id` | Optional |
| `Client.cases[]` | ↔ | `Case.applicants[].clientId` | Back-reference maintained by `noteClientCase` (spec FR-017) |
| `FieldChangeEvent.(caseId, clientId, conflictId?)` | → | `Case`, `Client`, `ConflictRecord?` | Written by `setFactFindField` / `resolveConflict` (spec FR-018, FR-020) |
| `RetentionEntry.clientId` | → | `Client.id` | Ordered by `daysLeft`; urgency filter `<90` |

---

## 4. State transitions (summary)

| Entity | From | To | Trigger | FR |
|---|---|---|---|---|
| `Case.stage` | any of the 8 stages | any (validated via `stageIndex`, `nextStage`) | `moveStage(caseId, nextStageKey)` (appends `ActivityEvent`; does not skip silently) | FR-021 |
| `CrmDocument.status` | `PROCESSING` | `COMPLETED` | `completeDocument(id, {type, attribution, insights})` | FR-023 |
| `WorklistItem.status` | `open` | `resolved` | `resolveWorklistItem(id, {resolution, resolvedBy})` (retained, never deleted) | FR-027 |
| `ConflictRecord` | open | resolved | `resolveConflict(id, {chosenValue, method, resolvedBy, reasoning?})` (atomic across three stores) | FR-020 |
| `FactFindField.src` | `syn` | `det` | `confirmSynthesizedField(...)`; also sets `confirmedAt`, `confirmedBy`; emits `FieldChangeEvent(reason:'confirm-synthesized')` | FR-019 |
| `FactFindField.value` | any | any | `setFactFindField(...)`; emits `FieldChangeEvent(reason:'edit')`; recomputes section completeness | FR-018 |
| `DocChecklistItem.status` | `received`/`pending`/`partial`/`requested` | any of the same | `setChecklistStatus(owner, itemKey, status, {note?})` | FR-025 |

**Atomicity requirement for `resolveConflict()` (spec FR-020, User Story 2)**: all seven side-effects (field mutation, conflict-record resolution, document-insight flip, worklist status change, stream-entry append with trace, `FieldChangeEvent` append, section recompute) MUST occur such that **no zustand subscriber can observe a partial state on any of the four stores**. Implementation: one `setState` call per store, invoked in the fixed order `casesStore → documentsStore → workstreamStore` (client store not touched).

---

## 5. Persist envelope shape (all four stores)

```
{
  state: { <partialize allowlist keys only> },
  version: CRM_<X>_PERSIST_VERSION,  // starts at 1
  storageEnvironmentKey: getAuthEnvironmentKey()  // re-checked in migrate
}
```

`migrate(persistedState, prevVersion)` is a **shape-repair** function (spec FR-012): drops unknown record shapes with a `console.warn` recording the id, preserves-with-defaults for known-shape records missing new fields, returns empty state if `storageEnvironmentKey` mismatches the current one (no cross-tenant bleed). `partialize` is an **explicit allowlist** — never a denylist — so newly added non-persisted state cannot accidentally leak into localStorage.

---

## 6. Fixture inventory (golden path, spec FR-044)

Faithful transcription of the design reference. Full inventory:

- **Cases**: `c417` (LM-2026-0417, first-time-buyer purchase), `c392` (LM-2026-0392, self-employed remortgage), plus 6 pipeline-only cases for stage-distribution assertions.
- **Clients**: `aisha_okafor`, `daniel_reyes`, `tom_hargreaves`; adviser fixture `adviser_eleanor_vance`.
- **Documents**: 6 total, including the joint bank statement with `attribution: 0.74` and the employment contract with `conflict:true` insight on Salary linked to a real `ConflictRecord`.
- **Checklist**: 4 aisha items, 3 daniel items, 3 joint items.
- **Worklist**: 6 items in the design's order — kinds `conflict, criteria, doc/auto, approval, doc/auto, retention`.
- **Stream (c417)**: 8 entries per §3.22 STREAM_417, with full `ReasoningTrace`s (confidences `.96, .78, .93, .85, .96, .95, .93, 1.0`), live solver entry pinned first.
- **Stream (c392)**: 2 entries per §3.22 STREAM_392.
- **Criteria checks**: 10 per §3.12, each with per-lender impacts.
- **Products**: primary 2-year universe `hx`, `nw`, `ac`, `sk`, `cov` (§3.13) + solver additions `tsb`, `barclays`, `santander`, `natwest` + `SOLVER_LENDERS_5YR` (Halifax/Nationwide/Accord).
- **Compliance record (c417)**: per §3.20 — disclosures, ID&V, AML SmartSearch, vulnerability, Consumer Duty pillars, declaration, supervision items with the gifted-deposit letter pending.
- **Retention radar**: 4 entries per §3.11.

**Fixture invariants asserted by unit tests (spec SC-001, SC-005)**:
- `selectNeedsYouCount() === 6`
- `selectPipelineCounts()` totals 8 with distribution `{LEAD:1, FACT_FIND:2, DIP:1, APPLICATION:1, VALUATION:1, OFFER:1, COMPLETION:1}` (+ `SOURCING:0`)
- `selectCaseCompleteness('c417')` ∈ `[0.895, 0.905]`
- c417 LTV = 85% (± 0.01), LTI = 2.95× (± 0.01), loan = 24_225_000 pence (£242,250), combined income = £82,100
- Tom's c392 retention entry ranked first by `selectRetentionUrgency(now = 2026-06-13)` with `daysLeft = 79`
- Every c417 sourcing `pass` row carries non-empty `rationale` and `criteriaTrail`; every `fail` row carries `rejectReason`, `rejectCriterion`, `failOn`
