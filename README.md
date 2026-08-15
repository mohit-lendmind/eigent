# Eigent desktop on aion

This is a fork of [eigent-ai/eigent](https://github.com/eigent-ai/eigent) whose
desktop application runs entirely against an **aion** control plane.

Upstream Eigent ships two things: an Electron desktop and a Python agent
runtime that the desktop installs and supervises on the user's machine. This
fork keeps the desktop and replaces the runtime. Agents, tools, browsers,
terminals and skills all execute inside an aion session pod, reached over one
authenticated HTTP/SSE surface — the **Eigent edge API** (`/eigent/v1`).

The desktop therefore has no runtime of its own beyond Electron: nothing to
install on first launch, no Python, no local agent framework, no second control
plane. `scripts/check-no-legacy-backend.mjs` and
`scripts/inspect-package.mjs` are the gates that keep it that way.

---

## Contents

- [Architecture](#architecture)
- [What differs from upstream](#what-differs-from-upstream)
- [Prerequisites](#prerequisites)
- [Build and run](#build-and-run)
  - [1. Bring up an aion edge](#1-bring-up-an-aion-edge)
  - [2. Point the desktop at it](#2-point-the-desktop-at-it)
  - [3. Run in development](#3-run-in-development)
  - [4. Build a packaged app](#4-build-a-packaged-app)
- [Verifying a change](#verifying-a-change)
- [Repository layout](#repository-layout)
- [The aion contract](#the-aion-contract)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

---

## Architecture

```
┌──────────────────────────────┐
│  Desktop (this repo)         │
│                              │
│  Electron main               │  resolves the edge endpoint from the
│   └─ remoteBackend.ts        │  environment once, at startup
│                              │
│  Renderer (React)            │
│   └─ src/api/aion/v1/        │  generated client, byte-exact with the
│      transport + reducers    │  aion contract mirror
└──────────────┬───────────────┘
               │  HTTPS + SSE, one API key
               │  /eigent/v1  (turns, events, skills, approvals, files)
┌──────────────▼───────────────┐
│  aion edge                   │  the only surface the desktop knows
├──────────────────────────────┤
│  aion cell                   │  orchestrator, inference, SkillStore,
│   └─ session pod             │  sandbox — agents and tools run here
└──────────────────────────────┘
```

Two properties follow from this shape and are worth stating explicitly, because
they shape how you debug:

- **Startup readiness is a configuration check, not a health poll.** The main
  process validates the edge endpoint at launch. There is no local process to
  spawn or wait for, so a misconfigured endpoint fails visibly and immediately
  rather than hanging on a readiness probe.
- **The desktop never holds a provider key.** It holds one edge API key.
  Model credentials live server-side, in the aion inference plane.

## What differs from upstream

If you are reading upstream Eigent's documentation, these parts do not apply
here:

| Upstream                                          | This fork                                          |
| ------------------------------------------------- | -------------------------------------------------- |
| `backend/` — local Python agent runtime           | removed; agents run in the aion cell               |
| `server/` — Python cloud service                  | removed                                            |
| First-launch dependency install (`uv`, `bun`, venv, baked interpreter) | removed; there is nothing to install |
| Local Chrome under CDP for browser tools          | browser runs headless in the session pod           |
| Local backend port, health poll, restart          | edge endpoint validated once at startup            |
| CAMEL multi-agent framework                       | aion orchestrator + workforce                      |

Both of the upstream HTTP clients are gone with them. Eigent's hosted cloud API
reached a real service that holds no aion tenant's data, and the Brain-shaped
client resolved the removed local backend, so its calls failed without surfacing
an error — a screen built on it stayed clickable and inert.
`scripts/check-no-dead-brain-calls.mjs` now keeps both retired: naming one of
their exports anywhere in tracked source fails the gate, so the aion edge
(`src/api/aion/v1/transport.ts`) stays the only remote this app has.

One upstream name deliberately remains: `camel_task_id`, in
`src/pages/Workspace.tsx` and `src/store/chatStore.ts`. It is a wire-format
field, so it cannot be renamed unilaterally.

## Prerequisites

| Tool   | Version                        | Needed for                        |
| ------ | ------------------------------ | --------------------------------- |
| Node   | ≥ 18, < 23                     | everything                        |
| pnpm   | 10.33.2 (see `packageManager`) | dependency install, dev server    |
| Bazel  | via `bazelisk`                 | gates, packaging, the local stack |
| Docker | daemon running                 | the local aion stack              |

```bash
pnpm install
```

## Build and run

The desktop is useless without an edge to talk to, so bring the edge up first.

### 1. Bring up an aion edge

The `aion-v1` repo ships a self-contained Docker stack — Postgres, MinIO,
`aion-edge`, the cell services and the sandbox — driven through Bazel. From the
`aion-v1` checkout:

```bash
bazel run //dev/eigent_local:images
bazel run //dev/eigent_local:up
```

`:up` writes `deploy/eigent-local/run/bootstrap.json`, which carries the edge
URL, tenant/cell IDs and a desktop API key. That file and
`deploy/eigent-local/secrets/` are gitignored and must never be committed.

See `deploy/eigent-local/README.md` in `aion-v1` for the rest of the lifecycle
targets (`logs`, `down`, `reset_data`) and for the session-pod image.

### 2. Point the desktop at it

The main process reads exactly two variables at startup:

| Variable                             | Meaning                                           |
| ------------------------------------ | ------------------------------------------------- |
| `EIGENT_REMOTE_BACKEND_URL`          | edge base URL **including the `/eigent/v1` path** |
| `EIGENT_REMOTE_BACKEND_API_KEY`      | the desktop API key                               |
| `EIGENT_REMOTE_BACKEND_API_KEY_FILE` | alternative: a file to read the key from          |

Supply the key by one of the two key variables; if both are set, the direct one
wins. The URL is validated at startup (`electron/main/remoteBackend.ts`):
**https anywhere, plain http only on loopback**, no embedded credentials, no
query or fragment. A plain-http URL pointing at anything but `localhost` /
`127.0.0.0/8` / `[::1]` is refused — that is deliberate, not a bug to work
around.

```bash
BOOTSTRAP=/path/to/aion-v1/deploy/eigent-local/run/bootstrap.json
export EIGENT_REMOTE_BACKEND_URL="$(python3 -c "
import json,sys; print(json.load(open(sys.argv[1]))['edge_url'].rstrip('/') + '/eigent/v1')" "$BOOTSTRAP")"
export EIGENT_REMOTE_BACKEND_API_KEY="$(python3 -c "
import json,sys; print(json.load(open(sys.argv[1]))['api_key'])" "$BOOTSTRAP")"
```

The `/eigent/v1` suffix is not optional and is the most common setup mistake —
`bootstrap.json` stores the bare origin. See
[Troubleshooting](#troubleshooting).

### 3. Run in development

```bash
pnpm dev
```

This starts Vite and Electron together against the configured edge. If the
configuration is missing or invalid the app falls through to the login wall at
`#/login` — see [Troubleshooting](#troubleshooting).

For the renderer alone in a browser (no Electron host, so desktop-only
surfaces are inert):

```bash
pnpm dev:web
```

### 4. Build a packaged app

Package through Bazel, not `pnpm build`. The pipeline stages the declared vite
outputs, runs `electron-builder` in the source workspace (its native-module
collector needs the real pnpm store), then runs the package-inspection gate and
emits the manifest, SBOM, version manifest and checksums into `release/` and
`package-report/`:

```bash
bazel run //:package_pipeline
```

To check an existing build on its own:

```bash
node scripts/inspect-package.mjs release
```

The gate exits non-zero if the package carries a Python or `uv` runtime, an
embedded service payload, a Go service binary, a local database, provider key
material, a Docker socket client, or an internal (non-edge) service endpoint.

## Verifying a change

```bash
pnpm type-check              # tsc -p tsconfig.build.json --noEmit
pnpm lint                    # eslint + design tokens + the two source-scanning gates
pnpm check:i18n              # key parity across the 11 locales
pnpm check:vitest-baseline   # vitest, compared against its known-failing baseline
bash scripts/check-electron-access.sh
```

`.github/workflows/gates.yml` runs exactly these on every pull request and every
push to `main`, so a green PR now means something. Each gate runs even if an
earlier one fails, so one run reports every break.

The same checks run under Bazel, from this repo's root:

```bash
bazel test //:type_check //:lint //:vitest //:aion_edge_client_gen
```

One deliberate difference: `//:lint` is eslint + design tokens only. The
legacy-backend source gate and the non-aion HTTP client ratchet scan
**git-tracked** files — docs, CI workflows, dotfiles — which no Bazel filegroup
here declares, so they are reachable only as `pnpm lint` /
`pnpm check:no-legacy-backend` / `pnpm check:no-dead-brain-calls`. Run both.

`//:aion_edge_client_gen` has no npm equivalent; it is the freshness gate for
the generated edge client.

The Electron end-to-end suite needs the live stack, a display server and a
built app, so it is manual by design. From the repo root, with the stack up:

```bash
bazel test //:e2e_aion_lab --test_output=streamed \
  --test_env=HOME --test_env=PATH \
  --test_env=EIGENT_E2E_APP_DIR=$PWD \
  --test_env=EIGENT_E2E_BOOTSTRAP=/abs/path/to/bootstrap.json
```

Optional `--test_env` values: `EIGENT_E2E_EVIDENCE_DIR` to collect screenshots,
video and logs into a directory, and `EIGENT_E2E_PACKAGED_APP` pointed at an
unsigned package to drive the packaged build instead of the dev one. Each suite
allocates its own throwaway Electron profile, so runs do not share state.

### Recorded evaluations

`e2e/*.eval.ts` are the real-model counterpart: one long run through the product
UI against a stack holding real provider keys, recorded to video. They are not
part of any CI gate — a run costs provider tokens and takes minutes — so they
run by hand:

```bash
EIGENT_EVAL_DIR=/abs/path/to/output npx playwright test --config e2e/eval.config.ts parity
```

Set `EIGENT_E2E_PACKAGED_APP=release` to record the shipping artifact rather
than dev Electron. Playwright's `recordVideo` works through
`executablePath`, so the packaged bundle records exactly like the dev build; the
video only flushes on `app.close()`, so resolve `video.path()` after teardown.

**Known-failing baselines inherited from upstream.** These fail on a clean
checkout and are not caused by your change — compare against them rather than
expecting green:

- `pnpm test`: 11 files / 24 tests fail (store and integration suites). The set
  is recorded in [test/vitest-baseline.json](./test/vitest-baseline.json), and
  `pnpm check:vitest-baseline` is the gate — it fails on movement in either
  direction, so a test you fix means regenerating the baseline.
- `tsc -p tsconfig.json`: 127 errors. `tsconfig.build.json` — the one the gate
  uses — is clean.
- `pnpm lint`: 28 warnings, 0 errors.

That vitest set is measured on the Node line `package.json` declares
(`>=18 <23`) — it is what CI runs, and CI is the authority. On a newer Node the
suite fails differently: Node's own global `localStorage` shadows jsdom's and
lacks its methods, so anything touching Web Storage behaves differently. The
gate says so when it detects the mismatch. To move the baseline, take the numbers
from a run rather than from your machine: download the `test-results` artifact
from the Gates workflow and

```bash
pnpm check:vitest-baseline -- --update --report path/to/vitest-report.json
```

## Repository layout

```
electron/main/          Electron main process
  remoteBackend.ts        edge endpoint validation + config resolution (pure)
  index.ts                windows, IPC, protocol handlers, startup
  terminal.ts             PTY surface
  subscriptionAuth/       Codex OAuth
electron/preload/       the renderer's only bridge to main

src/api/aion/v1/        edge client
  contract/               byte-exact mirror of aion-v1/api/eigent/v1
  gen/                    generated from the mirror; never hand-edited
src/store/              zustand stores (chat, skills, projects, spaces)
src/pages/, components/ renderer UI
src/host/               desktop-vs-web capability injection
src/i18n/locales/       11 locales, parity-checked

scripts/                gates and generators
  check-no-legacy-backend.mjs   no CAMEL / Python service may re-enter
  check-no-dead-brain-calls.mjs the two retired HTTP clients stay retired
  inspect-package.mjs           the packaged app carries no runtime
  gen-aion-edge-client.mjs      regenerate the edge client
  package-pipeline.mjs          package + report

e2e/                    Playwright suites against a live edge
test/                    vitest unit and integration suites
resources/example-skills/  skill payloads; these execute in the aion cell
```

## The aion contract

`src/api/aion/v1/contract/` is a byte-for-byte mirror of `aion-v1/api/eigent/v1/`
and is never edited here. To pick up a contract change: re-copy the mirror and
`test/fixtures/aion/eigent/v1/` together, record the aion-v1 commit in
`src/api/aion/v1/contract/README.md`, then regenerate:

```bash
pnpm gen:aion-edge
```

`bazel test //:aion_edge_client_gen` fails until the mirror and the generated
client agree.

## Troubleshooting

**The app opens to a login screen at `#/login`.** The edge configuration is
missing or wrong. Almost always the `/eigent/v1` suffix is absent from
`EIGENT_REMOTE_BACKEND_URL`, or no API key was supplied. Do not try to log in —
there is no account to log into. Read the reason from the main-process log,
which names the exact cause:

The log is `<userData>/logs/main.log`. On macOS that is
`~/Library/Application Support/eigent/` under `pnpm dev` and
`~/Library/Application Support/Eigent/` for a packaged build — the app name
differs because only the packaged build gets `productName`.

```bash
grep 'Backend configuration is invalid' \
  ~/Library/Application\ Support/eigent/logs/main.log
```

Then fix the environment and relaunch. There is no other backend to fall back
to and nothing to retry from inside the app, which is why a misconfiguration
shows up as "not signed in" rather than as a degraded session.

**A skill fails with a missing interpreter or library.** Session pods have no
network egress, so nothing can be installed at run time. The dependency belongs
in the pod image (`deploy/eigent-local/workspace/Dockerfile` in `aion-v1`);
rebuild and re-pin with `bazel run //dev/eigent_local:images`.

**`pnpm build` produced something odd.** Use `bazel run //:package_pipeline`.
The npm scripts do not run the package-inspection gate or emit the report.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [SECURITY.md](./SECURITY.md).

## License

Apache-2.0, as inherited from
[eigent-ai/eigent](https://github.com/eigent-ai/eigent). See
[LICENSE](./LICENSE).
