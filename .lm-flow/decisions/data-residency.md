# Decision: document PII, model inference location, and data residency

**Date:** 2026-08-22 · **Status:** binding on M3 (docintel) and any milestone that sends client PII to model inference.

## Context
M3 reads payslips, passports, bank statements. The vision/OCR model that reads them **is a data processor**. "Documents are just files, no external access needed" hides that if inference runs off-device (e.g. a US-hosted aion edge), those documents become a **restricted international transfer under UK GDPR Art 44–49**, requiring an IDTA / UK Addendum, and bank statements carry incidental **Art 9 special-category** data.

## Decision
1. **Build and verify M3 tonight on synthetic + redacted fixtures only.** No real client PII touches an off-device model until the transfer basis is confirmed.
2. **Real-PII processing is gated** on: (a) confirming where model inference physically runs, and (b) an IDTA/UK Addendum if off-device. This is a founder/infra/legal input, not resolvable in code.
3. **DPIA is a ship artifact for real-PII use** — must name the Art 6(1)(b) basis, the processor + inference location, Art 9 special-category handling, Art 13(2)(f) AI disclosure, Art 22 (non-automated confirmation — the adviser gates), and per-docType retention.
4. **Data minimisation:** store the located quote line, not necessarily the whole raw document longer than needed; per-docType retention (passport 5yr MLR 2017 reg 40; advice records to the MCOB floor); crypto-erase raw bank statements once `det` fields are captured and re-verifiable from the stored line.
5. **Special-category + out-of-scope doc types are gated** (flag/quarantine, never silently extracted).

## Consequence
- M3 ships as a **dev/synthetic-verified** build tonight; the "process a real client's payslip" capability is access-gated exactly like the licensed connectors.
- The parallel to [[connector-access]] is deliberate: two of the mesh's core capabilities (connectors, doc intelligence) have real-world dependencies (credentials; data-transfer basis) that gate *live* use but not the *build*.
