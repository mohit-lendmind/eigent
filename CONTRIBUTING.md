# Contributing

This is an internal fork of [eigent-ai/eigent](https://github.com/eigent-ai/eigent).
Read [README.md](./README.md) first — it explains what the fork is, how it
differs from upstream, and how to build and run the desktop against an aion
edge. This file covers only the conventions for changing it.

Contributions to upstream Eigent go to the upstream repository and follow its
own guidelines, not these.

## Setup

See [Prerequisites](./README.md#prerequisites) and
[Build and run](./README.md#build-and-run). Short version:

```bash
pnpm install
pnpm dev   # with EIGENT_REMOTE_BACKEND_URL / _API_KEY set
```

## Gates

Run before pushing:

```bash
pnpm type-check
pnpm lint
pnpm check:i18n
pnpm check:vitest-baseline
bash scripts/check-electron-access.sh
```

`pnpm lint` is three checks: eslint, design-token usage, and the legacy-backend
source gate. The Bazel `//:lint` suite runs only the first two — the source gate
scans git-tracked files, which no Bazel filegroup here declares. Run `pnpm lint`
as well, not just the Bazel suite.

`.github/workflows/gates.yml` runs all of the above on every pull request and
every push to `main`. Every gate runs even after an earlier one fails, so one run
tells you everything that is broken rather than only the first thing.

Run them locally anyway — the round trip through CI is the slow way to find a
type error. But **CI is the authority**, for one concrete reason: the vitest
failure set moves with the Node major. Use the Node line `package.json` declares
(`>=18 <23`) and your numbers will match CI's. On a newer Node they will not, and
`check:vitest-baseline` will tell you the runtime differs rather than letting you
bisect your own diff for hours.

`pnpm check:vitest-baseline` and `tsc -p tsconfig.json` have known-failing
baselines inherited from upstream — see
[Known-failing baselines](./README.md#verifying-a-change). Compare against them;
do not add to them. If your change *fixes* one, the gate fails too: regenerate
the baseline from the CI run's `test-results` artifact and say so in the PR.

A pre-commit hook runs eslint, prettier, the design-token check and the license
header updater on staged files.

## Invariants

These are enforced by gates because they are easy to break by accident:

- **No CAMEL, no Python service.** `scripts/check-no-legacy-backend.mjs` fails
  if either re-enters the tree — as source, as a build step, or as a leftover
  reference in config. If a match is genuinely legitimate, add it to the
  script's exemption lists *with the reason*, and expect that to be reviewed.
  Legitimate today: skill payloads under `resources/example-skills/` (they run
  in the aion cell, not on the desktop) and `camel_task_id`, a wire-format field
  of a hosted API this fork does not own.
- **The packaged app carries no runtime of its own.**
  `scripts/inspect-package.mjs` runs inside `//:package_pipeline` and rejects an
  embedded interpreter, service payload, local database, provider key material
  or internal service endpoint.
- **`src/api/aion/v1/gen/` is generated.** Never hand-edit it. Change the
  contract mirror and run `pnpm gen:aion-edge`; see
  [The aion contract](./README.md#the-aion-contract).
- **Only `src/host/createHost.ts` may touch `window.electronAPI` /
  `window.ipcRenderer`.** Everything else goes through the host bridge so the
  renderer stays runnable on the web. `scripts/check-electron-access.sh` catches
  the literal `window.` forms only — aliasing `window` to a local first walks
  straight past it, so treat the guard as a backstop and the rule as the actual
  constraint.
- **No hard-coded colors in UI source.** Use design tokens. Guarded by
  `scripts/check-design-token-usage.mjs`; genuine exceptions go in
  `scripts/design-token-usage.allowlist` or carry an inline
  `// ds:allow-hardcoded-color`.
- **All 11 locales stay in parity.** Add a key to `en-us` and you add it
  everywhere. Guarded by `pnpm check:i18n`.
- **Never commit secrets.** `deploy/eigent-local/run/` and any API key material
  are gitignored for a reason. Check `git diff --cached --name-only` before
  committing.

## Code style

- Comments explain **why**, not what. If a comment restates the line below it,
  delete it.
- No plan or process narrative in comments — no phase numbers, no ticket IDs, no
  "will be replaced later". Comments describe what the code does now.
- Follow the surrounding file's naming, structure and comment density rather
  than introducing a new style.
- Avoid abbreviations in identifiers: `messageWindowSize`, not `msgWinSz`.
- Prefer deleting code to adding an abstraction with one call site.

## Branches, commits and PRs

- Branch off `main`; never commit to `main` directly.
- One reviewable concern per PR. If the diff needs two summaries, it is two PRs.
- Commit subjects are imperative and scoped: `fix(skills): …`, `refactor: …`,
  `docs: …`.
- PR descriptions state what changed, why, and what you actually ran —
  including gate output. "Should work" is not evidence.

## Syncing with upstream

`upstream` points at `eigent-ai/eigent`. This fork has deleted upstream's
`backend/` and `server/` trees and its dependency installer, so a merge from
upstream will surface those paths as **deleted-by-us** conflicts. Keep them
deleted; do not resurrect a path to resolve a conflict quickly. `git rm` the
conflicting paths and note in the merge commit which upstream change was
dropped along with them.

## Getting help

Open an issue in this repository. For questions about upstream Eigent's own
behavior, upstream's issue tracker is the better venue.
