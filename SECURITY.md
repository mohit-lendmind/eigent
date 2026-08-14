# Security Policy

This is an internal fork of [eigent-ai/eigent](https://github.com/eigent-ai/eigent).
It is not a released product and has no supported-version matrix.

## Reporting a vulnerability

**In this fork** — open a private security advisory on this repository, or
contact the repository owners directly. Include a description, reproduction
steps and the impact you believe it has. Do not open a public issue for
anything exploitable.

**In upstream Eigent** — report it to upstream (info@eigent.ai, or a private
advisory on `eigent-ai/eigent`) so every downstream fork benefits. If it also
affects this fork, tell us too.

## Handling secrets in this repository

The desktop holds exactly one credential: the aion edge API key, supplied at
launch via `EIGENT_REMOTE_BACKEND_API_KEY` or
`EIGENT_REMOTE_BACKEND_API_KEY_FILE`. Model-provider keys live server-side in
the aion inference plane and must never reach the desktop or this repository.

- Local stack material (`deploy/eigent-local/run/`, key files, bootstrap
  output) is gitignored. Check `git diff --cached --name-only` before every
  commit.
- `scripts/inspect-package.mjs` fails the packaging pipeline if a build embeds
  provider key environment names or an internal service endpoint.
- If a key is ever committed, treat it as compromised: rotate it first, then
  worry about the history.
