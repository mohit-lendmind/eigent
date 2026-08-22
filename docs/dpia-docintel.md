# DPIA — Document Intelligence (M3 `mesh-m3-docintel`)

_Data Protection Impact Assessment for the docintel agent + doc vault.
Deliverable for FR-010 / FR-014 / SC-006. This artifact MUST be checked in
before any real-PII processing is switched on (FR-014). Until the data-residency
decision below is signed off, the pipeline runs on **synthetic / redacted
fixtures only** — every claim in this repo is reproduced with
`node scripts/demo-mesh-m3.mjs` against synthetic data._

## 1. What the processing is

A UK mortgage brokerage uploads a client's supporting documents — payslips, P60s,
passports, employment contracts, bank statements, gift letters, sets of accounts
— to a case. The docintel agent **reads one document at a time**, classifies it,
extracts typed facts (each backed by a verbatim quote + page locator),
attributes it to an applicant, and records the facts on the tamper-evident case
log as reviewable field-changes. It **dispatches nothing and sends nothing** —
there is no outbound path in the agent, enforced by construction and asserted by
the write-path red team (`test/unit/crm/redteamWrite.test.ts`, T007).

## 2. Lawful basis (UK GDPR Art 6)

- **Art 6(1)(b) — performance of a contract.** The client has engaged the firm to
  source and advise on a mortgage; verifying income, identity and deposit from
  supporting documents is necessary to perform that mortgage-advice contract
  (MCOB 11.6.8R affordability evidence). This is the primary basis for the
  ordinary personal data on these documents.
- **Art 6(1)(c) / (f) — legal obligation & legitimate interests** support the
  identity and anti-money-laundering checks (MLR 2017) that ride on the same
  documents.

No processing relies on consent as its Art 6 basis, so a withdrawal of consent
does not strand a live application; special-category handling is addressed
separately in §4.

## 3. Processor & inference location (data residency — OPEN DECISION)

- The model that reads the document is a **processor** acting on the firm's
  instructions. The document content is treated strictly as **data, never as
  instructions** (prompt-injection doctrine, carried in both the skill body and
  the directive envelope, and proven inert at the write path by T007).
- **Inference location is the open residency decision.** Until the firm signs off
  where inference runs (UK/EEA region vs. an adequacy/SCC transfer), real client
  documents MUST NOT be sent to the model. The build and all published precision
  numbers are produced on synthetic/redacted fixtures (FR-014). This DPIA is the
  gate: flip real-PII processing on only after the residency decision is recorded
  here with the region, the transfer mechanism, and the processor DPA reference.

## 4. Special-category data (Art 9)

Bank statements in particular can reveal Art 9 data incidentally — pharmacy or
health debits, place-of-worship or political donations, trade-union subscriptions.

- The agent **flags** special-category data (`specialCategoryFlagged: true`); it
  does **not** silently fold it into ordinary fields (FR-010). The write path
  raises a system activity note and holds the finding for human review rather
  than extracting it as a fact.
- Where Art 9 data is genuinely needed it rests on **Art 9(2)(a) explicit
  consent** or **Art 9(2)(f) legal claims**, recorded case-by-case by the
  adviser — never inferred or assumed by the agent.
- An **out-of-scope document type** (anything outside the classified set this
  DPIA covers) is **quarantined**, not processed: no fields are extracted and the
  document is marked `REJECTED` in the vault.

## 5. Transparency (Art 13(2)(f)) & automated decisions (Art 22)

- **Art 13(2)(f) — meaningful information about the logic.** Every extracted fact
  carries its **verbatim quote + page locator** and a **`det`/`syn` trust
  marker**: `det` only when the quote is a coded, character-exact substring of the
  document's born-digital text layer; vision-only or unmatched facts are `syn`.
  The provenance is shown to the adviser (and is disclosable to the client) so the
  logic of every recorded fact is inspectable, not a black box.
- **Art 22 — no solely-automated decision with legal/significant effect.** The
  agent never decides suitability, never satisfies a gate, and never sends. Income
  verification cannot be auto-satisfied: a `syn` income fact never satisfies **G9**
  (income verification before any recommendation), and any cross-document
  disagreement raises **G3** for a human to resolve. Ambiguous attribution
  (< 0.85 confidence or a joint document) raises **G2**. A qualified human adviser
  is always the decision-maker; the agent only assembles reviewable evidence.

## 6. Retention (per document type)

| Document type | Retention of raw bytes | Retention of extracted evidence |
|---|---|---|
| Passport / identity | **5 years** after end of business relationship (MLR 2017 reg. 40) | located line + quote retained for re-verification |
| Bank statement | **crypto-erase raw bytes once the fact is `det`-verified**; do not hold the full statement longer than needed | located line + `det` quote retained; Art 9 flags reviewed then dropped if not needed |
| Payslip / P60 | erase raw bytes once income is `det`-verified against the record | located line + quote retained for the suitability file |
| Employment contract / accounts | retained for the life of the advice file (suitability evidence) | quote + locator retained |
| Gift letter | retained for the life of the advice file (deposit provenance) | quote + locator retained |
| Out-of-scope (quarantined) | not processed; raw bytes purged on the standard inbox cycle | none extracted |

The **located line is retained for re-verification** even after the raw document
is crypto-erased, so a `det` fact stays auditable without keeping the whole PII
payload (FR-010).

## 7. Residual risk & controls

| Risk | Control |
|---|---|
| A forged `det` inflates unverified income | Trust marker is **recomputed** from the independent text layer on the write path; the model's own `src` is never trusted (T007 "no false-det"). |
| A fact is written to the wrong applicant | Ambiguous attribution writes **no** applicant field and raises **G2** (T007 "no attribution-leak"). |
| A document silently overwrites a value on file | Material disagreement (≥1%) raises **G3** and never overwrites — record-never-repair (T007 "no conflict-suppression"). |
| Prompt injection in a document | Content is data, not instructions; there is no outbound path to reach (T007 "no outbound"). |
| Real PII leaves the jurisdiction | **Blocked** until §3 residency decision is signed off; build runs on synthetic fixtures only (FR-014). |

## 8. Sign-off

- [ ] Data-residency / inference-location decision recorded in §3 (region,
      transfer mechanism, processor DPA ref) — **required before real-PII
      processing.**
- [ ] DPO review of Art 9 flagging and retention schedule (§4, §6).
- [ ] SIRO / firm principal approval to switch from synthetic to live data.

_Until all three boxes are ticked, docintel processes synthetic/redacted
fixtures only._
