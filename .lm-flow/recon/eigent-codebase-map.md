# Eigent/Eternyl codebase map (branch `lendmind-crm`)

> Produced by codebase recon, 2026-08-20. Feeds the Lendmind CRM roadmap and per-feature architecture docs.

## 0. What this repo is

A fork of `eigent-ai/eigent`, rebranded **Eternyl**, whose local Python agent runtime has been **removed entirely**. The desktop is a pure client over one authenticated HTTP/SSE surface — the **aion Eigent edge API** (`/eigent/v1`). Source of truth: `README.md` (lines 1–92, "Architecture" and "What differs from upstream").

Key consequence for a CRM build: **there is no backend in this repo**. Every AI capability is a call to the aion edge. Two lint gates enforce it: `scripts/check-no-legacy-backend.mjs`, `scripts/check-no-dead-brain-calls.mjs`.

---

## 1. App architecture

### Entry points
- `src/main.tsx` — React root. Loads Inter / JetBrains Mono / Playfair Display from `@fontsource` (bundled, never a CDN), creates the host (`createHost()`), injects it into `chatStore`, picks `BrowserRouter` (web build) vs `HashRouter` (Electron), wraps in `ThemeProvider` → `TooltipProvider` → `App`.
- `src/App.tsx` — providers: `QueryClientProvider` (`src/lib/queryClient.ts`), optional `StackProvider`/`StackTheme` (`@stackframe/react`, vendored at `package/@stackframe/react`, gated by `hasStackKeys()`), `Toaster` (sonner). Subscribes to Electron update notifications.
- `electron/main/index.ts` — ~2700 lines: windows, 53 IPC handlers, protocol handlers, webview partitions, startup.
- `electron/preload/index.ts` — the renderer's only bridge.
- `index.html`, `vite.config.ts` (Electron build), `vite.config.web.ts` (web build).

### Routing
**react-router-dom v7**. Route table is one file: `src/routers/index.tsx`.

| Path | Element | Guard |
|---|---|---|
| `/integration-lab` | `src/pages/IntegrationLab/index.tsx` | none (diagnostics) |
| `/onboarding` | `src/pages/Onboarding/index.tsx` | none (mints the credential) |
| `/` | `src/pages/Workspace.tsx` | `ProtectedRoute` → `Layout` |
| `/history` | `src/pages/History.tsx` | `ProtectedRoute` → `Layout` |
| `/setting`, `/setting/*` | redirect → `/history?tab=settings` | — |
| `*` | `src/pages/NotFound.tsx` | none |

`ProtectedRoute` is **not** a user-login guard: "signed in" == `getAionBackendState().kind === 'ready'`, i.e. the main process resolved an edge base URL + API key. Anything else redirects to `/onboarding`.

**The real navigation is query-param driven, not path driven.** `/history?tab=<id>&section=<id>` is the app's whole "settings/console" surface. Tab ids in `src/components/Dashboard/HistoryTabsNav.tsx` (`HISTORY_TAB_IDS`): `home`, `agents`, `channels`, `connectors`, `browser`, `settings`. Aliases in `History.tsx`: `mcp_tools`→`connectors`, `projects`/`spaces`→`home`. Tabs mount once and stay mounted (hidden) so lists don't refetch.

Shell chrome: `src/components/Layout/index.tsx` (Outlet + `TopBar` + `HistorySidebar` + install/close dialogs; hydrates Spaces from aion on mount via `hydrateSpacesFromAion()`).

### State management — zustand (v5), ~25 stores in `src/store/`
Two families.

**Local app state (large, legacy-derived):**
- `chatStore.ts` (55 KB) — per-chat vanilla store instances; message list, task lifecycle, SSE bookkeeping, file lists. Exports `createChatStoreInstance`, `hasActiveSSEConnection`, `hasAnyActiveRun`, `closeSSEConnectionsForTasks`.
- `projectStore.ts` (46 KB) — Projects, per-project chat-store registry, queued messages, per-project model selection, nav leads. `ProjectMode = 'single-agent' | 'workforce'`, `ProjectWorkdirMode = 'worktree' | 'copy' | 'direct-write' | 'artifact-only'`. Tested: `projectStore.test.ts`.
- `spaceStore.ts` (28 KB, persisted `eigent-space-store`) — Spaces (the top-level grouping), project↔space index, `aionSpaceId` mirror. Tested: `spaceStore.test.ts`.
- `pageTabStore.ts` (38 KB, persisted) — workspace tabs + the **session preview tab model** (`browser | file | artifact | terminal | review | canvas | chooser`).
- `authStore.ts` (persisted), `globalStore.ts`, `sidebarStore.ts`, `installationStore.ts`, `projectRuntimeStore.ts`, `workflowViewportStore.ts`, `skillsStore.ts`.

**aion edge mirrors (`aion*` prefix):**
`aionChatBridge.ts` (50 KB — the core), `aionAccountStore`, `aionArtifactsStore`, `aionCommentsStore`, `aionConnectorsStore`, `aionLocalBrowserStore` (persisted), `aionMemoryStore`, `aionModelStore` (persisted), `aionProjectsStore`, `aionSchedulesStore`, `aionSkillsStore`, `aionSpaceBinding`, `aionSpacesStore`, `aionUsageStore`, `browserDelegationExecutor.ts`.

Persistence is **zustand `persist` → localStorage** only (`aionLocalBrowserStore`, `aionModelStore`, `authStore`, `globalStore`, `skillsStore`, `pageTabStore`, `spaceStore`). Plus ad-hoc `localStorage` keys (`eigent-home-sidebar-width-px` in `Workspace.tsx`, `SYNC_UP_SNAPSHOT_KEY` in `aionSkillsStore.ts`).

### API layer
Single seam: `src/api/aion/v1/`.
- `transport.ts` (910 lines) — the **only** remote in the app. Policy-free: REST + SSE, bearer API key, RFC 9457 problems. `newIdempotencyKey()`; `submitCommand`'s idempotency key *is* the `command_id`.
- `session.ts` (234 lines) — `ProjectSession`: bounded exponential reconnect from last acked cursor, `cursor_expired` → full snapshot rehydrate, idempotent command retry. `SessionStatus = idle|connecting|live|reconnecting|rehydrating|stopped|failed`.
- `reducer.ts` (942 lines) — pure event fold → `ProjectUIState`. All UI state derives from here.
- `problems.ts`, `compat.ts`, `contracts.ts`, `gen/edge-api.ts` (4033 lines, generated), `gen/meta.ts`, `contract/` (byte-exact mirror).

**IPC** (`host.ipcRenderer` / `host.electronAPI`, abstracted by `src/host/`): 41 unique channels. Notable for a CRM: `select-file`, `read-file`, `read-file-dataurl`, `download-file`, `delete-folder`, `reveal-in-folder`, `get-project-list`, `open-external`, `open-mailto`, `get-email-folder-path`, `terminal-dispose`, `agent-browser:execute|status|take-control`, `get-aion-transport-config`, `set-aion-api-key`, `clear-aion-api-key`, `env-write`/`env-remove`/`read-global-env`, `check-update`/`start-download`/`quit-and-install`, window controls.

**No WebSocket.** Realtime = SSE only (`GET /projects/{id}/events`, `@microsoft/fetch-event-source` is a dep).

Host abstraction: `src/host/createHost.ts` is the only place that reads `window`; `src/client/platform.ts` gives `isElectron()/isDesktop()/isWeb()` and a `ClientType` union that already anticipates `cli | browser_extension | whatsapp | telegram | slack | discord | lark`.

---

## 2. Existing pages / features

### `/` — `src/pages/Workspace.tsx` (728 lines)
The main working surface. Resizable 2-column shell (`react-resizable-panels`): `ProjectPageSidebar` (fold spring, width persisted) + main area, which renders `SessionGroup`/`Session`, the `Workspace` agent-canvas, `Folder`, `AionTriggersPanel`, plus the always-mounted `PreviewBrowserLayer` (fixed-position Electron webview guests) and five decorative background variants (`src/components/Background`). Uses `ReactFlowProvider` (`@xyflow/react`) for the workforce graph.

### `/history` — `src/pages/History.tsx` (187 lines)
Container for six tabs. Renders `WelcomeHeadline`, sticky `HistoryTabsNav`, then mounted-once tab panes.

- **`home`** → `src/pages/Home/index.tsx` (HomeHub). Sections `spaces | projects | triggers | usage`; `usage` is aion-only. Sub-pages: `Spaces.tsx`/`AionSpaces.tsx`, `Projects.tsx`/`AionProjects.tsx`, `Triggers.tsx`/`AionTriggers.tsx`/`AionTriggersPanel.tsx`, `AionUsage.tsx`. Shared presentation kit in `Home/components/`: `HomeHubBoard`, `HomeHubBoardCard`, `HomeHubCard`, `HomeHubGrid`, `HomeHubListItem`, **`HomeHubListTable`** (grid-based list view with per-kind column defs), `HomeHubToolbar` (search/sort/view-mode). Data hooks in `Home/hooks/`: `useAionProjects`, `useAionSpaces`, `useAionSchedules`, `useAionUsage`, `useAionArtifacts`, `useHomeHubCounts`, `useHomeHubProjects`, `useHomeHubNavigation`, `useSpaceLabel`.
- **`agents`** → `src/pages/Agents/index.tsx`. Two sections only: **Skills** (`Skills.tsx` + `components/SkillListItem|SkillUploadDialog|SkillSyncUpDialog|SkillDeleteDialog`) and **Memory** (`Memory.tsx` + `useAionMemory.ts`). The model catalog and subagent roster editors were deleted — they are the operator's, resolved from the edge.
- **`channels`** → `src/pages/Channels/index.tsx` (90 lines). **Stub.** `overview | whatsapp | lark`, all "coming soon". This is the obvious hook point for CRM inbound channels.
- **`connectors`** → `src/pages/Connectors/index.tsx` (302 lines) + `useAionConnectors.ts`. Read-only catalog of operator-registered integrations with connect/disconnect via OAuth (`/connectors/{id}/auth`, `/connectors/{id}/grant`). Four distinct states rendered separately.
- **`browser`** → `src/pages/Browser/index.tsx` + `Extension.tsx`. Nearly empty (extension placeholder); cookie jar and CDP pool were removed.
- **`settings`** → `src/pages/Setting/index.tsx` + `Account.tsx` (`useAionAccount.ts`), `Appearance.tsx`, `General.tsx`, `Privacy.tsx`.

### `/onboarding` — `src/pages/Onboarding/index.tsx` (190 lines)
Single-purpose: paste an aion edge API key. Verifies against `/account` **before** storing (`verifyAndStoreAionApiKey` in `aionAccountStore.ts`), then hands it to the main process. Never persisted in the renderer. Distinguishes "no endpoint configured" / "endpoint unresolvable" from "needs key".

### `/integration-lab` — `src/pages/IntegrationLab/index.tsx` (617 lines) + `evidence.ts`
Diagnostics: exercises the edge seam and emits evidence. Deliberately outside the guard.

### Session / ChatBox — the agent-run experience
`src/components/Session/index.tsx`: header + chat column (left, resizable 360–680 px) + a **mode-dependent side panel** chosen from `Project.mode`.

- `HeaderBox/` — `index.tsx`, `ChatTimeline.tsx`
- `SessionSidePanel.tsx` + `SidePanelSections/`: **`PlanSection.tsx`** (the run's own todo tree from `todo_created|todo_updated|todo_closed` events, nested checklist, evidence refs clickable straight into the artifact viewer — `buildPlanRows.ts`), `ProgressSection.tsx`, `AgentPoolSection.tsx`, `AgentFolderSection.tsx`, `ExecutionContextSection.tsx` (`buildContextItems.ts`, `useProjectOutputFiles.ts`, `collectSidePanelOutputFiles.ts`), `primitives.tsx`.
- `SingleAgent/` and `Workforce/` (`WorkforceSidePanel`, `FoldedPanel/AgentDetailPane`, `ExpandedOverlay`) — the two side-panel modes.
- **`PreviewPanel/`** — tab strip + content router. Tab kinds registered in `tabKinds.tsx` (`PREVIEW_TAB_KINDS`): `browser`, `file`, `artifact`, `terminal`; `review` and `canvas` are wired but hidden from the chooser. Tabs: `tabs/browser/BrowserTab.tsx` + `PreviewBrowserLayer.tsx` + `webviewRegistry.ts`; `tabs/FileTab.tsx`; **`tabs/artifact/`** — `ArtifactTab.tsx`, `ArtifactViewer.tsx` (Markdown via `MarkDown`, code + **diff** via lazy Monaco, HTML via `ArtifactHtmlPreview.tsx` under a CSP in `artifactCsp.ts`, download button), `CommentRail.tsx` + `commentAnchors.ts` (anchored comments that drive a revision turn), `artifactLanes.ts`; `tabs/terminal/` (xterm.js + node-pty, `ShellTerminal`, `XtermViewer`, `terminalSources.ts`, `terminalTheme.ts`).

`src/components/ChatBox/` (documented in its own `README.md`):
- `index.tsx` → `ProjectChatContainer.tsx` → `ProjectSection.tsx` → `UserQueryGroup.tsx` → `MessageItem/*`
- `MessageItem/`: `UserMessageCard`, `UserMessageRichContent`, `AgentMessageCard`, `MarkDown`, `NoticeCard`, `FeedbackCard`, `ApprovalCard`, `TaskCompletionCard`, `TaskWorkLogAccordion`, `ThinkingStrip`, `PreparingToExecuteTasks`, `SaveSkillDialog`, `FloatingAction`, `TokenUtils`
- `TaskBox/` + `TaskBox/PlanTaskBox/` (`ExpandedOverlay`, `FoldedView`, `StatusRow`, `SubtaskEditor`)
- **`ToolCards/`**: `ToolCardView`, `BashCard`, `BrowserCard`, `CodeCard`, `GenericCard`, `lanes.ts`, `monacoSetup.ts` — typed cards for live tool activity
- `BottomBox/` composer: `InputBox` (drag-drop + paste file attachments, `processDroppedFiles`/`processPastedFiles` from `src/lib/fileUtils.ts`), `RichChatInput`, `ModelSelect`, `ThinkingEffortSelect`, `ApprovalModeSelect`, **`LocalBrowserToggle`**, `QueuedBox`, `UsageLimitBanner`, `PickerPanel`
- `ArtifactCard.tsx`

---

## 3. Agent / AI infrastructure

**All agent execution is remote.** No Python, no local model, no legacy agent framework. Runs happen inside an aion session pod; the desktop only submits commands and folds the event stream.

### Run lifecycle
1. `startAionTask()` (`src/store/aionChatBridge.ts:513`) → `POST /projects/{id}/commands` (`submitCommand`) with `command_id` as the idempotency key. `StartAionTaskArgs` carries attachments (`attachment_ids`), `comment_ids` (comments the turn must address), `browser_execution` (`""|"pod"|"local"`) and `browser_session_mode` (`""|"isolated"|"logged_in"`).
2. `ProjectSession` opens SSE at `GET /projects/{id}/events`, cursor-resumable.
3. `reducer.ts` folds ~19 event kinds: `run_accepted`, `run_progress` (dispatch stages `dispatching|workspace_ready|starting`), `text_delta`, `tool_call`, `tool_result`, `tool_output` (live stdout/stderr chunks), `approval_required`, `approval_resolved`, `browser_delegation_requested`, `todo_created|todo_updated|todo_closed`, `artifact_created`, `artifact_comment`, `subagent_started|subagent_ended`, `run_recovery`, `run_completed|run_failed|run_cancelled`.
4. `aionChatBridge` projects that state into the legacy chat/workspace shapes: `buildTurnMessages()` (:766), `projectWorkerLanes()` (:1211), `projectToolLog()` (:1281), `projectBrowserView()` (:1144). Separate digests (`projectionDigest`, `planDigest`) prevent redundant store writes.
5. `stopAionTurn()` → `POST /projects/{id}/runs/{runId}/cancel`; `respondToAionApproval()` → `POST .../approvals/{id}/response`.

### Model config
No provider keys in the desktop. `getAionModelCatalog()` reads `GET /models` (aliases only); `resolveModelAlias()` (:238) picks one; `aionModelStore.ts` persists the choice; `src/lib/modelConfig.ts` + `useModelConfigCheck.ts` on the UI side. Codex subscription OAuth lives in `electron/main/subscriptionAuth/` (PKCE, credential store, resolver server) — a legacy path.

### Local browser agent (the "LB4" work)
The delegated-browser seam, contract 1.22.0 / ADR-023:
- `electron/main/agentBrowser.ts` — visible `WebContentsView` on the user's machine, deliberately outside `WebViewManager`. Emits the **same `browserCtlOut` JSON** as the pod-side `aion-browserctl`, so the model cannot tell where an action ran.
- `electron/main/agentBrowserVerbs.ts` — the pure half: `TOOL_ACTIONS` map, `actionForTool`, `parseActionArgs`, `checkUrlAllowed`, `visitPlan`, `typeFields`, `scrollPlan`, `historyPlan`, `formatSnapshot`, `mouseClickEvents`, `enterKeyEvents`, `buildTabs`, `windowTitle`, `scrubAgentUserAgent`, `TAKE_CONTROL_ERROR`, `WINDOW_CLOSED_ERROR`.
- `electron/main/agentBrowserScripts.ts` — injected page scripts (a11y snapshot, ref rects, focus/clear, select, console hook).
- `src/store/browserDelegationExecutor.ts` — renderer driver: one action at a time per project, POSTs each result to `/projects/{id}/browser-delegations/{id}/result` (Idempotency-Key, 202; late = 409 `delegation_not_pending`, never retried), completed-results LRU for replay. `LOCAL_BROWSER_WINDOW_CLOSED` is byte-pinned against main's copy by a parity test.
- `src/store/aionLocalBrowserStore.ts` (persisted) + `BottomBox/LocalBrowserToggle.tsx` + `probeLocalBrowserSupport()` (`aionChatBridge.ts:407`).
- Rehydrate surface: `GET /projects/{id}/browser-delegations?status=pending`.
- Pod browser artifacts render as a filmstrip: `projectBrowserView()` → `browser_agent` card; `src/components/BrowserAgentWorkspace/`.

### "Prebuilt agents"
Two distinct things, don't conflate them:
- **Legacy workforce roster** (display-only leftovers): `src/components/WorkFlow/baseWorkers.ts` — `developer_agent`, `browser_agent`, `multi_modal_agent`, `document_agent`, `social_media_agent`, each with a toolkit list. Also `WorkFlow/agents.tsx`, `agentToolkitLabels.ts`, `node.tsx`, `WorkforceMenu/index.tsx` (`agentMap` colours), `AddWorker/index.tsx`.
- **Real capability unit on aion = a Skill.** `resources/example-skills/`: `docx`, `pdf`, `pptx`, `xlsx`, `skill-creator`, `skill-security-auditor`, `default-config.json`. Managed via `/skills` (list/get/put/delete/status) through `aionSkillsStore.ts` + `skillsStore.ts` + `src/lib/skillToolkit.ts`, `skillZip.ts`. Skills execute in the aion cell.
- Actual runtime workers come from `subagent_started|subagent_ended` events → `WorkerState` → `projectWorkerLanes()`.

### Artifacts + comments
`aionArtifactsStore.ts`: `loadAionArtifacts` (paged, `?name=` for version history), `readAionArtifact` (`?inline=true`, ≤1 MiB text, else `content_truncated`), `grantAionArtifact` (presigned download URL), `loadAionArtifactVersions`, `noteAionArtifactsChanged`/`subscribeAionArtifacts` (event-driven, no polling).
`aionCommentsStore.ts`: `AionCommentStatus = 'open' | 'addressed' | 'dismissed'`; `createAionComment`, `setAionCommentStatus`. Anchored comments → `comment_ids` on the next `submitCommand` → the republishing run settles them.

---

## 4. Data persistence

- **No SQLite, no IndexedDB, no ORM in this repo.** `electron/main/copy.ts` only *copies* Chromium's `Local Storage` / `IndexedDB` partition dirs during profile migration.
- **Renderer:** zustand `persist` → `localStorage` (see §1). Space store key `eigent-space-store`, persist version 3, schema version 2.
- **Electron main:** `app.getPath('userData')` for the API key file (`aion-edge-api-key`, `electron/main/index.ts:95`), logs, session partitions (`persist:main_window`, `persist:user_login`), temp dirs (`eigent-pasted`, `eigent-captures`). Project workdirs via `electron/main/utils/projectStoragePath.ts`; file IO in `electron/main/fileReader.ts` (~1000 lines).
- **Server of record:** the aion edge. Spaces, Projects, artifacts, comments, schedules, memory, usage, skills, connectors, API keys all live there. Local Space/Project records carry an `aionSpaceId` mirror; `src/store/aionSpaceBinding.ts` + `hydrateSpacesFromAion()` reconcile them so a Space survives a new machine or cleared storage.
- **Sessions/projects/spaces model:** Space (grouping) → Project (durable conversation + its runs) → Run → Turn. `PUT|DELETE /projects/{id}/space` files/unfiles. Project sequence numbers are the SSE cursor.
- **Agent memory:** `/memory` plane (list, search, clear, get/put/delete by key, scoped) — `aionMemoryStore.ts`, surfaced at `?tab=agents&section=memory`.

---

## 5. Design system

- **14px root density scale.** `src/style/index.css:37-41` sets `font-size: 14px` on the root — "not the browser's 16. Every tailwind numeric utility (p-2, …)" scales off it. All spacing/radius/line-height CSS vars follow (lines ~271–330).
- **Token engine V2** — `src/lib/themeTokens/` (2338 lines), documented in `src/lib/themeTokens/README.md`:
  - `catalog.ts` — theme catalog; **`DEFAULT_THEME_ID = 'lendmind'`**, `DEFAULT_CONTRAST = 43`
  - `engine.ts` (1173 lines) — DTCG parse → `$extends` resolution → semantic generation over `tone × emphasis × state × element` → WCAG AA enforcement → APCA diagnostics → CSS var emission (`--ds-*`)
  - `verifier.ts` (407 lines) — the contract checker run by `pnpm verify:theme` (`scripts/verify-theme-tokens.ts`)
  - `colorMath.ts` (OKLCH), `dtcg.ts`, `naming.ts`, `types.ts`
  - Applied at runtime by `src/components/Layout/ThemeProvider.tsx` (`applyThemeContractV2`); dev handle `window.__eigentThemeV2`
- **Token sources** — `src/style/tokens/`: `base.color.json` (seeds), `semantic.color.json` (axes/transforms), `component.color.json` (aliases), `contracts/default.{base,light,dark}.json`, `manifest.json`.
- **Manifest drives Tailwind.** `tailwind.config.js` (39 KB) reads `tokens/manifest.json` and generates the `ds-*` colour map: elements `bg|text|border|icon|ring` × emphasis `subtle|muted|default|strong|inverse` × states `default|hover|active|selected|focus|disabled` × 22 tones (`neutral`, `brand`, `status-running|splitting|pending|error|reassigning|completed|blocked|paused|skipped|cancelled`, `single-agent`, `workforce`, `browser`, `terminal`, `document`, `success`, `caution`, `error`, `warning`, `information`). Hence class names like `bg-ds-bg-neutral-subtle-default`, `text-ds-text-neutral-muted-default`. Extends also cover `screens`, `boxShadow`, `spacing`, `borderRadius`, `fontFamily`, `fontSize` (`text-body-sm`, `text-heading-sm`…), `lineHeight`, `fontWeight`, `animation`, `keyframes`.
- **Gate:** `pnpm check:design-tokens` = `verify:theme` + `scripts/check-design-token-usage.mjs` (allowlist at `scripts/design-token-usage.allowlist`). Raw hex/arbitrary colours fail lint.
- **UI primitives** — `src/components/ui/` (Radix + CVA + `tailwind-merge`, shadcn-style; `components.json` present):
  `accordion, alert, alertDialog, badge, button, card, carousel (embla), checkbox, colorPicker, command (cmdk), dialog, dropdown-menu, input, input-select, label, menu-button, popover, progress, progress-install, resizable, select, separator, sheet, sidebar, skeleton, sonner, switch, table, tabs, tag, textarea, toggle, toggle-group, tooltip, HoverScrollText`, plus `formFieldSurface.ts`, `semanticProps.ts`, `tokenAliases.ts`, and motion kit `animate-ui/` (`icons/`, `primitives/animate/`), `ShinyText/`, `SplitText/`, `WordCarousel/`.
- Storybook 10 configured (`.storybook/`, `src/stories/ui/`), a11y addon enabled.
- i18n: `react-i18next`, 11 locales under `src/i18n/locales/` (`en-us, zh-Hans, zh-Hant, ja, ko, de, fr, es, it, ru, ar`), namespaces `agents, chat, connectors, dashboard, layout, onboarding, setting, triggers, update, workforce`. Parity gate: `pnpm check:i18n`.

---

## 6. Backend / the aion edge API surface

**Separate service.** Not in this repo. Contract mirror is byte-exact and never hand-edited: `src/api/aion/v1/contract/{openapi.yaml (2874 lines, v1.22.0), asyncapi.yaml, compatibility.json, README.md}`. `pnpm gen:aion-edge` (`scripts/gen-aion-edge-client.mjs`, `openapi-typescript`) regenerates `src/api/aion/v1/gen/edge-api.ts`; `bazel test //:aion_edge_client_gen` is the freshness gate.

`compatibility.json`: `edge_api 1.22.0`, `event_schema 1.0`, `desktop_client 1.0.2`, `minimum_desktop 1.0.2`.

Full endpoint surface (operationIds from `openapi.yaml`):

| Group | Routes |
|---|---|
| **projects** | `GET/POST /projects` (paged, `?space_id=`), `GET /projects/{id}` |
| **commands** | `POST /projects/{id}/commands` (`submitCommand` — the run trigger) |
| **events** | `GET /projects/{id}/events` (SSE, `id:` = sequence cursor) |
| **runs** | `POST /projects/{id}/runs/{runId}/cancel` |
| **approvals** | `POST /projects/{id}/approvals/{approvalId}/response` |
| **browser delegations** | `GET /projects/{id}/browser-delegations`, `POST .../{delegationId}/result` |
| **artifacts** | `GET /projects/{id}/artifacts` (`?name=`), `GET .../artifacts/{artifactId}` (`?inline=true`) |
| **attachments** | `POST /projects/{id}/attachments` (`{name, media_type, data_base64}`, 3 MiB cap, CAS dedupe, versioned) |
| **comments** | `POST|GET /projects/{id}/artifacts/{artifactId}/comments`, `PATCH /projects/{id}/comments/{commentId}` |
| **catalog** | `GET /models`, `GET /status` (`getIntegrationStatus` — version negotiation) |
| **usage** | `GET /usage` (`UsageTotals`, `RunSpend`, micro-USD) |
| **skills** | `GET /skills`, `GET|PUT|DELETE /skills/{name}`, `POST /skills/{name}/status` |
| **connectors** | `GET /connectors`, `POST /connectors/{id}/auth`, `DELETE /connectors/{id}/grant` |
| **schedules (Triggers)** | `GET|POST /schedules`, `GET|PUT|DELETE /schedules/{id}`, `POST .../pause|resume|requeue`, `GET .../events` |
| **account** | `GET /account` |
| **keys** | `GET|POST /keys`, `DELETE /keys/{keyId}` |
| **memory** | `GET /memory`, `GET /memory/search`, `POST /memory/clear`, `GET|PUT|DELETE /memory/{key}` (scoped) |
| **spaces** | `GET|POST /spaces`, `GET|PUT|DELETE /spaces/{id}`, `POST .../archive|unarchive`, `PUT|DELETE /projects/{id}/space` |

Auth: single bearer edge API key, resolved once in `electron/main/remoteBackend.ts` from `EIGENT_REMOTE_BACKEND_URL` + `EIGENT_REMOTE_BACKEND_API_KEY` (or `..._API_KEY_FILE`). HTTPS required except loopback HTTP. `keySource: 'env' | 'file'` decides whether onboarding may replace the key. Errors are RFC 9457 problems (`problems.ts`); typed refusals include `cursor_expired`, `attachment_invalid`, `artifacts_not_configured`, `delegation_not_pending`, `space_in_use`, `invalid_cursor`, `payload_too_large`.

Build system: Bazel (`MODULE.bazel`, `BUILD.bazel`) alongside pnpm. Team scripts in `scripts/team/`, guide at `docs/TEAM_SETUP.md`.

---

## 7. Testing

**Unit/integration — vitest 2.1** (`vitest.config.ts`): jsdom, globals on, setup `test/setup.ts`, 29 s timeout, junit → `test-results/junit.xml`, v8 coverage. Collects `test/**` and `src/**` for `*.test.ts(x)`/`*.spec.ts(x)`.
- `test/unit/` mirrors `src/` and `electron/`: `api/`, `store/`, `lib/` (incl. `lib/themeTokens/`), `components/` (`Layout`, `Folder`, `Dialog`, `WorkFlow`, `Session`), `pages/` (`Home` + `Home/hooks`, `Agents`, `Browser`, `Connectors`), `hooks/`, `electron/main/`
- `test/integration/`: `chatStore/`, `components/`
- `test/mocks/`: `electronMocks.ts` (`setupElectronMocks()`, `createElectronAPIMock()`, `createIpcRendererMock()`), `authStore.mock.ts`, `sse.mock.ts` (controllable SSE stream)
- `test/fixtures/aion/eigent/v1/` — golden contract fixtures; `test/fixtures/aion/browserctl/`
- **Known-failing baseline**: `test/vitest-baseline.json` records 1012 tests / 8 failures across 4 files; `pnpm check:vitest-baseline` (`scripts/check-vitest-baseline.mjs`) is what CI gates on, and it fails on movement in *either* direction. Docs: `test/README.md`.

**E2E — Playwright 1.48** (`e2e/playwright.config.ts`): drives the real Electron app against a live Compose edge. Serial, 1 worker, 180 s timeout, trace on failure. ~28 `*.e2e.ts` suites: `lifecycle, stream, feel, cards, plan, projects, artifact-truth, artifact-viewer, comments, attachments, skills, schedules, connectors, account, usage, workforce, parity, local-browser, human-browser, publish-approval, aion-lab`. Env hooks: `EIGENT_E2E_USER_DATA` (isolated profile), `EIGENT_E2E_APP_DIR`, `EIGENT_E2E_BOOTSTRAP`, `EIGENT_E2E_EVIDENCE_DIR`, `EIGENT_E2E_PACKAGED_APP`.

**Recorded evaluations** — `e2e/*.eval.ts` (`e2e/eval.config.ts`): real-model runs with `recordVideo`, run by hand, not gated. Includes domain-flavoured ones already: `financial-deep-research.eval.ts`, **`halifax.eval.ts`**, `pdf-handoff.eval.ts`, `deep-research-demo.eval.ts`, `browser-task.eval.ts`, `skills-*.eval.ts`.

**CI gates** — `.github/workflows/gates.yml`: `type-check`, `lint` (eslint + design-token usage + no-legacy-backend + no-dead-brain-calls), `check:i18n`, `check:vitest-baseline`, `scripts/check-electron-access.sh`. Bazel equivalents `//:type_check //:lint //:vitest //:aion_edge_client_gen`. Husky + lint-staged + Prettier (with `organize-imports` and `tailwindcss` plugins).

---

## 8. Mortgage / CRM-relevant assets already present

**Strong — reuse directly**
- **List/table views**: `src/pages/Home/components/HomeHubListTable.tsx` (declarative per-kind column defs + grid class), `HomeHubListItem`, `HomeHubGrid`, `HomeHubBoard`/`HomeHubBoardCard` (kanban-ish board with `utils/boardStatus.ts`), `HomeHubToolbar` (search + sort + view-mode toggle, persisted). This is a ready-made "entity list with board/grid/list modes" — the natural base for Leads / Cases / Applications.
- **File attach & upload**: `ChatBox/BottomBox/InputBox.tsx` (drag-drop, paste, up to 5 chips), `src/lib/fileUtils.ts` (`processDroppedFiles`, `processPastedFiles`), IPC `select-file` / `read-file` / `read-file-dataurl` / `download-file`, and the edge route `POST /projects/{id}/attachments` (versioned, CAS-deduped, 3 MiB). `SkillUploadDialog.tsx` is a second upload pattern (zip).
- **Document viewing**: `ArtifactViewer.tsx` (markdown, code, **diff**, sandboxed HTML with CSP, download), `src/components/Folder/FilePreview.tsx` (PDF branch, content-type sniffing), `src/components/Folder/index.tsx`, `src/lib/fileInfo.ts`. Deps already installed: `mammoth` (docx→html), `papaparse` + `csv-parser` (CSV), `xml2js`, `marked`/`react-markdown`/`remark-gfm`, `dompurify` (+ `src/lib/htmlSanitization.ts`, `htmlLocalAssets.ts`, `htmlFontStyles.ts`), Monaco. Skills exist for `pdf`, `docx`, `xlsx`, `pptx` in `resources/example-skills/`.
- **Scheduling / automation**: the full `/schedules` plane — cron validation (`validateCron` in `aionSchedulesStore.ts`), pause/resume/requeue, per-schedule event history, and a health model that distinguishes "active" from "actually firing". This is a working task/reminder engine for follow-ups, chase-ups, renewal dates.
- **Approval / human-in-the-loop**: `approval_required`/`approval_resolved` events, `ApprovalCard.tsx`, `ApprovalModeSelect.tsx`, `src/lib/approvalProposal.ts`, `POST .../approvals/{id}/response`. Directly maps to adviser sign-off on AI-drafted output.
- **Anchored comments on documents**: `CommentRail.tsx` + `commentAnchors.ts` + the comment→revision-turn loop. That's a compliance review workflow already built.
- **Forms**: only four `<form>`/`onSubmit` sites (`Dialog/ReportBugDialog.tsx`, `AddWorker/index.tsx`, `PreviewPanel/tabs/browser/BrowserTab.tsx`, `Home/AionTriggers.tsx`). Primitives exist (`input`, `input-select`, `select`, `checkbox`, `switch`, `textarea`, `label`, `formFieldSurface.ts`) but **there is no form library** (no react-hook-form, no zod) and no validation layer. Note `react-day-picker` is a dependency but has no calendar UI component in `src/components/ui/` — a date-picker still needs building.
- **Web automation for lender portals**: the local-browser delegation stack (§3) is exactly the mechanism for driving lender/sourcing portals under the user's own logged-in session (`browser_session_mode: 'logged_in'`), with a visible window and a take-control escape hatch. `e2e/halifax.eval.ts` suggests this has already been pointed at a UK lender.

**Weak / absent — must be built**
- **No calling, audio, video, WebRTC, recording, or transcription anywhere.** Grep for `getUserMedia|MediaRecorder|RTCPeer|webrtc|transcri|whisper|<audio|<video` across `src/` and `electron/` returns only CSS and a carousel. `multi_modal_agent`'s "Audio Analysis Toolkit" in `baseWorkers.ts` is a dead display-only label. Telephony/recording/transcription is greenfield — likely a new Skill on the aion side plus a new preview tab kind.
- **No secure external link sharing.** The only sharing primitive is the presigned artifact `download_url` (`grantAionArtifact`, time-boxed, default-deny bucket) — a good foundation for client document portals, but there is no share UI, no recipient model, no expiry control surfaced.
- **No CRM entity model.** Nothing resembling contacts, cases, pipelines, tasks-assigned-to-people. The nearest analogues are Space → Project → Run, and Spaces are already the natural "client/case" container (they survive machine changes, carry `project_count`, archive/unarchive, and have a full CRUD API).
- **`Channels` page is an empty stub** with WhatsApp and Lark already named — the intended inbound-channel home.
- **`ui/table.tsx` exists but is unused** (only `HomeHubListTable`'s CSS-grid pattern is in production use).
- **No `.lm-flow/` directory yet**; `.specify/` (spec-kit scaffolding) was added in commit `8020245c`.
