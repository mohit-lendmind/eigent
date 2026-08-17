#!/usr/bin/env bash
# Opens the port-forward to the Eternyl cloud edge (aion) on GKE.
#
# Run this in its own terminal and leave it running; the desktop app
# talks to http://127.0.0.1:<port>/eigent/v1 through it. See
# docs/TEAM_SETUP.md for the one-time gcloud/kubectl setup.
#
# Usage: scripts/team/edge-tunnel.sh [local-port]   (default 18985)
set -euo pipefail

PORT="${1:-18985}"
PROJECT="eternly-dev" # literal spelling — the GCP project id has no second "e"
REGION="europe-west2"
CLUSTER="cell-dev-1-gke"
NAMESPACE="cell-dev-1"
SERVICE="cell-dev-1-aion-edge"
EDGE_PORT=8088
CONTEXT="gke_${PROJECT}_${REGION}_${CLUSTER}"

die() { echo "error: $*" >&2; exit 1; }

for bin in gcloud kubectl lsof curl; do
  command -v "$bin" >/dev/null 2>&1 || die "$bin is not installed (see docs/TEAM_SETUP.md prerequisites)"
done
command -v gke-gcloud-auth-plugin >/dev/null 2>&1 \
  || die "gke-gcloud-auth-plugin missing: gcloud components install gke-gcloud-auth-plugin"

# kubectl port-forward silently binds only ::1 when something else holds the
# IPv4 port — curl then reaches whatever holds 127.0.0.1:<port> (usually a
# local Docker stack) instead of the cloud edge. Refuse up front.
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "error: port $PORT is already in use:" >&2
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >&2
  die "stop that process (or pass a different port: $0 <port>)"
fi

# Fetch cluster credentials once; reuse the context on later runs.
if ! kubectl config get-contexts -o name 2>/dev/null | grep -qx "$CONTEXT"; then
  echo "Fetching cluster credentials (one-time)..."
  gcloud container clusters get-credentials "$CLUSTER" \
    --region "$REGION" --project "$PROJECT" \
    || die "get-credentials failed — are you logged in (gcloud auth login) and granted access to $PROJECT?"
fi

kubectl --context "$CONTEXT" -n "$NAMESPACE" get svc "$SERVICE" >/dev/null \
  || die "cannot reach svc/$SERVICE in $NAMESPACE — check your access with the admin"

kubectl --context "$CONTEXT" -n "$NAMESPACE" \
  port-forward "svc/$SERVICE" "$PORT:$EDGE_PORT" &
PF_PID=$!
trap 'kill "$PF_PID" 2>/dev/null || true' EXIT INT TERM

# Probe over IPv4 explicitly so a ::1-only bind cannot fake a success.
echo "Waiting for the tunnel..."
for _ in $(seq 1 30); do
  if curl -4 -fsS --max-time 2 "http://127.0.0.1:$PORT/eigent/v1/status" >/dev/null 2>&1; then
    echo ""
    echo "Edge tunnel is up: http://127.0.0.1:$PORT/eigent/v1"
    echo "Leave this terminal running; start the app with scripts/team/run-eternyl.sh"
    echo ""
    wait "$PF_PID"
    exit 0
  fi
  kill -0 "$PF_PID" 2>/dev/null || die "port-forward exited early — see the kubectl output above"
  sleep 1
done
die "tunnel did not become ready within 30s"
