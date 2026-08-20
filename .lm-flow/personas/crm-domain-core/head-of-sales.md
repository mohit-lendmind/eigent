# Head of Sales perspective on crm-domain-core

## What I support
- The golden-path fixtures ARE the demo. CASE_417 — salary conflict with resolution buttons, gift-letter chase, solver with cited rejections, compliance pane with Stonebridge supervision — is a genuine 5-minute wow for broker principals. Fixture-fidelity tests (LTV 85%, £242,250) protect that. Strongly agree.
- ReasoningTrace with evidence cites and calibrated confidence is our bake-off weapon against Smartr365/Acre ("show the working"). Agree it belongs in the domain types from day one.
- `setFactFindField` recording prior values, det/syn provenance on every field, and per-record `schemaVersion` — this is the auditability substrate compliance officers will probe. Agree.
- Environment-scoped storage preventing cross-tenant bleed. Agree.

## What I want changed (Dissent:)
- **Dissent: the 200-entry stream cap prunes the audit record.** Design pattern 9 promises "Retained for 3 years · reproducible for FCA review"; §3.20 is a regulatory file. Silently discarding stream entries in `partialize` contradicts the pitch. Cap the *demo persistence*, fine — but the type model must mark stream/worklist/activity as append-only compliance records, and the cap must be a named, documented demo-only constant.
- **Dissent: no firm/adviser ownership on any entity.** Buyers are multi-adviser firms and AR networks (Stonebridge appears in our own fixture). Add `adviserId`, `firmId`, optional `networkId` to Client/Case now — cheap in types, brutal to retrofit into persisted stores.
- **Dissent: worklist resolution must retain, not delete** (open question in the doc). Compliance officers ask "who dismissed this and when." Resolve with status + timestamp + actor.

## What I would not ship without
- A case-file export serializer (JSON, one function over the four stores). Without export, localStorage persistence is a procurement dead end: no SAR answer, no FCA record-keeping answer, no "what if my laptop dies" answer.
- A written GDPR position: localStorage holds unencrypted PII on device; environment-switch wipes data. I need the "demo substrate, server persistence in F-later" sentence on record, or I lose the compliance officer in meeting one.
- Erasure path: `removeClient` refusing while cases exist blocks right-to-erasure. Define anonymise-or-cascade.

## Acceptance criteria from my lens
- Seeded state reproduces §3.20 compliance record exactly, including the pending gift letter.
- Export of CASE_417 round-trips through JSON with every trace intact.
- Every entity carries adviser/firm ownership fields.

## Edge cases I want addressed
- Two advisers on one case (supervision/handover).
- Client shared across firms after adviser moves network.
- Browser storage cleared mid-trial — what does the prospect lose?
