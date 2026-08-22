# Compliance / DPO perspective on mesh-m3-docintel

## What I support
- No-send-path + content-is-data + zero-tolerance red-team gate — correct baseline.
- Quote-locator → `syn` fallback: sound accuracy control (Art 5(1)(d)).
- DPIA as a hard ship gate; G9 human veto on income before recommendation.

## What I want changed (Dissent:)
- **Dissent: DPIA scope is unstated, and "no external tool access — documents are files" hides that the vision/OCR model IS the processor.** Off-device inference makes passports + bank statements a restricted international transfer needing an IDTA/UK Addendum (Art 44–49). DPIA must name: the Art 6(1)(b) basis; incidental Art 9 special-category from bank statements (pharmacy, donations) with a Sch.1 DPA 2018 condition; Art 13(2)(f) AI disclosure; Art 22 non-automated confirmation.
- **Dissent: ≥0.95 aggregate det-precision is the wrong metric.** Publish per-field precision — income above all. Quote-locator proves the value is *in* the doc, not that it's *right* (gross vs net, YTD vs monthly). One-in-twenty wrong income `det` is an affordability breach (MCOB 11.6.8R); income stays adviser-confirmed at G9 regardless.
- **Dissent: the injection doctrine guards the send path, not the write path.** The residual surface is the fold: a crafted doc forging a quote+locator to plant a false `det`, or steering attribution to leak applicant A's PII into B's record. Red-team must target write/attribution/conflict-suppression, not just exfil; output must be a closed typed schema — insights only, never directives.

## What I would not ship without
- A per-`docType` retention schedule as data: passport 5yr post-relationship (MLR 2017 reg 40); advice records to the MCOB floor. Resolve the storage-limitation tension (Art 5(1)(e)): quote-locator re-verification needs the source, which fights erasure — store the located line, crypto-erase the raw statement once `det`.
- Transfer mechanism confirmed before any real doc reaches the model.
- Signed DPIA, residual risk accepted by the named SMF (§8.3), as the ship gate.

## Acceptance criteria from my lens
- DPIA present, names processor/location/transfer basis, SMF-signed; ship blocked otherwise.
- Per-field precision report; income ≥ target AND G9-confirmed.
- Red-team includes write-path + cross-attribution injection; zero compromise.
- Retention + Art 17 erasure per `docType`; SAR export reproduces source + locator.

## Edge cases I want addressed
- Special-category data detected → flag, not silent extraction.
- Third-party PII in a bank statement (named payees) → minimise, never stored as a subject.
- Cross-applicant mis-attribution is a confidentiality breach — is 0.85 high enough here?
- A `syn` income field must never satisfy G9.
- A `docType` outside DPIA scope → quarantine, not process.
