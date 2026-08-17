# Eternyl desktop — team setup

How to build the Eternyl desktop app on your Mac, get kubectl access to the
aion backend on GKE, and run the app against the shared dev cell. After the
one-time setup, day-to-day use is two commands.

```
Eternyl.app (your Mac)
   │  HTTPS/SSE  (via a kubectl port-forward tunnel)
   ▼
aion edge  (svc cell-dev-1-aion-edge, GKE cluster cell-dev-1-gke, europe-west2)
   │
   ▼
aion cell  (agents, inference, sandboxes — all server-side; the desktop is UI-only)
```

The desktop app holds no models, no provider keys, and no agent runtime — it
authenticates to the edge with a personal API key and everything else runs in
the cluster.

---

## 1. Access you need first (ask the admin)

| What | Why |
|------|-----|
| GitHub access to `mohit-lendmind/eigent` | clone + build the app |
| A Google account granted `roles/container.developer` on GCP project `eternly-dev` | kubectl access to the cluster |
| **Your personal Eternyl API key** | the app's login credential |

The API key is handed to you directly by the admin (Slack DM, password
manager, …). It is **never** stored in this repository, in this document, or
in any commit. Treat it like a password.

> The GCP project id is literally spelled `eternly-dev` (no second "e").
> Copy-paste the commands below rather than typing it.

## 2. Prerequisites (one-time, ~15 min)

macOS on Apple Silicon is the supported dev platform.

```bash
# Xcode command-line tools (compilers for native modules)
xcode-select --install

# Homebrew, if you don't have it: https://brew.sh
brew install bazelisk google-cloud-sdk

# kubectl + the GKE auth plugin come from gcloud
gcloud components install kubectl gke-gcloud-auth-plugin
```

**Node.js 20 LTS** — the repo requires `>=18 <23`, and Node 23+ actively
breaks the test suite (its global `localStorage` shadows the test DOM). Use
your version manager of choice, e.g.:

```bash
brew install node@20 && brew link --overwrite node@20   # or: nvm install 20
corepack enable                                          # provides the pinned pnpm 10
```

Bazelisk reads `.bazelversion` (7.4.1) and fetches the right Bazel
automatically — do not install Bazel by hand.

## 3. Build the desktop app

```bash
git clone https://github.com/mohit-lendmind/eigent.git
cd eigent
pnpm install                      # native deps (electron, node-pty) are pre-approved for build
bazel run //:package_pipeline     # builds + packages the app
```

The packaged app lands at `release/mac-arm64/Eternyl.app`. Always package
through Bazel — `npm run build` alone is not the packaging path.

**First open of an unsigned build:** the app is not yet notarized with Apple,
so macOS quarantines it. Either right-click → Open once, or clear the flag:

```bash
xattr -dr com.apple.quarantine release/mac-arm64/Eternyl.app
```

## 4. Connect kubectl to the aion cluster

```bash
gcloud auth login
gcloud container clusters get-credentials cell-dev-1-gke \
  --region europe-west2 --project eternly-dev

# Verify — you should see six deployments' pods Running:
kubectl -n cell-dev-1 get pods
```

Everything lives in namespace `cell-dev-1`. Useful read-only commands:

```bash
kubectl -n cell-dev-1 get deploy                                   # the six services
kubectl -n cell-dev-1 logs deploy/cell-dev-1-aion-edge --tail=100  # edge (the app's API)
kubectl -n cell-dev-1 logs deploy/aion-server-managed --tail=100   # the agent harness
kubectl -n cell-dev-1 logs deploy/sandbox-api --tail=100           # sandbox control plane
kubectl -n cell-dev-1 get pods -l sandbox-id                       # live sandbox/browser pods
```

Please don't `kubectl delete`/`edit`/`apply` anything in the shared dev cell
without coordinating — deployments are managed by Terraform and pinned images.

## 5. Run the app

Two terminals:

```bash
# Terminal 1 — tunnel to the cloud edge (leave it running)
./scripts/team/edge-tunnel.sh

# Terminal 2 — launch the app against it
./scripts/team/run-eternyl.sh
```

On **first launch** the app asks for your API key — paste the one the admin
gave you. It is stored with `0600` permissions in your user profile
(`~/Library/Application Support/eigent/aion-edge-api-key`) and you won't be
asked again.

Alternatively keep the key in a file yourself and skip onboarding:

```bash
install -m 600 /dev/null ~/.eternyl-api-key   # then paste your key into it
ETERNYL_KEY_FILE=~/.eternyl-api-key ./scripts/team/run-eternyl.sh
```

Available models in the picker: `kimi-k3`, `gemini-3-flash`,
`gemini-3-reasoning`.

### Everyday workflow

```bash
./scripts/team/edge-tunnel.sh     # terminal 1, once per session
./scripts/team/run-eternyl.sh     # terminal 2
```

That's it. Rebuild with `bazel run //:package_pipeline` when you pull new
code.

## 6. Known caveats (current state, not bugs to file)

- **`web_search` / `fetch` tool calls time out by design.** The agents pod has
  no public-internet egress (locked-down cell). For live web data, ask the
  agent to *browse* — browser tasks run in sandboxed browser pods that do have
  egress. This is the sanctioned live-web path.
- **Port 18985 shadowing.** If anything else (typically a local Docker stack)
  holds `127.0.0.1:18985`, `kubectl port-forward` silently binds only IPv6 and
  your requests hit the local process instead of the cloud edge — classic
  symptom is an inexplicable 401. `edge-tunnel.sh` checks for this and
  refuses; if you hit it, stop the local stack or pass another port:
  `./scripts/team/edge-tunnel.sh 28985` (then
  `ETERNYL_EDGE_URL=http://127.0.0.1:28985/eigent/v1 ./scripts/team/run-eternyl.sh`).
- **Unsigned builds.** No Apple signing/notarization yet — expect the
  quarantine dance from §3 after each fresh build, and the in-app auto-updater
  has no signed releases to serve, so "updating" means `git pull` + repackage.
- **The dev edge may lag the repo by a version.** Version negotiation is
  handled in-app; if a brand-new feature shows an "update your backend" style
  banner, the cell simply hasn't been rolled yet — ask in the team channel.

## 7. Troubleshooting

| Symptom | Cause → fix |
|---------|-------------|
| App opens on a blank login screen | Backend URL missing or wrong — it must end in `/eigent/v1`. Use the scripts rather than exporting env vars by hand. |
| `edge is not reachable` from `run-eternyl.sh` | Tunnel not running — start `edge-tunnel.sh` in another terminal. |
| 401 from the edge despite a correct key | Almost always the port-shadowing caveat above; check `lsof -nP -iTCP:18985 -sTCP:LISTEN`. Otherwise your key may have been revoked — ask the admin. |
| `get-credentials` fails with permission errors | Your Google account isn't granted on `eternly-dev` yet — ask the admin, then `gcloud auth login` again. |
| `gke-gcloud-auth-plugin not found` when using kubectl | `gcloud components install gke-gcloud-auth-plugin`, then restart the terminal. |
| Tunnel dies when your laptop sleeps | Just rerun `edge-tunnel.sh` — the app reconnects. |
| `pnpm install` fails on a native module | Check `xcode-select --install` completed and you're on Node 20 (`node -v`). |
| App won't open ("damaged / unidentified developer") | The quarantine flag — see §3. |

## 8. Security rules (non-negotiable)

- **Never commit an API key**, to this repo or any other — not in code, docs,
  scripts, `.env` files, or screenshots. Keys live only in your local key file
  (`0600`) or the app's stored credential.
- If a key leaks (pasted into a PR, a log, a screenshot), tell the admin
  immediately so it can be revoked — revocation is cheap, leaks are not.
- Don't share your personal key with teammates; everyone gets their own from
  the admin.
