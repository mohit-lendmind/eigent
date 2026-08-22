# Head of Sales perspective on mesh-m2-watcher-onboarding

## What I support
- The demo is real: seed case → onboarding drafts checklist + welcome/doc-request with **firm-config disclosure baked in (never generated per-send)** → G1 card in the needs-you queue → adviser approves → send logged. For a compliance/SMF buyer, disclosure-in-every-message plus every action gated and logged **is the wow** — §11's export-pack story.
- Lead with **A1 onboarding**; it produces a readable artifact. Honest post-M2 claim: "a real onboarding agent, a needs-you queue, and gate approvals with FCA disclosure built in, landing in the audit record." Single processor (aion edge) keeps the security review short.

## What I want changed (Dissent:)
- **Dissent: the architect moved the micro-portal out of M2 into "M-portal" — spec §12 lists it IN M2.** A scope deviation Mohit must sign off, not a silent call. With no client surface, the client has nowhere to upload, so §11's "10+ real cases/month" is **not achievable at M2**. The thin surface wins the *logo*; the portal makes them *use* it. Sequence it next — don't imply M2 delivers live throughput.
- **Dissent: "watcher proposes" is a weak wow for an adviser who wants AI to *act*.** A queue item reads as a to-do list. Frame it as always-on ("watches your whole book every 5 min"); let A1's artifact carry the "it did something" moment.
- **Adviser-manual send** draws pushback ("it drafted it but I still send it?"). The line: logged manual send now, connector send v2, deliberately audit-clean.

## What I would not ship without
- A **named demo case + one-page compliance sheet** as M2 build artifacts (§11) — Phase 5's demo must name a case.
- One **named design-partner firm** to build against, or we're speculating.
- An **enterprise-readiness line**: SSO / RBAC / data-residency NOT in M2, deferred to a named milestone. Audit + retention (§1) I sell today; the rest not silently absent.

## Acceptance criteria from my lens
- 5-min demo runs cold from `/crm`: watcher populates the queue, approve a G1 card, disclosure visible in the draft, send logged.
- The audit/export view shows the gated action with disclosure and approver.
- A written "M2 can NOT claim" line: no doc-reading, no sourcing, no criteria/affordability, no portal, no live dispatch, no DIP.

## Edge cases I want addressed
- "Show me the client's view" — needs an honest next step, not a dead click.
- "What does the client see about AI?" — invariant-5 disclosure visible in the demo draft, not only config.
- Firm setup must fit a 14-day trial or we lose on time-to-value.
