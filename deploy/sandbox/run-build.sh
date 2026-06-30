#!/usr/bin/env bash
# run-build.sh <worktree> <model> <effort> <max-turns> <prompt-file>
# Code-executing pipeline (install + agent + build) in a rootless Podman container with ONLY the
# worktree mounted + a short-lived Claude token. No host secrets reach the (injectable) agent.
# Runs as non-root (userns=keep-id → host uid) so claude accepts --dangerously-skip-permissions
# AND can write the worktree. git push + PR happen OUTSIDE, in worker.sh (credential broker).
# Exit: 0 = green passed · 21/22 = install fail · 23 = green-gate fail · 30 = infra/token error.
set -uo pipefail
WT="$1"; MODEL="$2"; EFFORT="$3"; MAXT="$4"; PROMPTF="$5"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE="${SANDBOX_IMAGE:-localhost/fleet-sandbox:latest}"
NET="${SANDBOX_NET:-pasta}"
# Auth for the container: prefer an explicit standalone token (CLAUDE_SANDBOX_TOKEN); otherwise
# derive a SHORT-LIVED access token from ~/.claude on the HOST (the refresh-capable creds never
# enter the container). The host's router/reviewer claude calls keep that access token fresh.
TOKEN="${CLAUDE_SANDBOX_TOKEN:-}"
[ -n "$TOKEN" ] || TOKEN="$(python3 -c "import json,os;print(json.load(open(os.path.expanduser(chr(126)+\"/.claude/.credentials.json\")))[\"claudeAiOauth\"][\"accessToken\"])" 2>/dev/null)"
[ -n "$TOKEN" ] || { echo "no Claude token: set CLAUDE_SANDBOX_TOKEN or sign in on the host (claude setup-token)"; exit 30; }
exec podman run --rm --userns=keep-id \
  --network "$NET" \
  --read-only --tmpfs /tmp \
  --mount type=tmpfs,destination=/home/agent,tmpfs-mode=1777 \
  -v "$WT":/work:rw \
  -v "$PROMPTF":/prompt.txt:ro \
  -v "$DIR/pipeline.sh":/pipeline.sh:ro \
  -e CLAUDE_CODE_OAUTH_TOKEN="$TOKEN" \
  -e HOME=/home/agent \
  -e MODEL="$MODEL" -e EFFORT="$EFFORT" -e MAXT="$MAXT" -e GREEN_CMD="${GREEN_CMD:-npm run build}" \
  --workdir /work \
  "$IMAGE" bash /pipeline.sh
