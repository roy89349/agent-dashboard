#!/usr/bin/env bash
# selftest.sh — proves the build sandbox is correctly isolated BEFORE you trust it with an
# untrusted backlog. It launches the SAME container configuration run-build.sh uses, then, from
# INSIDE the container (i.e. with the agent's exact privileges), tries to read host secrets and
# checks that they are NOT reachable — while confirming Claude auth still works.
#
# Exit 0 = all checks pass · Exit 1 = a leak or a broken check (do NOT run 24/7 until this passes).
#
#   ./deploy/sandbox/selftest.sh
#
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"

# Pick up config (SANDBOX_IMAGE / SANDBOX_NET / CLAUDE_SANDBOX_TOKEN) the same way the fleet does.
FLEET_DIR="$ROOT"
# shellcheck disable=SC1090,SC1091
[ -f "$ROOT/config.env" ]       && source "$ROOT/config.env"       2>/dev/null || true
# shellcheck disable=SC1090,SC1091
[ -f "$ROOT/config.local.env" ] && source "$ROOT/config.local.env" 2>/dev/null || true
IMAGE="${SANDBOX_IMAGE:-localhost/fleet-sandbox:latest}"
NET="${SANDBOX_NET:-pasta}"

command -v podman >/dev/null 2>&1 || { echo "❌ FAIL: podman not installed (host-mode dev only — no sandbox to test)"; exit 1; }
podman image exists "$IMAGE" 2>/dev/null || { echo "❌ FAIL: image '$IMAGE' not built — run deploy/sandbox/build-image.sh"; exit 1; }

# Same token derivation as run-build.sh: explicit standalone token, else short-lived from ~/.claude.
TOKEN="${CLAUDE_SANDBOX_TOKEN:-}"
[ -n "$TOKEN" ] || TOKEN="$(python3 -c "import json,os;print(json.load(open(os.path.expanduser(chr(126)+'/.claude/.credentials.json')))['claudeAiOauth']['accessToken'])" 2>/dev/null)"
[ -n "$TOKEN" ] || { echo "❌ FAIL: no Claude token (set CLAUDE_SANDBOX_TOKEN or sign in: claude setup-token)"; exit 1; }

# Real host secret paths we expect to be INVISIBLE inside the container.
SECRETS=(
  "$HOME/.claude/.credentials.json"          # Claude Max creds (access + refresh token)
  "$HOME/.config/gh/hosts.yml"               # GitHub PAT used for push/PR
  "$ROOT/config.local.env"                   # per-install config / GIT_EMAIL etc.
  "$ROOT/mission-control/.env.local"         # dashboard password + session secret
)
PROBE_LIST="$(printf '%s\n' "${SECRETS[@]}")"

WT="$(mktemp -d)"; echo '{"name":"probe"}' > "$WT/package.json"
OUT="$(podman run --rm --userns=keep-id --network "$NET" \
  --read-only --tmpfs /tmp --mount type=tmpfs,destination=/home/agent,tmpfs-mode=1777 \
  -v "$WT":/work:rw \
  -e CLAUDE_CODE_OAUTH_TOKEN="$TOKEN" -e HOME=/home/agent -e PROBE_LIST="$PROBE_LIST" \
  --workdir /work \
  "$IMAGE" bash -lc '
    echo "uid=$(id -u)"
    # The agent actively tries to read each host secret:
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      if cat "$f" >/dev/null 2>&1; then echo "LEAK:$f"; else echo "hidden:$f"; fi
    done <<< "$PROBE_LIST"
    # Broker tools must NOT be inside the container (only the orchestrator pushes/opens PRs):
    command -v gh  >/dev/null 2>&1 && echo "LEAK:gh-binary-present"  || echo "no-gh"
    # Claude auth MUST work (otherwise the agent cannot build):
    if claude -p "Reply with exactly: OK" 2>/dev/null | head -1 | grep -q "OK"; then echo "claude-auth-ok"; else echo "claude-auth-FAIL"; fi
  ' 2>&1)"
rm -rf "$WT"

echo "──────── sandbox probe output ────────"
echo "$OUT"
echo "──────────── verdict ────────────────"
FAILED=0
if echo "$OUT" | grep -q "^LEAK:"; then
  echo "❌ FAIL — a host secret or broker tool was reachable inside the sandbox:"
  echo "$OUT" | grep "^LEAK:" | sed 's/^/   /'
  FAILED=1
fi
echo "$OUT" | grep -q "claude-auth-ok" || { echo "❌ FAIL — Claude auth did not work inside the sandbox"; FAILED=1; }
if [ "$FAILED" = 0 ]; then
  echo "✅ PASS — host secrets ($(printf '%s' "${#SECRETS[@]}") paths) are invisible, gh is absent, and Claude auth works."
  echo "   The agent step is safely isolated; git push + PR stay in worker.sh (credential broker)."
fi
exit "$FAILED"
