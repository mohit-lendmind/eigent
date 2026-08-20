# Product Manager perspective on crm-domain-core

## What I support
- The soul survives the trip into types: `src:'det'|'syn'` on every field, `ReasoningTrace` with claim/working/evidence/alternatives/confidence/calibration, worklist `auto?`, conflict shapes. Agreed — patterns 1, 2, 3, 7 made structural, exactly where they must live.
- Integer pence, tone keys not hex, environment-scoped persistence, no UI/no network. Right scope for F01.
- Golden-path fixture as a runtime seed (not test-only) is the correct bet: it is the demo, and gives F02–F05 real data on day one. F01's named user is the downstream feature runner and demo audience; the adviser becomes the user at F02.

## What I want changed (Dissent:)
- **Dissent: field-change audit is underbuilt.** "Records prior value into an audit note" is prose, not a model. FCA/Consumer Duty and F15's "reproducible for 3 years" need a typed `FieldChangeEvent` (caseId, clientId, fieldKey, prior, next, actor: adviser|agent, source hint, timestamp) persisted from day one. Retrofitting audit onto F06/F09/F11 edits is the costliest deferral here — dangerously missing, not rightly deferred.
- **Dissent: materiality suppression has no home.** Pattern 3 surfaces counts ("Suppressed 14 low-confidence updates"). Add a suppressed-updates counter or entry kind now — cheap, and F05's stat strip needs it.
- **Dissent: settle the worklist-lifecycle question now — retain resolved items with status, never delete.** Deletion destroys the "What Lendmind did" story and the audit trail.

## What I would not ship without
- Typed field-change audit events (above).
- Fixture-parity tests pinning design headline numbers (LTV 85%, LTI 2.95×, £242,250, £38,500 vs £37,300).
- Seed as explicit dev action (agree), idempotent, never in prod builds.
- A frozen type surface: F02–F17's definition of done is "consumed types without modifying them."

## Acceptance criteria from my lens
- Seeded state reproduces every Today-screen count and c417/c392 number from design §3.
- Every fact-find mutation emits an audit event.
- `JSON.stringify` round-trip and version-0 migration tests pass per store.
- Success metric: F02–F05 land with zero F01 schema changes. Failure metric: any downstream PR forced to patch `types.ts`.

## Edge cases I want addressed
- £0 (det) vs missing (Tom's "£— missing") — distinct states, not a falsy collapse.
- Stream-cap pruning must never drop unresolved NEEDS YOU / approval entries.
- Conflict resolution updates field, doc, worklist, stream atomically — one fact, five surfaces.
- Environment switch mid-demo wipes CRM state: seed must be trivially re-runnable.
- Client on two cases; `removeClient` refusal path tested.
