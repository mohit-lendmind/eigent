# Lendmind Advisor — Canonical Design Reference

**Source**: Claude Design export at `scratchpad/lendmind-design/` (app/*.jsx, ~352KB of React source, plus screens/*.png and standalone HTML bundles).
**Purpose**: The reference design for rebuilding the app as **Lendmind Advisor** — an AI-native UK mortgage broker CRM. This document is written so engineers who never saw the export can rebuild each screen faithfully.
**Product thesis (from the export itself)**: *"The AI does the work; the adviser reviews & approves."* Exceptions-first inbox · instruct in plain English · cited reasoning on every claim · a live sourcing solver · cases built from raw material · a client portal that confirms instead of asks.

---

## Table of contents

1. [Design system](#1-design-system)
2. [Information architecture](#2-information-architecture)
3. [Domain model (data.jsx, transcribed)](#3-domain-model)
4. [Per-screen feature inventory](#4-per-screen-feature-inventory)
5. [Interaction & AI patterns worth preserving](#5-interaction--ai-patterns)
6. [Walkthrough narrative (product intent)](#6-walkthrough-narrative)

---

# 1. Design system

Defined across `index.html` (Tailwind config + global CSS), `ui.jsx` (primitives), `icons.jsx` (icon set).

## 1.1 Color palette (exact hex)

Tailwind `theme.extend.colors`:

| Token | Value | Use |
|---|---|---|
| `accent` | `#3B82F6` | Primary blue accent (active nav, focus, in-progress) |
| `accent.soft` | `rgba(59,130,246,0.1)` | Accent wash |
| `trust.det` | `#10B981` | **Deterministic / verified** — emerald. The "verified from document" color |
| `trust.syn` | `#8B5CF6` | **Synthesized / AI-inferred** — violet. The "AI did this" color |
| `pass` | `#10B981` | Criteria pass |
| `fail` | `#EF4444` | Criteria fail |
| `background` | `#FFFFFF` | Page background |
| `surface` | `#F8FAFC` | Soft panel background (slate-50) |
| `border` | `#E2E8F0` | Universal 1px border (slate-200) |
| `ink` | `#0F172A` | Primary text + primary button fill (slate-900) |
| `ink.soft` | `#475569` | Secondary text (slate-600) |

**Semantic accent families used throughout (Tailwind stock):**
- Amber (`#f59e0b`, `amber-50/100/500/600/700`) = warning / conflict / needs-attention flags.
- Rose (`#f43f5e` / `rose-500`, rose-50/100/600) = urgent / retention / blocked / rejection / notification badge.
- Violet (violet-50/100/500/600/700, dot `#8B5CF6`) = **everything AI**: sparkles icons, reasoning traces, intent bar, "automated" labels, live agent threads.
- Emerald = verified, done, success, WhatsApp, recommended.
- Blue = documents, email, in-progress, info.
- Indigo `#6366f1` = lender criteria / Sourcing stage.
- Stage spectrum (see pipeline stages, §3.2): slate → blue → indigo → violet → purple → fuchsia → amber → emerald. The pipeline literally walks the hue wheel from cold to done.

**Selection**: `::selection { background: rgba(59,130,246,0.25); color: #000; }`

Completeness color ramp (used identically in `CompletenessRing`, progress bars, section headers): `>=80 → #10B981`, `>=50 → #3B82F6`, `>=25 → #f59e0b`, else `#cbd5e1`.

## 1.2 Typography

Google fonts loaded: **Inter** (400/500/600/700), **Outfit** (400–800), **Playfair Display** (serif, largely unused fallback), **JetBrains Mono** (400–700).

| Family token | Font | Role |
|---|---|---|
| `font-sans` | Inter | Body copy, all UI text. `font-feature-settings: "cv11","ss01"`, antialiased |
| `font-display` | Outfit | All headings (`h1–h6` get `font-family: Outfit; letter-spacing: -0.02em`), stat numbers, lender monograms |
| `font-mono` | JetBrains Mono | **The label convention**: every micro-label/eyebrow is mono uppercase tracked wide; also refs (`LM-2026-0417`), money values, percentages, keyboard hints, timestamps |
| `font-serif` | Playfair Display | Declared, not used in views |

**Micro-label convention (ubiquitous — memorize it):**
`text-[9px..11px] font-mono font-semibold|font-bold uppercase tracking-wider|tracking-widest|tracking-[0.18em] text-slate-400`
Used for: field labels (`dt`), section eyebrows ("CONSTRAINTS — INFERRED", "NEEDS YOU · 3"), table headers, badge text, timestamps.

**Size scale is bespoke pixel values**, not Tailwind steps. Observed usage:
- Page h1: `text-[30px]` (Today greeting), `text-[26px]` (Cases/Clients), `text-[24px]` (client profile), `text-[28px]` (intake welcome, new-case intake) — always `font-display font-bold text-ink`.
- Card/section h2/h3: `text-[14px]–[18px] font-display font-bold`.
- Stat numbers: `text-[20px]–[22px] font-display font-bold leading-none`.
- Body/primary row text: `text-[13px]`, `text-[13.5px]`, `text-[12.5px]`.
- Secondary/detail: `text-[11px]–[12px] text-ink-soft`.
- Micro/mono labels: `text-[8.5px]–[11px]`.
- Numbers get `tabular-nums`.

## 1.3 Radius, spacing, shadows, layout

Border radius overrides: `xl: 16px`, `2xl: 20px`, `3xl: 28px`, `4xl: 36px`.
- Cards: `rounded-2xl` (20px) with `border border-border bg-white` is THE card.
- Hero/dark cards & portal panels: `rounded-3xl`.
- Buttons and chips/pills: `rounded-full`.
- Icon tiles: `rounded-xl` (16px) or `rounded-lg`, typically `w-9 h-9 bg-{tint}-50 text-{tint}-600 flex items-center justify-center` holding a `w-[18px] h-[18px]` icon.

Shadows:
```
glass: 0 8px 32px -4px rgba(15,23,42,0.06)
card:  0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -12px rgba(15,23,42,0.10)   ← hover state of cards
lift:  0 12px 48px -12px rgba(15,23,42,0.18)                                  ← drawers, toasts
pop:   0 8px 30px -6px rgba(15,23,42,0.16)                                    ← dropdown menus, sticky action bars
```
Default card state is shadowless (border only); `hover:shadow-card` on interactive cards.

Layout: full-viewport app, `html, body { height: 100dvh; overflow: hidden }`. Each view scrolls internally (`h-full overflow-y-auto`). Content max-widths: 1180px (Today), 1080px (Clients, Solver, New-case review), 900–940px (deep views), 820px (client profile), 760px (case stream), 600px (portal), 560px (intake chat). Horizontal padding `px-8` (top-level views) or `px-5` (case views). Custom scrollbar: 8px, `#E2E8F0` thumb with white border, `.no-scrollbar` utility to hide.

Utility classes defined in global CSS: `.glass-card` (white 85% + blur 20px), `.btn-primary` (see Buttons), `.focus-ring` (2px blue outline on focus-visible), `.grain` (dot texture), `.doc-skeleton` (shimmering slate gradient for processing docs), `.tab-underline` (2px animated ink underline via `data-active`), `.stripe-placeholder` (45° slate stripes).

## 1.4 Motion

Keyframes/animations (Tailwind config):

| Name | Behavior | Use |
|---|---|---|
| `enter` | translateY(9px)→0, .5s `cubic-bezier(0.16,1,0.3,1)` | view entrance |
| `step` (`stepAppear`) | translateY(5px)→0, .35s ease-out | expanding sections, revealed content |
| `shimmer` | background-position sweep 1.6s infinite | doc-skeleton processing bars |
| `phantom` | opacity/violet-glow pulse 2s infinite | AI "thinking" glow |
| `ticker` | translateY(6px)→0 .4s | counters |
| `pulseRing` | expanding blue box-shadow ring 1.6s | attention ring |
| `floatUp` | ±5px vertical float 6s infinite | decorative |
| `highlight` (`highlightFade`) | blue bg fading out over 1.8s | just-updated field flash |
| `caret` | opacity blink 1s step-end | fake typing caret (DIP agent typing) |
| `scaleIn` | scale(.97)→1 .25s | dropdowns, toast, modal cards |

The house easing is `cubic-bezier(0.16, 1, 0.3, 1)` (ease-out-quint feel) — used for buttons, drawer slide (300ms), completeness ring stroke (.9s), cursor moves.
Live/processing signifiers: `animate-ping` emerald dot (active case), `animate-pulse` violet dot ("Live"/"recomputing"), spinner = `rounded-full border-2 border-{color} border-t-transparent animate-spin`.

## 1.5 Component primitives (ui.jsx — all window-exported)

- **`cx(...a)`** — classnames joiner.
- **`Logo({className, maskId})`** — brand mark: `rounded-2xl bg-ink` tile containing a white house SVG (path `M2 10L12 2L22 10V21...`) with a lightning-bolt knocked out via SVG mask (bolt path `M13.5 4L10 11.5H12.5L11 19L17 10H14.5L15.5 4H13.5Z`). Each instance needs a unique `maskId`. Also used at `w-6/7 h-6/7 rounded-lg/xl` as the AI's chat avatar.
- **`Avatar({initials, className, tint, textCls})`** — `rounded-full bg-gradient-to-br` + initials at `text-[13px] font-semibold`. Per-person gradient tints (see clients §3.3).
- **`AvatarStack({people, size})`** — overlapping `-space-x-2` avatars with `ring-2 ring-white`, descending z-index.
- **`PipelineBadge({stage, size, interactive, onChange})`** — stage chip: `rounded-full border` with stage `bg/text/ring` classes, 1.5px dot in stage color, `s.short` label. `interactive` adds chevron + a click-outside-dismissed dropdown ("Move to" header + all stages) in `shadow-pop animate-scaleIn` popover.
- **`CompletenessRing({value, size=44, stroke=3.5, showLabel})`** — SVG circular progress, `-rotate-90`, track `#f1f5f9`, color by ramp (§1.1), centered numeric label, stroke animates `.9s`.
- **`EpistemologyTag({type:'det'|'syn', label, hint, mini})`** — THE trust primitive: mono uppercase pill. `det` → emerald (`bg-emerald-50 text-emerald-700 ring-emerald-200`) + `checkCircle` icon + default label "Verified". `syn` → violet (`bg-violet-50 text-violet-700 ring-violet-200`) + `bolt` icon + label "AI".
- **`SourceDot({src})`** — 1.5px dot: `#10B981` (det, title "Verified from document") or `#8B5CF6` (syn, title "AI inferred"). Appears next to virtually every data value in the product.
- **`SectionCard({title, icon, completeness, defaultOpen, right, children})`** — collapsible fact-find section: header row = icon tile (`w-7 h-7 rounded-lg bg-surface border`) + `text-[13.5px] font-semibold` title + optional per-section completeness (14-unit mini progress bar + mono `NN%` colored by ramp) + rotating chevron. Body `animate-step` on open.
- **`InlineField({field, highlight})`** — click-to-edit field. `dt` = mono micro-label + `SourceDot` + optional amber `flag` icon (`exclaim`) or `conflict` icon (`flag`, title "Conflicts across sources") + hover-revealed violet hint text (`· {hint}` = source provenance e.g. "Passport", "P60"). `dd` = value button (pencil icon appears on hover) → swaps to an input with `border-accent/60 ring-2 ring-accent/20`; Enter/Escape/blur to commit. Empty renders em-dash in `text-slate-300`. `t:'toggle'` renders an emerald/slate switch. `mono:true` sets JetBrains Mono.
- **`StatusPill({status})` + `PILL` map** — mono 9px uppercase pill: `pass` emerald, `fail` rose, `warning` amber, `info` blue (each `bg-*-50 text-*-700 border-*-100`, with dot color + icon: checkCircle/xCircle/exclaim/info).
- **`Button({variant, size, icon, iconRight})`** — `rounded-full font-semibold`; sizes sm/md/lg = `text-[12/13/14px]`. Variants: `primary` = `.btn-primary` (ink bg, white text, lifts −1px + deepening shadow on hover, scale .99 active); `secondary` = white + border; `ghost`; `accent` = blue; `dark`. Disabled = `opacity-40`.
- **`StepDots({steps, active})`** — dots: done=emerald, active=blue elongated (w-4), todo=slate.
- **`Toast({toast})`** — fixed bottom-center, `bg-ink text-white rounded-full shadow-lift animate-scaleIn`, emerald check circle + message. Auto-dismisses at 2600ms (managed in `App.showToast`).

## 1.6 Icons (icons.jsx)

Single-path heroicons-outline-style set: `<Icon name= className strokeWidth={1.6} fill={bool} />` — `fill` switches to filled `currentColor` (used for emphasis: active nav, sparkles, checkCircle). ~70 names: nav (`inbox, folder, users, workspace, columns, chat, bell, search, switch`), sections (`user, envelope, mapPin, briefcase, banknotes, creditCard, home, shield, phone`), documents (`doc, docText, docCheck, clipboard, identification, fingerprint, signature`), status (`check, checkCircle, xCircle, x, exclaim, info, flag, lock, key`), domain (`scale`⚖ criteria/sourcing, `wallet, bank, building, building2, trendUp, refresh`retention, `beaker`calc, `archive`), misc (`bolt, sparkles`✨=AI, `clock, chevron*, arrowRight, arrowUpRight, plus, paperclip, mic, send, upload, download, eye, globe, whatsapp, filter, dots, pencil, calendar, link, cursor, list, play, bellAlert`).

**Iconography grammar**: `sparkles` (filled, violet) = AI acted or can act; `scale` = lender criteria/sourcing; `flag` (amber) = conflict/needs attention; `refresh` (rose) = retention; `beaker` = calculation; `shield` = compliance.

## 1.7 Aesthetic voice

Light-only theme. Dense but airy: white cards with hairline slate borders on a `#F8FAFC` wash, generous 20px radii, tiny mono eyebrows over confident Outfit headings. Feels like a cross between Linear (density, mono micro-labels, ⌘K) and a fintech consumer product (rounded, friendly, emerald/violet trust language). Color is *semantic, never decorative*: violet always means AI, emerald always means verified/done, amber always means "look at this", rose always means urgent. Copy is first-person from the agent ("I'll scan every lender…", "Here's what I heard"), plain-English, UK-domain-literate, warm to clients ("Get the keys" 🏡), precise to advisers (numbers always cited to source).

---

# 2. Information architecture

## 2.1 Two perspectives, one app

`main.jsx` `App` holds a `mode` state: `'adviser'` (console) ⇄ `'client'` (Portal). Switch: rail's "Preview client portal" / portal's "Adviser view" button. No router — pure state:

```js
mode: 'adviser'|'client'
view: 'today'|'cases'|'clients'|'client'|'case'      // adviser top-level
caseId: 'c417' (default) | 'c392' | 'cnew'
caseTab: 'stream' (default) | 'sourcing'|'factfind'|'documents'|'evidence'|'compliance'|'application'|'comms'
clientId, applicant ('aisha'|'daniel'|'joint')
portalView: 'tracker'|'details'|'documents'|'messages';  portalApplicant: 'aisha'|'daniel';  portalFirstTime
newCaseOpen, dipOpen (full-screen overlays)
toast;  runs[] (intent-bar directive results, prepended to stream)
flow: { sourced:false, selectedProduct:'hx', dipSubmitted:false, evidenceReady:false, stage:'DIP' }
```
`go(view, id)`: `'case'` sets caseId (default c417) + resets caseTab to `'stream'`; `'client'` sets clientId. All shared via `AppContext` / `window.useApp()`.

A `TourBridge` publishes `window.__lm = { go, setMode, setCaseTab, setCaseId, openNewCase, closeNewCase, setPortalFirstTime, addRun, clearRuns, state(), reset() }` so the walkthrough player can drive the live app.

## 2.2 Adviser shell — the "TacticalRail"

Left sidebar, collapsible `w-[84px]` ⇄ `w-[244px]` (300ms), white, `border-r`. Contents top→bottom:
1. **Header** (h-14): Logo (→ Today) + "Lendmind" wordmark when expanded; chevron toggle.
2. **Primary nav** (`RAIL`): **Today** (icon `inbox`, badge = `WORKLIST.length` in rose), **Cases** (`folder`), **Clients** (`users`). Active state: expanded = `bg-ink text-white` row; collapsed = `w-11 h-11 rounded-2xl bg-accent text-white` tile + accent label. Cases stays active for `view==='case'`, Clients for `view==='client'`.
3. Divider, then **New case** button — dashed border, hover accent, opens NewCaseOverlay.
4. **Recent cases** (scrollable): hardcoded `[['c417','Okafor · Reyes', busy:true], ['c392','Hargreaves', false]]`; busy = ping-animated emerald dot + emerald text. Eyebrow "RECENT CASES" when expanded.
5. **Footer**: "Preview client portal" (`switch` icon, accent) → `setMode('client')`; adviser identity — `w-8 h-8` dark-gradient circle "EV" + name + network when expanded.

Main content: `<main className="flex-1 … pr-[84px]">` (note the 84px right padding, mirroring the rail width for optical centering). `:root { --rail: 88px }` declared in CSS.

## 2.3 Case workspace IA (case.jsx) — stream-first, tabs demoted

Explicit design commentary in source: *"Stream is the primary surface (not 'Overview' tabs-as-nouns) · Intent bar always-on for adviser → agent directives · Eight original tabs demoted to 'deep views' via slash or rail · Sourcing replaced by live constraint Solver."*

Structure: `CaseHeader` (h-14) → `IntentBar` (persistent) → either:
- **Stream mode** (`caseTab==='stream'`): strip "CASE STREAM ——— [Open view ▾]" + `CaseStream` (center, max-w 760) + `StatePane` (right rail, 280px).
- **Deep view mode**: one of 7 full-height views; header gains a "‹ Back to stream" link.

`DEEP_VIEWS` (Open-view pill menu + slash commands): `sourcing` "Sourcing solver" (`scale`), `factfind` "Fact find" (`user`), `documents` (`doc`), `evidence` (`docCheck`), `compliance` (`shield`), `application` (`clipboard`), `comms` (`chat`). Menu rows show `/{id}` slash hint in mono. Note: `SolverTab` (solver.jsx) is what `sourcing` renders; the older wizard-style `SourcingTab` (sourcing.jsx) still exists window-exported (used by DIP flow narrative) — the Solver is the canonical one.

## 2.4 Client portal IA (portal.jsx)

Two entry states: `caseId==='cnew'` → first-time **IntakeWelcome → IntakeFlow** (intake.jsx); otherwise the standing portal: `PortalTopBar` (Logo + nav pills **Progress / Your details / Documents / Messages** + "Adviser view" + applicant switcher Aisha/Daniel) over a 600px-wide column.

---

# 3. Domain model

Everything below is from `data.jsx` (`window.LM`), plus the entity injections in `newcase.jsx` and local datasets in `solver.jsx` / `stream.jsx` / `clients.jsx` / `intent.jsx`. Entity design (source comment): **Client (person) · Case (transaction) · Applicant (join)**. Golden path: **Case 0417 — Aisha Okafor + Daniel Reyes, joint FTB**. Second journey: **Case 0392 — Tom Hargreaves, self-employed remortgage**. Third (created live): **cnew — Priya Bhatt + Jordan Adebowale, home mover**.

## 3.1 ADVISOR

```js
{ name:'Eleanor Vance', initials:'EV', role:'Mortgage & Protection Adviser',
  firm:'Meridian Mortgages', network:'Stonebridge · Appointed Representative',
  fcaRef:'FRN 924817', email:'eleanor.vance@meridianmortgages.co.uk' }
```

## 3.2 STAGES (pipeline) + STAGE_MAP

8 stages, each `{ key, label, short, dot, text, bg, ring }`:

| key | label | short | dot |
|---|---|---|---|
| LEAD | New enquiry | Enquiry | `#94a3b8` slate |
| FACT_FIND | Fact find | Fact find | `#3B82F6` blue |
| SOURCING | Sourcing | Sourcing | `#6366f1` indigo |
| DIP | Decision in principle | DIP | `#8B5CF6` violet |
| APPLICATION | Full application | Application | `#a855f7` purple |
| VALUATION | Valuation | Valuation | `#d946ef` fuchsia |
| OFFER | Offer | Offer | `#f59e0b` amber |
| COMPLETION | Completion | Completion | `#10B981` emerald |

(Each also carries `text-*-700 bg-*-50 border-*-100` classes matching the dot family.)

## 3.3 CLIENTS (people — durable identity, many cases over a life)

Fields: `id, ref, firstName, lastName, initials, tint, textCls, role, email, phone, cases[], since`.

- **aisha** — `LM-C-2041`, Aisha Okafor, `AO`, tint `from-blue-500/20 to-indigo-200` / `text-accent`, Registered Nurse, `aisha.okafor@gmail.com`, `07712 660 145`, cases `['c417']`, since Mar 2026.
- **daniel** — `LM-C-2042`, Daniel Reyes, `DR`, emerald/teal tint, Secondary School Teacher, `d.reyes@outlook.com`, `07820 114 663`, `['c417']`, Mar 2026.
- **tom** — `LM-C-1187`, Tom Hargreaves, `TH`, amber/orange tint, Company Director (Design Studio), `tom@harg.studio`, `07533 905 220`, cases `['c392','c1101']`, since Sep 2021.
- Injected by newcase.jsx: **priya** — `LM-C-2188`, Priya Bhatt, `PB`, fuchsia/rose, Senior Product Manager (Monzo), `priya.b@gmail.com`, `07911 552 008`, `['cnew']`, Jun 2026; **jordan** — `LM-C-2189`, Jordan Adebowale, `JA`, violet/indigo, Registered Architect (Foster + Partners), `j.adebowale@protonmail.com`, `07882 401 119`.

Clients directory extras (clients.jsx `DIRECTORY`): marcus (Marcus Bell, `LM-C-1402`, Architect, 2 cases, "2 weeks ago"), sofia (Sofia Russo, `LM-C-0998`, Pharmacist, 3 cases, "Protection review"), priya-shah ("Priya & Raj Shah", `LM-C-1771`, "GP · Engineer", 1 case, "Valuation booked").

## 3.4 Fact-find field model

Helper `F(k, label, v, opts)` → `{ k, label, v, t?, src, hint?, flag?, conflict?, mono? }`:
- `src: 'det'|'syn'` — **epistemology of every field**: deterministic (verified from a document) vs synthesized (AI-inferred, needs review).
- `hint` — provenance string shown on hover (e.g. `'Passport'`, `'P60'`, `'Payslip · Contract'`, `'Basic + 50% OT'`, `'Same as applicant 1'`).
- `t` — `'select' | 'date' | 'number' | 'toggle'` (default text). `mono` for values like NI numbers, money.
- `flag: true` — amber needs-attention; `conflict: true` — conflicts across sources.

Sections per applicant (`APPLICANT_SECTIONS`): `personal` (icon user) · `contact` (envelope) · `address` (mapPin) · `employment` (briefcase) · `income` (banknotes) · `expenditure` (creditCard) · `credit` (shield). Each profile section = `{ _c: <completeness 0..1>, fields: [...] }`.

### AISHA_PROFILE (all sections; _c values 1.0 except expenditure 0.9)
- personal: Title 'Ms' (det) · First name 'Aisha' · Last name 'Okafor' · DOB '1994-02-11' (det, hint Passport) · Marital 'Cohabiting' (**syn**) · NI 'NX••••••C' (mono, det, hint P60) · Citizenship 'British' (det, Passport) · Permanent UK residency = true (toggle, det) · Dependants '0' (**syn**).
- contact: Email, Mobile (both det).
- address: '14 Ladybarn Road' (det, hint Bank statement) · Manchester · 'M14 6NR' (mono) · Time at address '2 yr 4 mo' (**syn**) · Residential status 'Private tenant' (**syn**).
- employment: Type 'Employed' (det) · Employer 'Manchester Univ. NHS Trust' (det, hint 'Payslip · Contract') · Job title 'Registered Nurse (Band 6)' · Start '2019-09-02' · Years in role '5.7' (**syn**) · In probation = false (det).
- income: Basic '£42,000' (det, hint 'P60 · 3× payslips') · Overtime (avg) '£3,200' (**syn**) · Bonus '£0' (det) · **Income considered '£43,600' (syn, hint 'Basic + 50% OT')**.
- expenditure (all syn): Council tax £66 · Utilities £90 · Travel £110 · Living costs £360.
- credit: Adverse credit=false (det, hint Credit report) · Monthly commitments '£189' (det, hint Car finance) · Credit score '481 / Excellent' (det).

### DANIEL_PROFILE (the "risk" applicant; _c: personal .95, employment .7, income .85, expenditure .6)
- personal: Mr Daniel Reyes, DOB '1992-07-23' (hint Driving licence), NI 'JT••••••B' (hint Payslip), Marital Cohabiting (syn), Dependants 0 (syn).
- address: all **syn** — '14 Ladybarn Road' hint 'Same as applicant 1', time '1 yr 8 mo'.
- employment: Employer 'Trafford High School' (det, hint Contract) · 'Teacher of Science' · **Start '2026-01-06' (det, hint Contract, `flag:true`)** · **Years in role '0.4' (syn, flag)** · **In probation = true (det, flag)**.
- income: **Basic '£38,500' (det, hint 'Contract · payslip', `conflict:true`)** · Overtime £0 (syn) · Bonus £0 · Income considered '£38,500' (syn).
- credit: clean, commitments £0, score '468 / Excellent'.

### Tom's inline profile (c392): 
personal (_c 1.0): Tom Hargreaves, DOB 1985-11-30. employment (_c .5): 'Self-employed (Ltd director)', Business 'Hargreaves Studio Ltd', Years trading '7', Shareholding '100%'. income (_c .4): Director salary '£12,570' · **Dividends (2yr avg) '£58,400' (syn, flag)** · Net profit Y1 '£71,200' (det) · **Net profit Y2 '£— missing' (syn, flag)**. credit (_c .8): **Adverse credit = true (flag)** · Detail '1 missed payment · Nov 2024'.

## 3.5 CASES

Case fields: `id, ref, type, kind, label, stage, completeness, updated, applicants[{clientId, role, profile, completeness}], property{address,city,postcode,type,tenure,value,construction}, deposit{total,pct,breakdown[{src,amt,flag?}]}, requirement{loan,ltv,term,repayment,ratePref,purpose}, affordability{combined,ltiNeeded,maxStandard,surplus,verdict}`, optional `retention{reason,daysLeft}`.

**CASE_417** (`c417`, `LM-2026-0417`): Purchase / First-time buyer, "First home · Didsbury", stage DIP, completeness 0.9, updated '6 min ago'. Applicants: Aisha (Applicant 1, .97), Daniel (Applicant 2, .83). Property: '8 Brookfield Avenue, Didsbury', Manchester M20 3PL, 2-bed terraced house, Freehold, **£285,000**, 'Standard (brick & tile)'. Deposit: **£42,750 (15%)** = 'Own savings (joint)' £40,750 + **'Gift — Aisha's mother' £2,000 (flag)**. Requirement: loan **£242,250**, LTV **85%**, term **32 years**, Capital & interest, '2-year fixed', Purchase. Affordability: combined **£82,100**, LTI needed **2.95×**, max standard **£369,450**, surplus **£1,180 / mo**, verdict 'comfortable'.

**CASE_392** (`c392`, `LM-2026-0392`): Remortgage / 'Self-employed · Ltd director', "Remortgage · Clifton", stage FACT_FIND, 0.64, '2 days ago'. `retention: { reason:'Fixed rate ends 31 Aug 2026', daysLeft:79 }`. Sole applicant Tom (.64). Property: '22 Royal York Crescent, Clifton', Bristol BS8 4JX, 3-bed maisonette, Leasehold, £520,000. Deposit: '£208,000 equity' (40%). Requirement: £335,000, 64% LTV, 18 years, C&I, '5-year fixed', **'Remortgage + £23k capital raise'**. Affordability: £70,970, **4.72×**, max £319,365, surplus 'under review', verdict **'review'**.

**cnew** (injected, `LM-2026-0462`): Purchase / Home mover, 'New family home · Walthamstow', LEAD, 0.42. Priya (.5) + Jordan (.34), empty profiles. Property '47 Aubrey Road, Walthamstow' E17 5BD, 3-bed terraced, tenure 'TBC', **£495,000**, 'Standard (assumed)'. Deposit £85,000 (17.2%) = Joint savings £25,000 + **'Inheritance — Priya' £60,000 (flag)**. Requirement £410,000 / 82.8% / 28 years / C&I / 5-year fixed / 'Home mover from rental'. Affordability £160,000 / 2.56× / £718,400 / 'modelled' / comfortable.

## 3.6 PIPELINE (Cases board/table dataset — 8 rows)

`{ id, ref, label, stage, completeness, days (in stage), applicants[names], type, flag?, active? }`:

| ref | label | stage | compl | days | applicants | type |
|---|---|---|---|---|---|---|
| LM-2026-0461 | BTL enquiry | LEAD | .05 | 1 | Deborah Quinn | Buy-to-let |
| LM-2026-0392 | Remortgage · Clifton | FACT_FIND | .64 | 5 | Tom Hargreaves | Remortgage (flag) |
| LM-2026-0455 | Home mover · Sale | FACT_FIND | .38 | 3 | Naomi Clarke | Home mover |
| LM-2026-0417 | First home · Didsbury | DIP | .90 | 1 | Aisha Okafor, Daniel Reyes | First-time buyer (**active**) |
| LM-2026-0388 | Portfolio remo | APPLICATION | .95 | 8 | Jordan Mensah | BTL Ltd co |
| LM-2026-0355 | Home mover · Chorlton | VALUATION | .97 | 11 | Priya Shah, Raj Shah | Home mover |
| LM-2026-0301 | Remortgage | OFFER | .98 | 14 | Marcus Bell | Remortgage |
| LM-2026-0240 | Shared ownership | COMPLETION | 1.0 | 26 | Grace Adeyemi | FTB · shared own. |

## 3.7 DOCUMENTS (person-scoped, case-used)

`{ id, owner ('aisha'|'daniel'|'joint' via flag), name, type, status:'COMPLETED'|'PROCESSING', size, when, icon, attribution (0..1|null), joint?, insights:[{label,value,conf,good?,flag?,conflict?}] }`:

- **d1** aisha `Passport_AOkafor.jpg` / Identity / 1.8 MB / 'Today 09:14' / fingerprint / attribution **0.99** — insights: Full name 'Aisha N. Okafor' .99 · DOB '11 Feb 1994' .99 · Nationality 'British' .98.
- **d2** aisha `Payslip_March.pdf` / Payslip / 212 KB / 09:15 / .97 — Annual income £42,000 .96 · Employer 'Manchester Univ. NHS Trust' .95 · NI 'NX••••••C' .92.
- **d3** aisha `P60_2024-25.pdf` / P60 / 188 KB / .98 — Total pay in year £44,920 .97 · Tax year '2024–25' .99.
- **d4** daniel `Statement_Joint_Mar-May.pdf` / Bank statement / 640 KB / **attribution 0.74, `joint:true`** — Account holders 'A Okafor & D Reyes' .93 · **Deposit evidenced '£40,750 saved' .90 (`good`)** · **Gift credit '£2,000 · 14 Aug' .86**.
- **d5** daniel `Contract_TraffordHS.pdf` / Employment contract / 301 KB / .95 — Employer 'Trafford High School' .96 · **Start date '06 Jan 2026' .95 (`flag`)** · **Salary '£38,500' .94 (`conflict`)**.
- **d6** daniel `IMG_2098.HEIC` / 'unclassified' / **PROCESSING** / 2.1 MB / 'Just now' / attribution null, no insights. (Interactive "Finish" resolves it to: Driving licence, attribution .96, icon `identification`, insights Full name/DOB/Address.)
- Demo upload: `Gift_Letter_signed.pdf` → after 2.2s becomes 'Gifted deposit letter', .95, icon signature, insights: Gift amount £2,000 .96 (good) · From 'Grace Okafor (mother)' .94 · Non-repayable 'Confirmed' .95 (good). Toast: "Gifted deposit letter received — criteria satisfied".

## 3.8 DOC_CHECKLIST (drives portal checklist + chasing)

Keyed `aisha / daniel / joint`, items `{label, status:'received'|'pending'|'partial'|'requested', note?}`:
- aisha: Photo ID (passport) ✓ · Latest 3 payslips ✓ · P60 ✓ · **Proof of address (≤3 mo) — pending**.
- daniel: Photo ID (driving licence) ✓ · Employment contract ✓ · **Latest 3 payslips — partial, '1 of 3 received'**.
- joint: 3 months bank statements ✓ · Proof of deposit ✓ · **Gifted deposit letter (mother) — requested, 'Auto-requested today'**.

## 3.9 WORKLIST (Today's "Needs you" decision queue)

`{ id, case, kind, title, detail, cta, tab, auto? }`. Kinds map to `KIND` meta in today.jsx (`conflict`='Resolve conflict'/flag/amber, `criteria`='Lender criteria'/scale/indigo, `doc`='Document'/doc/blue, `approval`='Approve'/checkCircle/emerald, `retention`='Retention'/refresh/rose, `signature`='Signature'/signature/violet):

1. **w1** c417 conflict — "Confirm Daniel's salary" — "Contract states £38,500; first payslip annualises to £37,300. £1,200 variance to resolve." CTA **Resolve** → documents.
2. **w2** c417 criteria — "Daniel is within probation" — "Started 6 Jan 2026 (5 months). 4 of 38 lenders decline; teachers accepted by most from day one." CTA **Review sourcing** → sourcing.
3. **w3** c417 doc (`auto`) — "Gifted deposit letter needed" — "£2,000 gift from Aisha's mother requires a signed gifted-deposit letter before submission." CTA **Request** → comms.
4. **w4** c417 approval — "Fact find ready to approve" — "AI built 31 fields across both applicants from 5 documents. 2 inferred fields await your confirmation." CTA **Review** → factfind.
5. **w5** c392 doc (`auto`) — "Tom's 2nd-year accounts outstanding" — "Year-2 net profit missing — needed to evidence self-employed income. Reminder sent 2 days ago." CTA **Chase** → documents.
6. **w6** c392 retention — "Tom's fixed rate ends in 79 days" — "Remortgage case auto-opened. Product transfer window now open — source to retain the client." CTA **Open case** → overview.

## 3.10 AI_DID (passive "What Lendmind did" log)

`{icon, text, when}`: doc 'Classified & extracted 5 documents for case 0417 — attributed to the right applicant' 09:18 · user 'Built joint fact find — 31 fields, completeness 38% → 90%' 09:19 · scale 'Ran whole-of-market sourcing — 38 lenders, 10 criteria, 4 eligible products' 10:02 · envelope 'Drafted gifted-deposit letter request to Aisha (awaiting your approval)' 10:05.

## 3.11 RETENTION (radar — fixed rates ending)

`{client, ref, ends, days, lender, rate, status:'case-open'|'due'|'horizon'}`:
Tom Hargreaves LM-C-1187 · 31 Aug 2026 · **79** · Coventry BS 1.84% · case-open ▸ Marcus Bell LM-C-1402 · 14 Sep 2026 · 93 · Santander 2.19% · due ▸ Sofia Russo LM-C-0998 · 02 Nov 2026 · 142 · Halifax 1.99% · horizon ▸ Henry Watanabe LM-C-1655 · 20 Nov 2026 · 160 · NatWest 4.41% · horizon.
Status meta (clients.jsx `RET_STATUS`): case-open 'Case open' emerald · due 'Action due' amber · horizon 'On horizon' slate. Urgency: `days < 90` → rose left-bar + rose day count.

## 3.12 CRITERIA (sourcing criteria engine, case 417 — 10 checks)

`{ group:'lending'|'affordability', cat, label, status:'pass'|'warning'|'info', reasoning, impacts?:[{lender,status,note}] }`:

1. lending/Property — 'Standard construction (brick & tile)' — pass — "Subject property assessed as standard construction. Accepted by all 38 lenders in scope."
2. lending/LTV — 'Loan-to-value 85% within limits' — pass — "£242,250 against £285,000 = 85.0% LTV — within the 90% maximum for 36 of 38 lenders."
3. lending/Policy — 'First-time buyer eligible' — pass — "Neither applicant has owned property before…"
4. lending/Employment — **'Applicant 2 within probation' — warning** — "Daniel started 6 Jan 2026 (5 months, in probation). Some lenders require 6–12 months continuous service." Impacts: Skipton BS **fail** 'needs 6 mo' · Halifax pass 'from 1st payslip' · Nationwide pass 'teachers ok' · Coventry BS **fail** 'probation excl.'
5. lending/Policy — **'Gifted deposit acceptable' — warning** — "£2,000 gift from a parent is acceptable with a signed gifted-deposit letter. Letter requested — required before submission." Impacts: All pass 'letter on file'.
6. lending/Credit — 'Adverse credit — none' — pass — "…no CCJs, defaults or missed payments. Both on the electoral roll."
7. affordability/Income — 'Combined income £82,100' — **info** — "Aisha £43,600 (basic + 50% overtime) + Daniel £38,500 = £82,100 considered income."
8. affordability/Affordability — 'Loan-to-income 2.95× — comfortable' — pass — "£242,250 ÷ £82,100 = 2.95×, well within standard 4.49× caps. Maximum standard borrowing ~£369,450."
9. affordability/Affordability — 'Stress test at reversion' — pass — "Stressed payment £1,690 (8.49%) leaves a £1,180 monthly surplus after committed expenditure."
10. affordability/Affordability — 'Net disposable surplus healthy' — pass — "Modelled monthly surplus £1,180 after mortgage, credit and essential expenditure…"

## 3.13 PRODUCTS (sourcing results, case 417)

`{ id, lender, product, rate, type, fee, monthly, ltv, total (2yr true cost), status, recommended?, notes, apr }`:

| id | Lender | Product | Rate | Fee | Monthly | 2yr total | Status | Notes |
|---|---|---|---|---|---|---|---|---|
| hx | Halifax | 2-Year Fixed 85% FTB | 4.22 | 999 | 1198 | 29751 | pass, **recommended** | 'Accepts new employment from first payslip · £250 cashback' (APRC 7.4) |
| nw | Nationwide | 2-Year Fixed 85% | 4.27 | 999 | 1205 | 29919 | pass | 'Teachers accepted in probation · free valuation' |
| ac | Accord | 2-Year Fixed FTB | 4.31 | 495 | 1211 | 29559 | pass | "Lower fee · 3 months' service preferred" |
| sk | Skipton BS | 2-Year Fixed 85% | 4.19 | 999 | 1194 | 29655 | **fail** | "Declines — requires 6 months' employment" |
| cov | Coventry BS | 2-Year Fixed | 4.24 | 999 | 1201 | 29823 | **fail** | 'Excludes applicants in probation' |

Key story: the two *cheapest headline rates* (Skipton 4.19, Coventry 4.24) fail on Daniel's probation — the recommendation is defensible on eligibility + true cost, not rate.

### Solver universe (solver.jsx — extends PRODUCTS)
`SOLVER_LENDERS` adds each product a `rationale` + `criteriaTrail` (pass) or `rejectReason`/`rejectCriterion`/`failOn` (fail). Extra rows: **TSB** 2-Year Fixed FTB 4.34 / fee 0 / 1216 / total 29184, pass — 'Zero arrangement fee… Cashback £500. Best for cashflow over true rate.'; **Barclays** 4.21 fail 'FTB range requires 12 months' employment continuity.' (Barclays § 2.1, failOn tenure); **Santander** 4.28 fee 0 fail "Will not include overtime under 12 months' history." (Santander · Income § 2.3, failOn income); **NatWest** 4.30 fail gift-family-scope note (NatWest Gift § 5.1, failOn gift). Skipton reject criterion 'Skipton § 3.1 Employment tenure'; Coventry 'Coventry § 4.2 Probationary period'.
`SOLVER_LENDERS_5YR`: Halifax 5-Year Fixed 85% FTB 4.04/999/1175/71490 · Nationwide 4.09/999/1183/71979 · Accord 4.14/495/1190/71895 (all pass; rationales mention 'Lower stress requirement on 5-year fixes — improves LTI capacity').
`criteriaTrail` vocabulary: `employment-from-day1, teacher-day1, employment-pref, gift-deposit-letter, ltv-85, ltv-84, ltifit-4.49x, ltifit-5.50x, adviser-override` — each mapped to human labels in the Why? trace, cited as "`{lender}` criteria · v24.6".

## 3.14 AFFORDABILITY (per-lender max borrowing)

`{ combined:'£82,100', requested:'£242,250', headroom:'£126,399', basis:'Aisha £42,000 basic + 50% overtime · Daniel £38,500 basic', lenders:[ Nationwide '5.50×' '£451,550' 'FTB enhanced ≥ £37k' · Halifax '4.49×' '£368,649' 'Recommended' · Skipton '4.49×' '£368,649' 'Declines — employment tenure' · Accord '4.49×' '£368,649' ] }`

## 3.15 DIP_FIELDS (lender-portal field mapping, Halifax)

13 rows `{ portal, value, who ('aisha'|'daniel'|'joint'|'case'), src }`:
'Applicant 1 — Name' Aisha Okafor · 'Applicant 1 — DOB' 11/02/1994 · 'Applicant 1 — Income' '£42,000 + £3,200 OT' · 'Applicant 2 — Name' Daniel Reyes · 'Applicant 2 — DOB' 23/07/1992 · 'Applicant 2 — Employer start' 06/01/2026 · 'Applicant 2 — Income' £38,500 · 'Current address (both)' '14 Ladybarn Road, M14 6NR' · 'Property — Purchase price' £285,000 · 'Deposit' '£42,750 (incl. £2,000 gift)' (**syn**) · 'Loan amount' £242,250 (**syn**) · 'Term' 32 years · 'Product' '2yr Fix 4.22%' (**syn**).

## 3.16 COMMS (case-scoped, multi-channel)

`{ id, channel:'email'|'whatsapp'|'portal', dir:'in'|'out', from, subject?, when, body, attachments?, unread? }`:
- m1 email in, Aisha, 'Documents for our mortgage', 'Today · 09:12' — full friendly body ("…Daniel's added his new teaching contract too. Really excited!…"), attachment chip 'via Lendmind portal · 5 files'.
- m2 whatsapp out, You, 09:44 — "Morning both! Everything's through… One quick thing coming on the £2k gift from your mum, Aisha. 🏡"
- m3 whatsapp in, Aisha, 09:46 — "Amazing thank you!! Yes mum's expecting to hear from you 😊"
- m4 portal in, Daniel, 10:10, `unread:true` — "Quick q — does my job being new (started in Jan) cause a problem? Happy to send anything else."

## 3.17 PORTAL_STEPS (client journey tracker)

`{key,label,sub,status}`: apply 'Application started'/'Welcome & your details'/done · docs 'Documents'/'Upload what we need'/done · factfind 'Your details'/'Confirmed with Eleanor'/done · **sourcing 'Finding your mortgage'/'Eleanor is comparing lenders'/active** · dip 'Decision in principle'/'Submitted to the lender'/todo · offer 'Mortgage offer'/todo · complete 'Completion'/'Get the keys'/todo.

## 3.18 INTAKE (Aisha's portal "Your details" conversation)

Message array `{role:'ai'|'user', text (with **bold** markdown), confirm?:{label,value}, chips?:[]}` — 7 messages ending on the gift question with chips `['Gift from family', "It's a loan", 'Not a gift']`. Opening: "Hi Aisha 👋 I'm going to help you and Daniel complete your details — it usually takes about 8 minutes. I'll pre-fill everything I can from your documents so you just confirm. Ready?" Includes address confirm card ('Current address' / '14 Ladybarn Road, M14 6NR') and the £2,000 gift-detection question.

## 3.19 APPLICATION (post-DIP engine, case 417)

`{ lenderRef:'HX-APP-7741920', submitted:'4 Jun 2026', lender:'Halifax', milestones[], chases[], parties[] }`.
Milestones `{key,label,owner,status,date?,sla?,note?}`: fma 'Full application submitted'/You/done/4 Jun · docs 'Supporting documents certified'/You/done/'6 documents uploaded to lender' · **uw 'Underwriting'/Halifax/active/sla 'Lender SLA 3 days · day 1 of 3'/'Assessor assigned — initial review'** · **val 'Valuation'/Surveyor/active/'Booked Thu 6 Jun'/'Physical valuation instructed'** · offer 'Mortgage offer'/Halifax/todo · legal 'Conveyancing & searches'/Solicitor/todo · exchange 'Exchange of contracts'/Solicitor/todo · complete 'Completion'/'All parties'/todo.
Chases `{what,who,last,next,auto:true,status}`: 'Underwriter — confirm receipt of certified ID' / 'Halifax · BDM Jasmine Okoro' / 'Today 08:30' / 'Auto-chase in 2 days' / waiting ▸ 'Solicitor — return signed client care pack' / 'Eric Robinson Solicitors' / 'Chased 2 days ago' / 'Auto-chase today 5pm' / **overdue** ▸ 'Surveyor — confirm valuation slot' / 'Connells Survey & Valuation' / Yesterday / 'Confirmed Thu 6 Jun AM' / done.
Parties: Lender 'Halifax for Intermediaries' (BDM: Jasmine Okoro, icon bank) · Surveyor 'Connells Survey & Valuation' ('Thu 6 Jun, AM', home) · Solicitor 'Eric Robinson Solicitors' ('Ref ER-22841', scale) · Estate agent 'Bridgfords, Didsbury' ('Neg: Tom Healy', building2).

## 3.20 COMPLIANCE (case 417)

- disclosures: 'Initial Disclosure Document (IDD)' / 'Issued at first contact · 1 Jun' / done · 'Fee agreement (£499 on offer)' / 'e-signed by both applicants · 1 Jun' · 'Privacy notice & GDPR consent' / 'Acknowledged · 1 Jun'.
- idv: Aisha — 'Electronic ID&V · passport + facial match' / Passed / IDV-90412 / 3 Jun; Daniel — 'Electronic ID&V · driving licence' / Passed / IDV-90418.
- aml: `{ sanctions:'Clear', pep:'Clear', adverse:'Clear', provider:'SmartSearch', date:'3 Jun' }`.
- vulnerability: `{ status:'none', note:'No characteristics of vulnerability identified at fact find. Re-assessed each interaction under Consumer Duty.' }`.
- consumerDuty (4 pillars): 'Products & services' — 'Recommendation matches recorded needs & objectives' · 'Price & value' — 'Lowest eligible true cost selected; fees fair-value assessed' · 'Consumer understanding' — 'Plain-language suitability report issued & acknowledged' · 'Consumer support' — 'Portal + adviser access throughout the journey'.
- declaration: signed / 'Both applicants' / 3 Jun / 'Fact-find accuracy declaration e-signed in the client portal'.
- supervision: `{ status:'in-review', principal:'Stonebridge Network', checker:'Pre-submission file check', note:'Queued for network compliance review before full application is submitted to the lender.' }` items: 'Fact find complete & internally consistent' pass · 'Affordability evidenced & stress-tested' pass · 'Suitability rationale documented' pass · 'ID&V and AML checks clear' pass · **'Gifted deposit letter on file' — pending**.

## 3.21 NOTES (file notes & call log)

`{type:'call'|'note', who, when, dur?, text}` — 3 entries by Eleanor Vance: call 1 Jun 14:20 18 min (initial call, budget £285k, flagged Daniel's new role, IDD issued verbally + durable copy emailed) · note 3 Jun 09:30 (priorities: lowest monthly payment, 2-yr fix; £2k gift → letter requested) · note 3 Jun 10:05 ("Sourced whole-of-market. Halifax best fit given Daniel's probation. Proceeding to DIP once the gift letter is on file.").

## 3.22 Stream datasets (stream.jsx — the case activity record)

Entry shape: `{ id, kind, icon, when, title, body, cta?:{label,view}, actions?:[{label,primary?,view?}], pulse?, pinned?, trace?:{claim, subject?, working[], evidence[{kind,label,value?,source?,quote?,note?}], alternatives?[{option,reason,rejected?}], confidence, calibration?} }`.
`STREAM_KIND` meta: `live` 'Live agent' violet · `intent` 'Your directive' violet · `approval` 'Awaiting approval' emerald · `conflict` 'Conflict — needs you' amber · `external` 'Awaiting external' blue · `done` 'Done' slate · `blocked` 'Blocked' rose (each with dot color + ring class).

**STREAM_417** (7 entries — the golden-path work record):
1. `s-live` (live, pinned, pulse) — 'Sourcing solver — 4 of 38 products eligible' / 'Halifax @ 4.22% recommended on true cost. Reflows the moment you change a constraint, the fact find moves, or a lender updates criteria.' CTA 'Open solver'. Trace claim '4 of 38 lender products pass the joint case at current constraints', subject 'Constraint solver · last recomputed 12s ago', evidence cites 'Halifax criteria · Section 4.2 v24.6' ("From first payslip, no min service") and 'Skipton criteria · § 3.1', conf .96.
2. `s-conf` (conflict, 10:08) — "Conflict: Daniel's salary varies between contract and payslip" — body quotes the £38,500 vs £37,300 annualised variance. **Actions: 'Confirm £38,500' (primary) · 'Use payslip £37,300' · 'Ask client'.** Trace working includes 'Payslip: monthly gross £3,108.33 × 12 = £37,300 annualised' and 'exceeds 1% materiality threshold'; evidence quotes the contract verbatim ('Annual salary: £38,500 (MPS3, Outer London weighting)' — Page 1, line 18) and payslip ('Gross this period: £3,108.33 · Period: 1'); alternatives use-contract vs use-payslip; **confidence .78, calibration 'Detected with high confidence; resolution requires adviser judgement.'**
3. `s-app` (approval, 09:19) — 'Fact find built from documents — 31 fields ready to approve' — '25 deterministic from documents · 6 synthesized · 2 await your confirmation. Joint completeness 38% → 90% in 4 minutes.' Actions: 'Review extractions' (→factfind) · 'Approve all'. Conf .93.
4. `s-gift` (external, 10:05) — "Gift letter requested from Aisha's mum" — "Sent via Aisha's WhatsApp (her preferred channel — 4/4 reply rate). Auto-chase scheduled for tomorrow 10:00 if no reply. Submission blocks until letter is on file." Actions 'See the message' (→comms) · 'Cancel auto-chase'. Trace: channel picked by reply rate (WhatsApp 4/4 vs email 0/2), conduit-consent reasoning, policy 'Third-party contact rule · Internal · CP-2024'. Conf .85.
5. `s-aff` (done, 10:02) — 'Affordability modelled — 2.95× LTI, £1,180 surplus' — working shows the arithmetic (basic+50% OT, 4.22%/32yr → £1,198/mo, stress 8.49% → +£1,028), evidence cites 'PRA stress floor +3pp'. Conf .96.
6. `s-crit` (done, 10:00) — 'Criteria sweep — 10 gates × 38 lenders' — '8 gates pass cleanly; 2 caution… 6 lenders fall out on tenure; 4 on construction; 2 on probation policy. 4 eligible products remain.' Conf .95.
7. `s-ext` (done, 09:14–09:18) — 'Documents classified, extracted, and attributed' — '5 documents · 0.93 mean confidence · 1 still processing…' Trace working: 'Classified by mime, OCR signature and content / Extracted typed fields per document class / Attributed to applicant by name/NI match on field cluster.'
8. `s-comp` (done, 3 Jun) — 'IDD, ID&V and AML clear · Consumer Duty stance recorded'. Conf 1.0.

**STREAM_NEW** (cnew, 5 entries): live solver first pass ('Halifax 5-yr fix @ 4.04% leading… LTI £410,000 ÷ £160,000 = 2.56×', conf .78 'Preliminary — will firm up when docs land') · 'Portal welcome sent to Priya & Jordan' (external; action 'See client view' → portal) · 'Document requests issued — 7 items' (external; probate evidence for £60k inheritance, cites 'Halifax § 5.3') · '2 flags raised on this case' (conflict: 'Tenancy ends 30 Sep — completion pressure', Priya's bonus unconfirmed; actions 'Plan around timeline'/'Note: ask Priya') · 'Case opened from your call notes + lead email' (done: '24 fields extracted in 1.4s; 4 flags raised; 2 fields still missing. Stream starts here.').

**STREAM_392** (2 lean entries): "Tom's 2nd-year accounts outstanding" (external) · 'Case auto-opened from retention radar' (done — "…so you don't miss the product-transfer window").

## 3.23 Intent runs (intent.jsx INTENT_RUNS — canned agent results)

Keyed `sourcing / suitability / digest / stress / chase / model`, each `{label, eta, artifact?, body, trace}`. Highlights:
- **sourcing** 'Re-sourcing with hard 4.5× LTI cap' (eta 'live · streaming') — body: cap → £369,450 max; no ranking change. Trace cites both incomes as fact-find fields + policy 'FCA MCOB 11.6 — Adviser-imposed cap recorded for audit'. Conf .97 'pure arithmetic against deterministic fact-find inputs'.
- **suitability** 'Suitability draft — Halifax decline scenario' (~40s) — Nationwide 4.27% primary / Accord backup; alternatives block includes rejected Coventry. Conf .92.
- **digest** 'Digest since Friday' — 3 material changes, '14 minor field updates suppressed'. Conf .99.
- **stress** 'Stress test at 6% reversion' — payment +£156 → £1,354; surplus £1,180 → £1,024; evidence: combined net monthly £4,508, essential expenditure £2,130. Conf .94.
- **chase** "Chase: gift letter from Aisha's mum" (eta 'sent · awaiting reply') — channel selection by reply-rate history; quotes the WhatsApp thread; vulnerability protocol citation 'Internal · CD-2024-V'. Conf .88.
- **model** 'Model £270k purchase with same deposit' — £227,250 @ 84.2% LTV, monthly £1,124 (−£74), 2yr £27,876; Halifax stays top. Conf .95.

## 3.24 New-case extraction dataset (newcase.jsx)

`NEW_LEAD`: a verbatim lead email (From 'Priya Bhatt <priya.b@gmail.com>', subject 'Recommended by Maya Hassan — looking for a broker', Mon 2 Jun · 14:22) + call note ('Tue 3 Jun · 18:45 · 22 min') containing: budget £475–525k Walthamstow/Leytonstone, £85k deposit (~£60k inheritance from 'estate of P. Bhatt Sr., probated Sep 2025'), incomes ~£92k+bonus / ~£68k, renting £2,300/mo tenancy ending 30 Sep, sale-agreed 47 Aubrey Road E17 5BD @ £495k, 'need DIP this week', 5-year fix, £180/mo car finance (Priya).

`EXTRACTION` — 4 groups (People/users, Property/home, 'Loan & deposit'/banknotes, 'Income & affordability (modelled)'/scale), 24 items `{k, v, src:'email'|'call'|'email+call'|null, conf, quote?, syn?, calc?, flag?, missing?}`. Examples: 'Priya · income' '£92,000 base + bonus' conf .92 quote '~£92k base + bonus' **flag 'bonus_amount_unknown'** · 'Tenure' 'Not yet confirmed' conf .4 syn **missing** · 'Loan required' '£410,000' conf .96 syn **calc** quote 'price £495k − deposit £85k = £410k' · '— Inheritance · Priya' '£60,000' flag 'evidence_needed'.

`FLAGS` (4): inheritance needs probate/estate evidence (criteria) · tenancy ends 30 Sep timeline pressure · DIP needed this week (timeline) · Priya's bonus unconfirmed (income).
`NEXT_ACTIONS` (4, all `auto:true`): request IDs/payslips×3/P60/statements×3mo from both · request inheritance evidence (grant of probate) · run whole-of-market sourcing 38 lenders 5-yr fix · send portal welcome with intake link.
`SOURCE_OPTIONS`: 'Paste call notes' ('5–25 min summary or transcript', phone) · 'Forward an email' (envelope) · 'Voice memo' ("I'll transcribe & extract", mic) · 'Drop documents' ('KFI, agent particulars, anything', upload).

## 3.25 Intake script (intake.jsx — Priya's first portal session)

`INTAKE_SCRIPT` — 11 AI messages with phases `welcome → confirm → new-info → evidence → upload → done`, each optionally `{confirm:{label,value}, chips:[], fact:{k,v}, note, upload, summary}`. Phase copy: opener "Hi **Priya** 👋 I'm Lendmind, your application assistant. Eleanor briefed me after your call last night… **about 8 minutes**." (note badge 'Pre-loaded from call notes'). Confirms: property (£495,000, 47 Aubrey Road), joint applicant Jordan, loan/deposit '£410,000 / £85,000 · 5-yr fix'. New-info: term chips '25/28/30/35 years', dependants chips. Evidence: "your **£60k inheritance from your dad**. Do you have the grant of probate to hand? Lenders need that to evidence it's not a loan." chips `['Yes — I'll upload', "I'll find it", 'Not yet']`. Upload phase → `DOC_REQUESTS` (Priya/Jordan × Photo ID + 'Latest 3 payslips', hints 'PDF from Monzo HR / Workday' / 'PDF from Foster + Partners'). Done: "That's everything I need 🎉 … I'll text Jordan with his portal link too." Summary card: 'All set · fact find 91% complete'.

---

# 4. Per-screen feature inventory

## 4.1 Today (today.jsx) — the exceptions-first AI worklist

*Header comment: "exceptions-first AI worklist (replaces the copilot). The AI does the work; the adviser reviews & approves."*

**Layout** (max-w 1180): header row → 3-stat strip → 2/3 + 1/3 grid.
- **Header**: mono date eyebrow 'Tuesday · 3 June 2026' · h1 'Good morning, Eleanor' (30px) · subhead "Lendmind worked your cases overnight. **{n} decisions** need you — everything else is handled." Right: round icon buttons (search, bell with rose dot), primary 'New case'.
- **Stat strip** (3 cards): 'Need you' {n} rose/inbox · **'Handled by AI' 17 emerald/sparkles — clickable, shows violet "✨Why?" affordance and opens a full ReasoningDrawer trace** (claim 'Lendmind handled 17 things on your portfolio overnight without you.', subject 'Last 12 hours · 4 cases touched', working includes 'Suppressed 14 low-confidence updates as not material', evidence incl. 'AML sanctions list · SmartSearch · refreshed 02:14 · Clear', conf .91, calibration 'Threshold tuned high — Lendmind suppresses anything < 0.75 confidence and queues it instead.') · 'Completing in June' £1.18m ink/home.
- **Left 2/3 — "Needs you"** (h2 with inbox icon + '{n} items'): stack of `WorklistCard`s. Each card: kind-tinted `rounded-2xl border` with icon tile, kind chip (mono 9px, e.g. 'RESOLVE CONFLICT'), optional '✨automated' chip when `auto`, bold title, detail line, then a client row (AvatarStack + names + mono case ref, clickable) and a right-aligned CTA `Button` (primary if kind approval, else secondary, `iconRight arrowRight`). Clicking opens the case then `setCaseTab(item.tab)`.
- **Right 1/3**: (a) **"What Lendmind did"** (sparkles h2, violet): passive log card of AI_DID rows (violet icon tile + text + time). (b) **Pipeline** mini-card (clickable → Cases): stacked flex-weighted bar of stage colors + 4-col grid of counts under mono stage shorts. (c) **Retention radar teaser**: rose gradient card — "**4 clients** have fixed rates ending within 6 months. Tom Hargreaves is up first — case auto-opened." + 'Open retention radar →' link (→ Clients).

## 4.2 Cases (cases.jsx) — board + table

Header: h1 'Cases' + '{n} live cases · one row per advised transaction'; view toggle pill (Board/`columns` · Table/`list`; active `bg-ink text-white`); 'New case' primary.
- **Board**: horizontal-scrolling columns per stage, `w-[252px]`; column header = stage dot + label + mono count chip; body `bg-slate-100/50 rounded-2xl` holding `CaseCard`s; empty → dashed 'Empty' placeholder. `CaseCard`: AvatarStack; active case gets ping-emerald dot + `border-accent/40 ring-accent/20`; flag icon if flagged; names (hover accent), label, then type chip (mono 9px bordered) + thin completeness bar + mono pct.
- **Table** columns: Applicants (avatars + names + flag/active dot + label) · Reference (mono) · Type · Stage (`PipelineBadge`) · Completeness (bar + pct, w-32) · In stage ('{days} days' mono). Rows clickable.

## 4.3 Clients (clients.jsx) — directory + retention radar + profile

- **RetentionRadar** (top card): gradient rose header — refresh icon tile, 'Retention radar', '— fixed rates ending within 6 months', right-aligned '✨AUTO-MONITORED' chip. Rows: urgency bar (rose if `days<90`), client name + '{lender} · {rate} · ends {date}', big day-count ('79' + 'DAYS LEFT'), status pill, action: case-open → 'Open' secondary (→c392); due → 'Start remortgage' primary; horizon → ghost. Starting shows toast "Remortgage case opened for {client}".
- **Directory**: eyebrow row 'DIRECTORY ——— {n} people'; list rows = avatar, name+role, mono ref (w-24), '{n} case(s)', last-activity, chevron. → ClientProfile.
- **ClientProfile**: back link 'All clients'; identity header (w-14 avatar, name, 'role · ref · client since {date}'). Tom-only retention banner: 'Fixed rate ends 31 Aug 2026 — 79 days' / 'Coventry BS · 1.84%. Remortgage case auto-opened to retain the client.' + 'Open case'. **Case history**: rows '{type} · {label}' + '{ref} · {value} · {city}' + PipelineBadge; Tom also shows an archived 2021 purchase (opacity-70, 'LM-2021-1101 · £465,000 · completed'). **Contact & identity** grid (Email/Mobile/Role).

## 4.4 Case workspace (case.jsx)

- **CaseHeader** (h-14, white): back chevron → Cases · AvatarStack (w-9) · names (15px display bold) + mono ref · '{type} · {kind} · {city}' · **interactive PipelineBadge** bound to `flow.stage` (dropdown "Move to" → toast 'Case moved to {label}') · '‹ Back to stream' when in a deep view · right side: CompletenessRing(34) + 'CASE FILE / {pct}% ready' + dots menu.
- **ViewSwitcherPill**: mono 'Open view ▾' pill → popover 'DEEP VIEWS' listing the 7 views with `/{id}` hints.
- **NotesPanel** (window-exported; adviser-private notes UI with textarea, 'Log call' secondary + 'Add note' primary, list of NOTES rows with phone/pencil icon tiles, 'Just now' insert + toasts).

## 4.5 Intent bar (intent.jsx) — the directive surface

Persistent under CaseHeader on every case. Violet-gradient sparkles tile + input `placeholder="Ask or instruct Lendmind on Aisha & Daniel…    try "/" for views"` + `⌘K` kbd hint (global listener focuses it) + ink submit arrow when non-empty. Focus ring: `border-violet-200 ring-4 ring-violet-100/60`.
Focused dropdown: if input starts with `/` → 'OPEN DEEP VIEW' rows (mono violet `/cmd` + label + desc, from `SLASH`, e.g. `/source` 'live products vs 38 lender criteria'); else → 'TRY' list of 6 `QUICK_INTENTS` ('Re-source against a 4.5× LTI cap' · 'Draft suitability letter assuming Halifax declines' · 'What changed on this case since Friday?' · 'Summarise affordability risks if rates rise to 6%' · "Chase the gift letter from Aisha's mum" · 'Model £270k purchase with same deposit') + footer 'Lendmind reads: fact find · 5 docs · 38 lender criteria · case history'.
Submit: slash → `setCaseTab(view)`; intent → `addRun({kind:'intent', title, directive, status:'live'|'ready'|'thinking', eta, body, trace, when:'Just now'})` prepended to the stream + toast 'Lendmind has a result' / 'Lendmind is working'.

## 4.6 Case stream (stream.jsx) — primary case surface

Sections in order (max-w 760, on `bg-surface/40`):
1. **'LIVE · AGENT THREADS'** (pulsing violet dot, '1 running'): the pinned live solver entry, always expanded, violet dot pulsing on the timeline.
2. **'NEEDS YOU · {n}'** (rose): conflict + approval entries.
3. **'YOUR DIRECTIVES'** (violet sparkles): intent runs from the bar; entry shows the directive as an italic violet quote block.
4. **'LENDMIND ACTIVITY' ——— '{n} actions'**: done/external/blocked entries.

**StreamEntry** anatomy: timeline rail (1px slate line + 3px kind-colored node, pulse when live) · card (`rounded-2xl border {kind.ring}`, live gets shadow-card; collapsed done entries dim to `bg-surface/40` hiding body) · header = kind chip (mono 9px, e.g. 'CONFLICT — NEEDS YOU') + optional '● recomputing' (live) + mono timestamp + bold title + body · footer on expand = action `Button`s (primary/secondary; `view` navigates tab, `'portal-preview'` flips to client mode) + right-aligned violet mono **'✨Why?'** button opening the trace in the ReasoningDrawer. Done entries default collapsed; live/intent default open.

**StatePane** (right rail 280px, white, own scroll) — *"pinned facts, replaces Overview"*:
- 'APPLICANTS': avatar rows (name, role, amber flag on Daniel) → factfind.
- 'PROPERTY': `StateRow`s (mono micro-label + SourceDot + value + sub) — Address (det), Value (det, mono, bold).
- 'LOAN & DEPOSIT': Loan (syn dot; sub '85% LTV · 32 years'; → sourcing) · Deposit (syn; '15% · 2 sources') · LTI '2.95×' (syn; '£82,100 considered income · comfortable').
- 'RECOMMENDATION': emerald card — lender monogram, name, type, big rate; grid Monthly/Fee/2yr; footer '✨Why? trace' → drawer trace (claim '{lender} … is the current recommendation', workings on filtering/ranking, conf .94).
- 'OPEN FLAGS': amber 'Salary variance — Daniel' + blue 'Gift letter pending — mum'.

## 4.7 Reasoning drawer (reasoning.jsx) — the trust artifact

Global singleton; `window.openReasoning(trace)` / `closeReasoning()`; Escape + scrim click to close; slides in from right `min(460px, 92vw)`, 300ms house easing, `shadow-lift` over `bg-ink/20 backdrop-blur` scrim.
Sections: **header** — violet sparkles tile + mono 'REASONING TRACE' + close; claim (14px display semibold) + subject line. **WORKING** — numbered steps (circled mono digits). **CITED EVIDENCE · {n}** — `EvidenceChip`s: kind-tinted header (kinds: `criteria`/scale/indigo 'Lender criteria' · `field`/user/emerald 'Fact-find field' · `document`/doc/blue · `policy`/shield/violet · `calc`/beaker/amber 'Calculation') + mono source ref; body shows verbatim `quote` (mono, left-bordered blockquote style) and/or `label: value` and/or note. **ALTERNATIVES CONSIDERED** — option rows, `rejected` gets rose xCircle. **CALIBRATION** — labeled confidence bar (color ramp ≥.85 emerald / ≥.6 blue / else amber) + mono pct + optional calibration sentence. **Footer**: 'Generated {when|just now}' + secondary 'Redirect' (refresh) + primary 'Accept' (check).
**`WhyPill`** helper: violet mono uppercase '✨ Why?' pill wrapping any claim.

## 4.8 Fact find (factfind.jsx)

- **AI banner** (violet gradient): "**FCA fact find auto-built from 5 documents, attributed per applicant.** Click any value to edit. Two inferred fields and one conflict need your confirmation." + legend: ● Verified from document · ● AI inferred — review · ⚑ Needs attention.
- **ApplicantTabs**: per-applicant pill (avatar + first name + completeness pct colored ≥90 emerald / ≥60 amber / else slate; active = accent ring) + a 'Property & requirement' pill (home icon; active = `bg-ink text-white`) selecting the joint view.
- **Per-applicant**: `SectionCard` per APPLICANT_SECTIONS with `_c` completeness; fields as `InlineField` grid (2–3 cols). Default-open: first section, plus Employment when viewing Daniel (surfaces his probation flags).
- **Joint view** (`CaseSection`, read-only dl grids): Property (7 rows) · Deposit (Total/Percentage + breakdown rows, gift row flagged amber) · Mortgage requirement (Purpose/Loan/LTV/Term/Repayment/Rate preference) · Affordability (Combined income/LTI required/Max standard loan/Monthly surplus).

## 4.9 Documents (documents.jsx) — vault with AI attribution

- AI banner: "**AI reads, classifies and attributes each document to the right applicant.** The joint bank statement and Daniel's contract need a quick confirm."
- **Upload dropzone** (dashed, hover-accent): 'Drop documents — for either applicant' / 'AI classifies & attributes automatically. **Add the gift letter**'. Click simulates the gift-letter upload lifecycle (§3.7).
- Owner filter pills: All / Aisha / Daniel / Joint.
- **DocCard**: icon tile + filename + type chip (mono, slate) + **AttributionBar**: PROCESSING → violet spinner 'Identifying applicant & type…' + top shimmer bar + 'Finish' link; else 'ATTRIBUTED TO' + owner chip (mini avatar + name) + confidence chip (≥90 emerald / ≥85 blue / else amber, e.g. '74%') + **'Confirm' link when attribution <0.85 or `joint`** → '✓Confirmed'. Right: '{n} insights' + chevron expander.
- Expanded **insights grid**: bordered tiles — mono label (+flag) + bold value; `conflict` → amber tile + caption 'Differs from contract — confirm in fact find'; `good` → emerald tile. (Contract d5 is default-expanded — the conflict is in view on arrival.)

## 4.10 Sourcing wizard (sourcing.jsx — legacy tab, kept for DIP flow)

Three phases:
1. **ready**: card 'Whole-of-market sourcing' — "I'll scan every lender against the joint fact find — including Daniel's recent employment and the gifted deposit — and run hard criteria checks before showing products." + 6 param chips (Applicants/Property/Loan/LTV/Term/Preference) + primary '✨Run whole-of-market scan' + '38 lenders · 10 criteria'.
2. **scanning**: violet card, pulsing sparkles, 'Scanning the market…' + live '{k} / 38 lenders' counter + `SCAN_STEPS` checklist ('Reading the joint fact find' → 'Querying 38 lender criteria libraries' → "Checking Daniel's employment tenure per lender" → 'Validating gifted-deposit policy' → 'Modelling combined affordability' → 'Ranking eligible products by true cost') with check/spinner/pending states, 500ms cadence.
3. **results**: '✓Sourcing complete' + '**3 of 5** products pass all criteria · evidence captured' + 'Re-run'. Then:
   - **Scoped Q&A** ('ASK ABOUT CRITERIA'): 3 question chips with canned expert answers (Halifax probation / £2,000 gift / borrow more — full copy in `QA`), answer rendered beside a mini Logo.
   - **AffordabilityPanel**: collapsible 'Affordability — max borrowing by lender' ('requesting £242,250 · £126,399 headroom'); per-lender horizontal max-borrowing bars with a **rose vertical marker for the requested amount** + LTI labels; caption 'Requested £242,250 — comfortably within every eligible lender's maximum.'
   - **CriteriaPanel**: header '{n} passed / {n} caution' + '10 CHECKS · 38 LENDERS'; groups 'POLICY VERIFICATION' (shield) & 'CAPACITY ANALYSIS' (wallet); `CriteriaRow` = status icon + mono category + label + StatusPill + expandable reasoning panel with **per-lender impact chips** (pass emerald / fail rose, e.g. 'Skipton BS — needs 6 mo').
   - **Product list** ('ELIGIBLE PRODUCTS ——— ranked by true 2-yr cost'): `ProductRow` — lender monogram tile, name + '✨RECOMMENDED' chip + StatusPill, product, notes (failed rows dim to 70% + rose reason), big rate + type; stat grid Monthly/Fee/LTV/'2yr cost'; footer 'Select product' ⇄ '✓Selected for recommendation' + 'APRC {apr}%'.
   - **Sticky DIP bar** (gradient fade): 'Ready to submit DIP to Halifax' / 'Agent opens the lender portal and maps both applicants across — zero rekeying' + primary 'Submit DIP' → DipOverlay.

## 4.11 Sourcing Solver (solver.jsx) — the canonical sourcing view

*"Sourcing reimagined as an arguable live model."* Header: scale icon + 'Sourcing solver' + '●LIVE' violet chip; sub 'Argue with the model. Add constraints in chips below or type plain English — products and rejected lenders reflow instantly, each with a Why? trace.'; right: big '{pass}/{total}' + 'PRODUCTS ELIGIBLE'.

- **Constraints card** ('CONSTRAINTS — INFERRED', filter icon): `ConstraintChip`s — locked (🔒): Loan £242,250 · LTV 85% · Term 32y · Applicants 'Joint · Aisha + Daniel' · Construction 'Standard brick' · Gift deposit 'Parent · letter pending'; mutable: Type (accent-violet when ≠ 2yr Fixed, clearable ×); conditional accent chips for LTI cap / Override 'Probation rule waived' / Excluded {lender} — all clearable.
- **NL input**: sparkles + `placeholder='Argue with the solver:  "5-year fix"  ·  "ignore Halifax"  ·  "model £270k"  ·  "treat Daniel as outside probation"'` + mono 'Apply ↵'. `NL_PRESETS` regex transforms: 5yr/2yr switch, exclude Halifax/Nationwide, 4.5×/4.0× LTI cap, £270k model (loan 227250, ltv 84), **probation waiver** ('Probation rule waived (manual override)'), reset. Unmatched input → 'No applicable transform — leaving constraints unchanged.'
- **Suggestion chips**: '5-year fix' · 'Ignore Halifax' · '4.5× LTI cap' · 'Model £270k' · 'Treat Daniel as outside probation' · 'Reset'.
- **Trail**: 'TRAIL · {n} edits' — last 3 directives with violet mono result notes.
- **Results, 3/5 + 2/5 grid**:
  - **'ELIGIBLE · {n}' (…ranked by true 2-yr cost)**: `PassRow` — rank `#1`, monogram, lender + '✨TOP PICK' (first row), product, **rationale sentence**, rate block; stats Monthly/Fee/LTV/Total; 'Selected'/'Select' + violet mono **'✨Why this?'** → drawer (workings: criteria pack gates, affordability, cost ranking; evidence from `criteriaTrail` each 'Pass · {lender} criteria · v24.6', conf .95). Empty state: dashed rose card 'No products survive these constraints.' / 'Try relaxing one of the recent edits — e.g. unblock a lender or remove the LTI cap.'
  - **'REJECTED · {n}' (…criterion that killed them)**: `FailRow` — dimmed row, lender + rate, rose reject reason with xCircle, mono criterion cite (e.g. 'Skipton § 3.1 Employment tenure'), 'ADVISER EXCLUDED' chip when applicable, 'Why?' → drawer (claim '{lender} cannot lend to this case', evidence 'Fail' + the fact-find field that killed it, **alternatives: 'Wait 1 month to re-source — Daniel's tenure crosses 6 months on 6 Jul — Skipton & Coventry would re-qualify.'**, conf .97).
- Probation waiver rescues tenure/probation failures into passes with rationale 'Rescued via adviser override on employment tenure — flag for compliance.' + `adviser-override` in the trail.

## 4.12 DIP overlay (dip.jsx) — agentic lender-portal submission

Full-screen `z-[150]` over blurred scrim. Header: globe tile, 'Agentic DIP submission' / 'Aisha Okafor · Halifax broker portal', live progress bar + pct, close ×.
Phases `intro → mapping → review → submitting → done`:
- **Split view**: LEFT (34%, 'Lendmind fact find' + mono 'SOURCE') = DIP_FIELDS list rows with SourceDot, mono portal-label, value, emerald ✓ as filled; active row `bg-accent/[0.07] ring-accent/30`. RIGHT = simulated browser: chrome bar with traffic lights + padlock URL `broker.halifax.co.uk/dip/new` + '● agent typing' badge; form 'Halifax for Intermediaries — New DIP' whose inputs fill one-by-one (360ms cadence) with a blinking caret on the active field; both panes auto-scroll to the active row.
- **Narration bar** per phase: intro — 'The agent will log into the Halifax portal and transfer all 13 fields from the fact find. You can watch and approve before submission.' + 'Start mapping'; mapping — 'Mapping {portal} → {value}' + '{k}/13'; review — 'All 13 fields transferred and validated — no rekeying. Review the portal form, then submit.' + 'Re-map' / 'Submit to Halifax'; submitting — spinner "Submitting DIP and awaiting the lender's automated decision…" (1.8s).
- **done**: centered card — emerald checkCircle, 'Decision in Principle accepted', 'Halifax has issued an agreement in principle for Aisha.', stat grid **DIP reference 'HX-DIP-5527140' · Max borrowing £369,450 · Product '4.22% 2yr Fixed' · Valid until '03 Sep 2026'**; 'Back to case' / 'Generate evidence' (→ evidence tab, toast 'Building evidence pack'). Sets `flow.dipSubmitted`.

## 4.13 Evidence (evidence.jsx) — evidence of research & suitability

Gate state: centered card 'Build the evidence pack' — 'Generate the reproducible sourcing snapshot, FCA suitability report and disclosure set for the case file — all from the recorded research.' → '✨Generate evidence pack' (sets `flow.evidenceReady`, toast).
Ready: header 'Evidence of research & advice' / '**Retained for 3 years · reproducible for compliance & FCA review**' + 'Preview PDF' / 'Export bundle' (toast 'Evidence pack exported to case file'). Sub-tab pills: **Sourcing snapshot / Suitability report / Disclosures**.
- **SourcingSnapshot**: (a) meta card — '🔒IMMUTABLE' chip + 'Captured at the point of recommendation — reproducible for FCA file review'; MetaChips **Snapshot ref 'EVR-417-03' · Generated '03 Jun 2026 10:03' · Rates as-at '03 Jun 2026 06:00' · Lenders scanned '38 / 38'**. (b) 'ALL PRODUCTS CONSIDERED' table (Lender/product · Rate · Monthly · 2yr cost · Outcome) — recommended row emerald-washed with checkCircle; outcome pills Selected/Eligible/Declined; footer 'Decline reasons recorded per product · 8 of 10 criteria passed · full criteria log attached'. (c) violet **'Rationale (auto-recorded)'** card: "Halifax selected as the lowest-cost product the applicants qualify for. Skipton (4.19%) and Coventry (4.24%) were marginally cheaper but **declined** — both require 6 months' continuous employment… Halifax assesses from the first payslip and accepts the £2,000 parental gift with a letter on file. Affordability is comfortable at 2.95×…"
- **SuitabilityReport**: rendered letter, masthead 'SUITABILITY REPORT · MCOB 4.7A' / h 'Mortgage recommendation for Ms A. Okafor & Mr D. Reyes' / byline 'Eleanor Vance · Meridian Mortgages (Stonebridge AR) · FRN 924817 · 3 June 2026' + Logo. Six numbered `ReportSection`s: 1 'Your circumstances & objectives' · 2 'My recommendation' (Halifax 2-Year Fixed 4.22%, £242,250/32yr C&I, £1,198/mo, £999 fee, £250 cashback) · 3 'Why this is suitable for you' · 4 'Alternatives considered & not recommended' · 5 'Costs, fees & how I am paid' (advice fee £499 on offer; **procuration fee 0.35% from Halifax**; ESIS attached) · 6 'Risks & important information' ('Your home may be repossessed…', SVR 8.49% reversion, ERC).
- **Disclosures**: 4 download rows — Initial Disclosure Document ('Issued 1 Jun · acknowledged…') · 'Fees & commission disclosure' (MCOB 4.4A; 'Procuration fee 0.35% (~£848)… No fee if your mortgage does not complete.') · 'ESIS — European Standardised Information Sheet' (MCOB 5A · Halifax product) · 'Gifted deposit letter' ('Held on file · signed by G. Okafor' — 'Confirms the £2,000 gift is non-repayable and the donor retains no interest in the property.').

## 4.14 Application (application.jsx) — application → completion engine

- Header card: HX blue monogram, 'Full application · Halifax', 'Submitted 4 Jun 2026 · ref HX-APP-7741920', big '{pct}% TO COMPLETION' + emerald progress (pct = done milestones / total).
- **'Progress to completion'** (left 2/3): vertical timeline of milestones — status node (done emerald ✓ / active blue pulsing / todo slate), card with label + **owner chip** (`OWNER_TINT`: You slate · Halifax blue · Surveyor fuchsia · Solicitor violet · All parties emerald) + date + note + **SLA bar** on underwriting (amber 33% bar + 'Lender SLA 3 days · day 1 of 3').
- **Chasing** (right, '✨auto' chip): chase cards — what, status chip (`Awaiting reply` blue / `Overdue` rose / `Confirmed` emerald), who, last contact vs next ('✨Auto-chase in 2 days'), and a 'Chase now' accent button (toast 'Chase sent & logged').
- **Parties**: icon rows for Lender/Surveyor/Solicitor/Estate agent with role · contact and a chat affordance.

## 4.15 Compliance (compliance.jsx)

- **AR supervision banner** (amber gradient): shield tile, 'Pre-submission file check' + 'IN REVIEW' chip, note + 'Supervised by Stonebridge Network.'; 2-col checklist of supervision items (pass = filled emerald checkCircle; pending = amber clock — the gift letter).
- Cards (mono uppercase headers): **'Disclosure — issued at first contact'** (right chip 'MCOB 4.4A'; rows with 'ISSUED') · **'Identity verification'** (fingerprint rows, method + date, 'Passed') · **'AML screening'** (right 'SmartSearch'; 3 emerald tiles Sanctions/PEP/'Adverse media' = Clear) · **'Vulnerability assessment'** ('No vulnerability identified' + Consumer-Duty note, 'Assessed') · **'Client declaration'** ('Fact-find accuracy declaration', 'Signed') · **'Consumer Duty — outcomes'** (4 pillar tiles with checkCircles).
- Footer bar: 'All checks pass except the gifted-deposit letter. Submit for network sign-off once received.' + primary 'Submit for sign-off' (toast 'Sent to Stonebridge for compliance sign-off').

## 4.16 Comms (comms.jsx) — unified email · WhatsApp · portal

Header 'Communications' / 'All channels with Aisha & Daniel · unified & logged' + filter pills All/Email/WhatsApp/Portal.
- Thread: **EmailMessage** = full card (sender header with avatar + subject + 'EMAIL' chip + time; pre-line body; paperclip attachment chips). **BubbleMessage** = chat bubble — outbound emerald/white right-aligned (rounded-br-md); inbound white-bordered; portal inbound violet-tinted; meta line = channel icon + '{channel} · {when}' + delivered ✓.
- **Inline AI suggestion** under Daniel's unread portal message (m4): violet card — "**Daniel's worried about his new job.** Halifax (recommended) accepts from first payslip — I can reassure him." + 'Draft reply →' → fills the composer (portal channel) with a complete warm reassurance draft ("…assesses your income from your first payslip, so starting in January is fine… 👍"), toast 'AI drafted a reply'.
- **Composer**: channel pills (email/whatsapp/portal; active gets channel tint) + right '✨AI draft'; textarea (4 rows for email, 2 otherwise) `placeholder "Message via {channel}…"`; footer paperclip + mono 'via {channel}' + 'Send' (toast 'Message sent & logged').
- **AutomationsRail** (right, 300px): 'DOCUMENT CHECKLIST' card grouped Aisha/Daniel/Joint — received = strikethrough + emerald check; partial = amber clock + note '1 of 3 received'; pending = slate clock; requested = violet sparkles + 'Auto-requested today'. Below: emerald audit note 'Every message — email, WhatsApp and portal — is logged to the case audit trail.'

## 4.17 New case overlay (newcase.jsx) — case from raw material

Full-screen `z-[100]`. Header: Logo + 'New case' + 'LENDMIND INTAKE' chip + **phase pips 'Source → Read → Review'** (numbered circles: done emerald ✓ / active violet / todo slate, joined by lines) + close ×.
- **Phase 1 Source** (`NewCaseIntake`): centered — '✨NEW CASE · AI INTAKE' chip, h1 'How did this lead come in?', sub "Drop the raw material — call notes, an email, a voice memo, agent particulars — and Lendmind will read it, build the case, and surface what's missing. No 8-step form." Free-intent input 'Or just describe the case in a sentence…' + 'Read this'. 4 `SourceCard`s (§3.24). Picking shows the raw material in a preview card ("Lendmind will extract applicants, property, money, flags — with citations to this material." + '✨Read this'). Trust strip: '🛡 No 8-step form · 🔗 Every field cites its source · ⚡ Adviser approves before anything sends'.
- **Phase 2 Read** (`NewCaseExtracting`): 2/5 source pane ('SOURCE · {kind}') beside 3/5 '✨LENDMIND IS READING…' pane — the 24 extraction fields stream in, CSS-staggered 35ms apart (`step-in` keyframe), each row = SourceDot(det/syn) + key + value (missing → amber) + flag/beaker icons. Auto-advances ~1.4s.
- **Phase 3 Review** (`NewCaseReview`): dark hero — '✨ HERE'S WHAT I HEARD' + 'Priya Bhatt & Jordan Adebowale — joint home mover, £495k in Walthamstow, 5-yr fix, DIP this week.' + 'Built from 1 email + 1 call note in 1.4s. 24 fields extracted · 2 missing · 4 flags raised. Approve to open the case stream.' + legend '22 verified ●emerald / 2 synthesized ●violet / 2 missing ●amber'. Left: extraction groups; each `ReviewField` row is clickable → **per-field reasoning trace** (claim '{k}: {v}', subject 'Synthesized — adviser confirms' or 'Verified — pulled from source', working cites the exact quote, calibration by conf: ≥.9 'High confidence — verbatim or near-verbatim from source.' / ≥.7 'Medium — synthesized; review recommended.' / else 'Low — please confirm or fill in.'). Right: 'FLAGS RAISED · 4' amber card · **"I'LL DO NEXT · AUTO"** violet card (4 queued actions + 'Nothing sends without your approval.') · 'STILL MISSING' card ('Property tenure (probably freehold for E17 terraced)' · 'Mortgage term — 25/28/32 years?' + "I'll ask Priya in the welcome message."). Sticky bottom bar: 'Open the case and start the stream' / "I'll send the portal welcome to Priya, request the docs, and run sourcing in the background." + 'Edit fields' / '✨Open case' → opens `cnew` on its stream (toast 'Case opened · Priya & Jordan').

## 4.18 Client portal (portal.jsx) — Aisha's consumer surface

- **Tracker (Progress)**: dark-ink `rounded-3xl` hero — 'HI AISHA · YOUR APPLICATION · 8 BROOKFIELD AVENUE' / h1 'Finding your mortgage' / "Eleanor is comparing every lender to get you the best deal. We'll let you know the moment there's an update — no need to chase." + emerald 52% bar. Amber action card '1 document to sign' ('Gifted deposit letter for your mum to confirm the £2,000 gift') + 'Review & sign'. Emerald confirmation card 'You confirmed your details are accurate' ('Fact-find declaration e-signed · 3 Jun'). 'YOUR JOURNEY' vertical timeline of PORTAL_STEPS (done emerald ✓ / active pulsing blue + 'IN PROGRESS' chip / todo slate). **AdviserCard**: EV avatar, 'Eleanor Vance / Your mortgage adviser · Meridian Mortgages' + chat button.
- **Details**: framed chat panel — violet header 'Complete your details' / 'Guided by Lendmind · pre-filled from your documents' / '● ~6 min'. INTAKE conversation: AI bubbles (Logo avatar, bold-markdown text, emerald confirm cards) vs user ink bubbles; chip answers; completing shows 'Details confirmed / Sent to Eleanor · 92% complete'.
- **Documents**: dark hero 'Your documents' / 'A few things still to send — drag them in or snap a photo. We'll read them automatically.' Groups 'You (Aisha)' / 'Daniel' / 'Together'; rows with status tiles — Uploaded (emerald) / In progress (amber clock) / Needed (slate upload, 'Upload' button) / To sign (violet signature, 'Sign' button). Upload toast: "Thanks! We'll read it automatically."
- **Messages**: chat with Eleanor — header '● Usually replies within an hour'; blue outbound bubbles; round send button; toast 'Sent to Eleanor'.

## 4.19 First-time intake (intake.jsx) — Priya's onboarding

- **IntakeWelcome**: violet→emerald gradient full screen; Logo; 'LENDMIND FOR MERIDIAN MORTGAGES'; h1 'Welcome Priya & Jordan.'; "Eleanor's briefed me after your call. I'll get you both set up in about **8 minutes** — no 12-step form." Four promise rows: 🛡 "I read what Eleanor wrote down so you don't repeat yourself" · ✨ "I'll only ask what's genuinely missing" · 👁 'Every field shows where it came from — confirm or correct' · 🔒 'Nothing reaches a lender until Eleanor approves it'. Ink 'Get started →'; footer 'Eleanor Vance · FRN 924817 · Meridian Mortgages'.
- **IntakeFlow**: header — Logo + 'Your application' + **fact-based progress bar** (pct = confirmed facts + uploads / total) + 'Adviser view' escape. Script plays per §3.25: AI bubbles with 'PRE-LOADED FROM CALL NOTES' provenance chips and emerald confirm cards; user replies via **violet chip answers** (+ dashed 'Type it' fallback); statement-only bubbles auto-advance (600ms); upload phase renders `DocSlot`s (dashed → emerald 'Read — fields auto-filled' when uploaded; caption "Drag in, snap a photo, or pick from files — we'll OCR them."); completion summary card 'All set · fact find 91% complete' + 'See what Eleanor sees →'.

---

# 5. Interaction & AI patterns

**These are the product's soul — preserve them exactly.**

1. **Epistemology on every value (det/syn)**. Every field, state-pane row and DIP mapping carries `src:'det'|'syn'` → emerald vs violet `SourceDot`/`EpistemologyTag`. Deterministic = lifted verbatim from a document (hint names it: 'Passport', 'P60', 'Contract · payslip'). Synthesized = inferred/computed ('Basic + 50% OT', 'Same as applicant 1') and *always framed as needing review*. Counts are surfaced ('25 deterministic · 6 synthesized · 2 await your confirmation'; '22 verified / 2 synthesized / 2 missing').

2. **Why? everywhere → ReasoningDrawer**. Any AI claim — a stat, a recommendation, a rejection, a single extracted field — opens the same trace anatomy: **claim → subject → numbered working → cited evidence chips (criteria/field/document/policy/calc, with verbatim quotes + source refs like 'Halifax criteria · Section 4.2 v24.6', 'Page 1, line 18') → alternatives considered → calibrated confidence bar + calibration sentence**. Confidence is honest: conflict detection .78 ('resolution requires adviser judgement'), arithmetic .97 ('pure arithmetic against deterministic fact-find inputs'), new-case first pass .78 ('Preliminary — will firm up when docs land'). Drawer footer offers 'Redirect' / 'Accept'.

3. **Human-in-the-loop grammar** — what's auto vs needs approval:
   - *Auto (labeled '✨automated'/'auto')*: document classification/extraction/attribution, fact-find building, sourcing re-runs, criteria/AML re-checks, document requests & chases (with scheduled auto-chase times), retention monitoring & case auto-open, digest suppression of immaterial changes.
   - *Approval-gated*: sending anything to a client ('Drafted… awaiting your approval'; 'Nothing sends without your approval.'), fact-find confirmation of synthesized fields, conflict resolution (explicit option buttons 'Confirm £38,500' / 'Use payslip £37,300' / 'Ask client'), low-confidence (<0.85) or joint document attribution ('Confirm'), product selection, DIP submission ('You can watch and approve before submission'), compliance sign-off, adviser policy overrides ('Rescued via adviser override… — flag for compliance').
   - *Consumer promise*: 'Nothing reaches a lender until Eleanor approves it.'
   - *Materiality*: sub-threshold updates are suppressed and counted ('Suppressed 14 low-confidence updates as not material'; '< 0.75 confidence… queued instead'), '1% materiality threshold' for salary variance.

4. **Directives as first-class objects**. The Intent bar (⌘K) turns plain English into tracked stream entries with status (`live`/`ready`/`thinking`), an eta, a result body and a full trace — never just a toast. Slash commands are the nav.

5. **The stream replaces tabs**. A case is a chronological agent feed: Live threads → Needs you → Your directives → Activity log, with a pinned live solver entry that "reflows the moment you change a constraint, the fact find moves, or a lender updates criteria". Deep views are demoted (Open-view pill, `/commands`).

6. **Arguable model, not results table**. The Solver exposes inferred constraints as chips (locked vs clearable), accepts NL edits, keeps an audit **trail** of edits, shows rejections *with the exact criterion cite that killed them*, supports adviser overrides that are compliance-flagged, and offers counterfactual advice ('Wait 1 month to re-source — Daniel's tenure crosses 6 months on 6 Jul').

7. **Cross-document conflict detection**: doc insights carry `conflict`/`flag`/`good`; conflicts propagate to the fact-find field (`conflict:true`), a Worklist card, a stream conflict entry with resolution buttons, and criteria warnings — one fact, five surfaces, single source of truth.

8. **Zero rekeying, visibly**: the DIP overlay performs side-by-side source→lender-portal field mapping with a typing caret, provenance dots on every mapped value, and an approve-before-submit gate.

9. **Evidence-of-research is a product object**: immutable snapshot (ref, generated-at, rates-as-at, lenders scanned), full considered-products table incl. declines with reasons, auto-recorded rationale, MCOB 4.7A suitability report, disclosure bundle — 'Retained for 3 years · reproducible for compliance & FCA review'.

10. **Retention as revenue automation**: radar watches fixed-rate end dates (6-month horizon; <90 days = urgent), auto-opens remortgage cases ('so you don't miss the product-transfer window'), pushes into Today and client profiles.

11. **Channel intelligence & tone**: outreach picks the channel by historical reply rate (WhatsApp 4/4 vs email 0/2), routes third-party requests through the client as conduit (with a cited internal policy), tone-matches threads, and logs *every* channel to the audit trail.

12. **Client-facing = confirm, don't ask**: conversational intake pre-loaded from adviser notes/documents, provenance chips ('Pre-loaded from call notes'), emerald confirm cards, chip replies, fact-count progress, time promises ('about 8 minutes'), and a delightfully human tracker ('Get the keys').

13. **UK-mortgage domain logic embedded** (keep precise): LTV tiers (85% band, 90% max), LTI caps 4.49× standard / **Nationwide 5.50× FTB enhanced ≥ £37k**, income consideration rules (basic + 50% overtime; Santander won't count OT under 12 months), probation/tenure rules per lender (Halifax from first payslip; Nationwide teachers day-one; Skipton 6 months; Barclays 12 months; Coventry excludes probation), gifted deposits (parental gift acceptable with signed non-repayable letter, donor retains no interest; NatWest direct-family-only), self-employed evidencing (2 years' accounts, salary+dividends), inheritance deposits (grant of probate), stress testing (+3pp PRA floor; SVR reversion 8.49%), 'true cost' ranking (rate + fees − cashback/incentives over the fix), FCA furniture (MCOB 4.4A/4.7A/5A ESIS, IDD, Consumer Duty four outcomes, ID&V + SmartSearch AML, vulnerability assessment, AR-network supervision, procuration-fee disclosure, 3-year retention).

---

# 6. Walkthrough narrative (tour.js) — the design intent in the authors' own words

The 13-chapter scripted tour drives the live app (`window.__lm` bridge, animated cursor, captions). Its captions are the best statement of intent:

1. **Welcome** — 'An AI-native mortgage adviser platform — complete feature walkthrough'.
2. **Today — exceptions first**: 'The agent works overnight; you review the exceptions' — 'No dashboard of vanity metrics.' · 'Every automated action is surfaced as a first-class object… not hidden in an audit tab.' · 'Proactive, not reactive — work appears before you go looking for it.'
3. **Trust calibration**: 'Every AI number drills into its working' — '"17 handled by AI" isn't a vanity stat — click it and the reasoning opens.'
4. **The case stream**: 'Tabs-as-nouns replaced by one agent stream' — 'Most mortgage CRMs bury a case behind eight tabs.'
5. **Intent bar**: 'Instruct in plain English — not just react' — 'Your instruction lands at the top of the stream as its own entry — with the agent's result and a reasoning trace, not just a confirmation toast.'
6. **Reasoning trace**: 'Show the working' — 'For mortgages the killer artifact is the model's working.'
7. **Sourcing solver**: 'A live constraint solver you argue with' — 'Rejections are explained, not hidden.'
8. **Why this product**: 'Defensible recommendation — the top pick isn't a black box.'
9. **Deep views**: 'The tabs still exist — demoted to deep views, not the primary nav… one keystroke away — it just no longer dictates the shape of the workspace.'
10. **State pane**: 'Always-on context — pinned facts with provenance… each value dotted by source: verified vs. synthesized.'
11. **New case from raw material**: 'No 8-step form — drop the raw lead' → 'A cited diff to review — then approve' → 'It lands as a live stream… the work has started before you've typed a word.'
12. **Client portal intake**: 'A conversational intake, pre-filled — the client doesn't face a blank form… Confirm, don't re-type.'
13. **Recap**: 'AI-native, end to end — exceptions-first inbox · instruct in plain English · cited reasoning on every claim · a live sourcing solver · cases built from raw material · a portal that confirms instead of asks.'

---

## Appendix — file map of the export

| File | Exports (window.*) | Contents |
|---|---|---|
| index.html | — | Tailwind config (palette/fonts/radius/shadows/keyframes), global CSS, script load order |
| icons.jsx | Icon | ~70-path outline icon set |
| data.jsx | LM (all domain data) | §3 |
| ui.jsx | cx, Logo, Avatar, AvatarStack, PipelineBadge, CompletenessRing, EpistemologyTag, SourceDot, SectionCard, InlineField, StatusPill, PILL, Button, StepDots, Toast | §1.5 |
| main.jsx | AppContext, useApp | App shell, TacticalRail, routing state, TourBridge |
| reasoning.jsx | ReasoningDrawer, WhyPill, EvidenceChip | §4.7 |
| intent.jsx | IntentBar, INTENT_RUNS | §4.5, §3.23 |
| stream.jsx | CaseStream, StatePane, STREAM_KIND | §4.6, §3.22 |
| solver.jsx | SolverTab | §4.11, §3.13 |
| today.jsx | Today, KIND_META, WorklistCard, caseClients | §4.1 |
| cases.jsx | Cases, peopleFromNames | §4.2 |
| clients.jsx | Clients, ClientProfile | §4.3 |
| case.jsx | CaseWorkspace, NotesPanel | §4.4 |
| factfind.jsx | FactFindTab | §4.8 |
| documents.jsx | DocumentsTab | §4.9 |
| sourcing.jsx | SourcingTab | §4.10 |
| evidence.jsx | EvidenceTab | §4.13 |
| dip.jsx | DipOverlay | §4.12 |
| application.jsx | ApplicationTab | §4.14 |
| compliance.jsx | ComplianceTab | §4.15 |
| comms.jsx | CommsTab | §4.16 |
| newcase.jsx | NewCaseOverlay (+ injects priya/jordan/cnew) | §4.17, §3.24 |
| portal.jsx | Portal | §4.18 |
| intake.jsx | IntakeFlow, IntakeWelcome | §4.19, §3.25 |
| tour.js | LMWalkthrough | §6 |
