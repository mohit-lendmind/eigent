#!/usr/bin/env bash
# Launches the packaged Eternyl desktop app against the cloud edge.
#
# Expects the edge tunnel to be running (scripts/team/edge-tunnel.sh).
# On first launch the app asks for your API key — get it from the admin,
# never from the repo — and stores it 0600 in your user profile.
#
# Overrides (all optional):
#   ETERNYL_EDGE_URL   backend URL   (default http://127.0.0.1:18985/eigent/v1)
#   ETERNYL_KEY_FILE   path to a file holding your API key (skips onboarding)
#   ETERNYL_APP        path to the app binary (default: this repo's release build)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
EDGE_URL="${ETERNYL_EDGE_URL:-http://127.0.0.1:18985/eigent/v1}"
APP_BIN="${ETERNYL_APP:-$REPO_ROOT/release/mac-arm64/Eternyl.app/Contents/MacOS/Eternyl}"

die() { echo "error: $*" >&2; exit 1; }

[ -x "$APP_BIN" ] || die "app binary not found at $APP_BIN
Build it first:  bazel run //:package_pipeline
(or point ETERNYL_APP at an existing Eternyl.app binary)"

# Probe the edge over IPv4 before launching — a dead tunnel otherwise
# surfaces as a confusing blank screen inside the app.
if ! curl -4 -fsS --max-time 3 "$EDGE_URL/status" >/dev/null 2>&1; then
  die "edge is not reachable at $EDGE_URL
Start the tunnel in another terminal:  scripts/team/edge-tunnel.sh"
fi

export EIGENT_REMOTE_BACKEND_URL="$EDGE_URL"

if [ -n "${ETERNYL_KEY_FILE:-}" ]; then
  [ -f "$ETERNYL_KEY_FILE" ] || die "key file not found: $ETERNYL_KEY_FILE"
  [ -s "$ETERNYL_KEY_FILE" ] || die "key file is empty: $ETERNYL_KEY_FILE"
  chmod 600 "$ETERNYL_KEY_FILE" 2>/dev/null || true
  export EIGENT_REMOTE_BACKEND_API_KEY_FILE="$ETERNYL_KEY_FILE"
  echo "Using API key file: $ETERNYL_KEY_FILE"
else
  echo "No ETERNYL_KEY_FILE set — the app will ask for your API key on first launch."
fi

echo "Backend: $EDGE_URL"
exec "$APP_BIN"
