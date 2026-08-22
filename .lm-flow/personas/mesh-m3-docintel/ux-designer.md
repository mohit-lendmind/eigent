# UX Designer perspective on mesh-m3-docintel

## What I support
- Pessimistic extraction: facts appear only when the artifact folds. A mid-stream guess that later shifts destroys the precision this milestone sells.
- Quote-locator as rejection filter (no quote ⇒ syn) is the interaction model, not a backend detail.
- Reuse ArtifactViewer/FilePreview; don't build a second viewer.

## What I want changed (Dissent:)
- **Dissent: a locator is not trust — the quote must be one tap from the fact.** "payslip · p1 L4" proves nothing. Tapping a det fact deep-links to the highlighted span in the preview.
- **Dissent: don't render every insight as a fact-find row** — that's an API dump. Surface mapped fields; collapse the rest.
- **Dissent: syn vs det can't be color-only.** det→emerald, syn→violet is an adjacent-hue trap for colourblind advisers; forced-light Storybook leaves dark contrast unverified. syn needs a non-color channel: an "unconfirmed" label + confidence (`syn · 0.62`) + confirm affordance.

## What I would not ship without
- **G2 decided without opening the doc.** Card shows the extracted identity ("D. Okafor, NI QQ12…") beside both candidate applicants; confirm or reassign in one tap. That's the 2-second decision.
- **G3 never auto-resolves, never discards.** Two columns — existing (source, as-of) vs new (source, quote+locator), delta £1,200 / 3.1%. Adviser picks authoritative; loser retained (record-never-repair).
- **Error cards for the two common failures:** garbled/oversize → typed failure + re-upload; low-OCR → completes, facts land syn with confidence shown. Never silent.
- **G9 shows why it's blocked** — tied to the specific unverified income field, not a generic message.

## Acceptance criteria from my lens
- Drop payslip → DocCard QUEUED→PROCESSING→COMPLETED; facts populate on fold; det facts deep-link to their quote.
- A syn field stays distinguishable from det with color disabled (greyscale test).
- G3 resolve writes det and retains the other value as history.

## Edge cases I want addressed
- First-run empty copy: "Drop a payslip, P60 or bank statement — I'll read it and fill the fact-find."
- Re-attribution after a G2 correction: facts re-point via a correction append, not an edit.
- Duplicate re-upload: dedupe or version — decide.
- Injection: document text is never rendered as a system/agent message.
- PROCESSING→COMPLETED announces `aria-live=polite`; provenance in the accessible name, not color alone.
