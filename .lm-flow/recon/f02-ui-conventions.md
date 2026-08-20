# F02 UI Conventions Recon — crm-shell-and-primitives

> Persisted from Explore agent output, 2026-08-20. Full detail in agent report; this is the working copy.

## 1. Routing + shell
- Routes: one flat <Routes> in src/routers/index.tsx, lazy() imports, ProtectedRoute gates on getAionBackendState().kind === 'ready'.
- Add /crm as lazy import + Route INSIDE ProtectedRoute but SIBLING to <Route element={<Layout/>}> — own CrmLayout shell (Layout bolts on TopBar/HistorySidebar and blanks until backend ready; wrong chrome for CRM).
- Rail precedent: src/components/ProjectPageSidebar/ + NavTab.tsx — workspaceTabButtonClass(active), WORKSPACE_TAB_LABEL_CLASS, PROJECT_SIDEBAR_FOLD_SPRING {type:'spring',stiffness:380,damping:38,mass:0.85}, rail width 48px folded. TacticalRail copies structure, drives active from useLocation()/NavLink.
- Tab-nav precedent: src/components/Dashboard/HistoryTabsNav.tsx (const id array + type guard + framer-motion sliding underline + ResizeObserver).
- Notification dot: bg-ds-text-status-error-strong-default (attention) / bg-ds-bg-brand-default-default.
- Aside shell class: 'box-border flex h-full min-h-0 w-full min-w-0 shrink-0 flex-col items-start overflow-hidden rounded-2xl bg-ds-bg-neutral-default-default p-1'.

## 2. ds-* usage
- Class shape {utility}-ds-{element}-{tone}-{emphasis}-{state}; icons colored via text-ds-icon-*; cn()=twMerge(clsx) from @/lib/utils.
- CVA pattern (button.tsx canonical): variants map to EMPTY strings; real classes in compoundVariants fed by module-level Record<Tone,string> constants; resolve fn maps public (variant,tone,emphasis) to internal; data-slot/data-variant/data-tone attrs; mergeAliasStyles(buttonTokenAliases, style).
- tag.tsx = best model for Lendmind pills: 3-D matrix Record<UiVariant, Record<Tone, Record<Emphasis, string>>>, pill radii, sizes xxs–lg with [&_svg]:size-[N] injection; normalizeTagTone maps info→information, caution→error, default→neutral.
- card.tsx unopinionated (rounded-xl border only; callers supply tone; padding rhythm p-3).
- semanticProps.ts: UiVariant primary|secondary|outline|ghost; UiEmphasis subtle|muted|default|strong|inverse; UiTone ONLY neutral|success|error|information|warning → CRM stage tones need own union (CrmTone), or standalone cva components (don't extend Tag's UiTone).
- tokenAliases.ts only needed for legacy component vars — NOT needed for new ds-* primitives. formFieldSurface.ts owns h-7/h-6 field rhythm.
- HomeHubItemShared.tsx (HomeHubToneTag etc) = the wrapper-around-Tag pattern for PipelineBadge/StatusPill.
- WorkFlow/agents.tsx agentMap = per-identity color bundle precedent (avatar tints).

## 3. Tones (22, all with full bg/text/border/icon/ring × 5 emphasis × 6 states)
neutral, brand, status-running, status-splitting, status-pending, status-error, status-reassigning, status-completed, status-blocked, status-paused, status-skipped, status-cancelled, single-agent, workforce, browser, terminal, document, success, caution, error, warning, information.
- NEVER concatenate ds class names (only neutral is safelisted; JIT scans literals) — use full literal strings in Record maps.
- No 'transparent' emphasis utilities. 14 tones have hand-authored ramps (ten status-* + success/error/warning/information) with verified contrast.
- Anchors (light): status-pending #64748b slate · status-splitting #0ea5e9 sky · status-running/information #3b82f6 blue · terminal #14b8a6 teal · status-completed/success/workforce #10b981 emerald · status-reassigning/warning/caution/document #f59e0b amber · status-blocked #f97316 orange · status-error/error #ef4444 red · single-agent #7c3aed violet.
- Stage ramp: LEAD→status-pending, FACT_FIND→status-running, SOURCING→status-splitting, DIP→single-agent, APPLICATION→terminal, VALUATION→status-reassigning, OFFER→warning(amber)/brand, COMPLETION→status-completed. (Adjusted from agent's suggestion to match design hue order: slate→blue→indigo→violet→purple→fuchsia→amber→emerald; nearest available tones.)
- EpistemologyTag/SourceDot: det→status-completed (emerald #10b981 exact design match); syn→single-agent (violet, already means "AI" in this codebase).
- StatusPill: pass→status-completed, fail→status-error, warning→warning, info→information.
- CompletenessRing ramp: ≥80 status-completed / ≥50 status-running / ≥25 warning / else status-skipped.
- Status chip precedents: ChatBox/TaskBox/TaskType.tsx (textColor/bgColor/dotColor map), TaskState/index.tsx (group-hover promotion), ChooserTab.tsx:119 (live pulse dot: animate-pulse rounded-full bg-ds-bg-status-running-default-default).

## 4. Icons
lucide-react ^0.548.0, named imports; parent primitives size via [&_svg]:size-*; ad-hoc h-4 w-4; color text-ds-icon-*; aria-hidden decorative. animate-ui/icons/ has 12 framer-motion icons incl. sparkle.tsx (for ✨Why?/AI affordances).

## 5. Storybook
Root .storybook/ (SB10, react-vite; addon-docs + addon-a11y; autodocs; forced light theme; layout centered). Stories at src/stories/ui/*.stories.tsx, title 'UI/<Name>' (use 'CRM/<Name>'), license header, argTypes selects, AllVariants/AllSizes matrix stories. preview.tsx loads only Inter — ADD jetbrains-mono @fontsource imports if primitives use font-mono. *.stories.tsx exempt from color gate.

## 6. i18n
One merged translation bundle; namespaces = top-level JSON objects. Adding 'crm': create src/i18n/locales/<locale>/crm.json + index import, in ALL 11 locales, identical flat kebab-case key sets (bidirectional parity gate compares keys only — English placeholder values pass). Usage t('crm.today'). Gate: npm run check:i18n (not in lint; CI runs it).

## 7. Avatars/progress
- NO Avatar component exists; AvatarStack greenfield (agentMap color-bundle precedent; ring-2 overlap idiom available).
- progress.tsx = Radix linear (legacy non-ds colors); progress-install.tsx shimmer. NO circular ring — CompletenessRing greenfield: SVG stroke var(--ds-bg-status-completed-default-default) style (inline var() passes gate) or currentColor + text-ds-* wrapper; track var(--ds-bg-neutral-strong-default).

## 8. Fonts
@fontsource inter/jetbrains-mono/playfair-display loaded in src/main.tsx. Tailwind families: font-sans(Inter), font-mono(JetBrains), font-serif/font-display(Playfair). `.font-kicker` in src/style/index.css IS the mono micro-label convention (10px, 500, .14em tracking, uppercase, --ds-text-neutral-subtle-default) — USE IT, don't reinvent. Root font 14px; radii capped (2xl=12px) — design's 20px radii become rounded-2xl. Outfit NOT available: use Inter semibold tracking-[-0.02em] for CRM headings, font-display only for welcome-headline moments.

## Gates for F02
lint (eslint + token-usage + no-legacy-backend + no-dead-brain) · type-check · check:i18n · check:design-tokens · vitest baseline · license headers · .lm-flow gitignored.
