#!/usr/bin/env bash
# Runs INSIDE the sandbox container. Trusted (mounted read-only).
# Env: MODEL EFFORT MAXT GREEN_CMD. Reads /prompt.txt. Workdir /work.
set -uo pipefail
cd /work
echo "📦 install (sandbox, reproducible)…"
# npm ci does NOT modify the lockfile (no PR churn). Fall back to npm install if the lock is out of sync.
npm ci --no-audit --no-fund 2>/tmp/ci.err || { echo "npm ci→install"; npm install --no-audit --no-fund || exit 21; }
PKG_BEFORE="$(md5sum package.json 2>/dev/null || true)"
echo "🛠  agent (sandbox, model=$MODEL effort=$EFFORT)…"
claude -p "$(cat /prompt.txt)" --model "$MODEL" --effort "$EFFORT" --dangerously-skip-permissions --max-turns "$MAXT" || echo "claude exit≠0 (gates decide)"
PKG_AFTER="$(md5sum package.json 2>/dev/null || true)"
if [ "$PKG_BEFORE" != "$PKG_AFTER" ]; then echo "deps changed → npm install"; npm install --no-audit --no-fund || exit 22; fi
echo "🚦 green-gate (sandbox): $GREEN_CMD"
eval "$GREEN_CMD" || exit 23
echo "SANDBOX_OK"
