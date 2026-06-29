#!/usr/bin/env bash
# run-agent-sandbox.sh <worktree-dir> <model> <max-turns> <prompt-file>
# CONTAINMENT TEMPLATE for the agent step. Runs 'claude -p' in a rootless
# Podman container with ONLY the worktree mounted and NO $HOME secrets, so that
# prompt injection via task text cannot read your gh token / claude creds / config.env.
#
# ⚠️ THIS IS A TEMPLATE — test it on the VPS before 24/7. Two things you still need to arrange:
#   1) Auth inside the container: pass ONLY the claude token (e.g. via a read-only
#      mount of a minimal credentials file or an env var), not your whole ~/.claude.
#   2) Egress allowlist: restrict the container's outbound traffic to only
#      api.anthropic.com (+ registry.npmjs.org for installs) via an outbound
#      firewall/proxy. git push + gh pr are done by the ORCHESTRATOR outside the
#      container (credential broker), NEVER the agent itself.
set -euo pipefail
WT="$1"; MODEL="$2"; MAXT="$3"; PROMPT_FILE="$4"
IMAGE="${SANDBOX_IMAGE:-docker.io/library/node:22-bookworm-slim}"

podman run --rm \
  --network "${SANDBOX_NET:-pasta}" \
  --read-only --tmpfs /tmp \
  -v "$WT":/work:rw \
  -v "$PROMPT_FILE":/prompt.txt:ro \
  -e CLAUDE_CODE_OAUTH_TOKEN="${CLAUDE_SANDBOX_TOKEN:?set CLAUDE_SANDBOX_TOKEN (a standalone claude token, not your whole home)}" \
  --workdir /work \
  --user "$(id -u):$(id -g)" \
  "$IMAGE" \
  bash -lc 'npm i -g @anthropic-ai/claude-code >/dev/null 2>&1; \
            claude -p "$(cat /prompt.txt)" --model '"$MODEL"' --dangerously-skip-permissions --max-turns '"$MAXT"
# Result = the changed files in $WT. The orchestrator (worker.sh) then runs
# the secret gate, build gate, commit, push and PR — outside the container.
