#!/usr/bin/env bash
# Runs INSIDE the sandbox container. Trusted (mounted read-only).
# Env: MODEL EFFORT MAXT GREEN_CMD (+ optional FLEET_SCREENSHOT SCREENSHOT_PATHS
# SCREENSHOT_START_CMD SCREENSHOT_PORT SCREENSHOT_WAIT_SEC). Reads /prompt.txt. Workdir /work.
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

# ── VISUAL PR APPROVAL — screenshots of the BUILT app (strictly best-effort) ──
# Only after the green gate passed. Gated on FLEET_SCREENSHOT=on AND the playwright-enabled
# image (browser dir present + /screenshot.cjs mounted). Every step is `|| true` / guarded:
# a build NEVER fails because of screenshots. Output lands in /work/.fleet-screens — the
# already-mounted worktree; worker.sh keeps that dir out of the commit and posts the first PNG.
if [ "${FLEET_SCREENSHOT:-off}" = "on" ]; then
  if [ -f /screenshot.cjs ] && [ -d "${PLAYWRIGHT_BROWSERS_PATH:-/ms-playwright}" ]; then
    SHOT_PORT="${SCREENSHOT_PORT:-3000}"
    SHOT_WAIT="${SCREENSHOT_WAIT_SEC:-25}"
    SHOT_DIR=/work/.fleet-screens
    echo "📸 visual: serving app for screenshots (port $SHOT_PORT, wait ≤${SHOT_WAIT}s)…"
    mkdir -p "$SHOT_DIR" 2>/dev/null || true
    PORT="$SHOT_PORT" bash -c "${SCREENSHOT_START_CMD:-npm run start}" >/tmp/screenshot-server.log 2>&1 &
    SHOT_SRV=$!
    i=0; up=""
    while [ "$i" -lt "$SHOT_WAIT" ]; do
      if curl -sf -o /dev/null "http://127.0.0.1:$SHOT_PORT/"; then up=1; break; fi
      kill -0 "$SHOT_SRV" 2>/dev/null || break        # server died early — stop waiting
      sleep 1; i=$((i+1))
    done
    if [ -n "$up" ]; then
      NODE_PATH=/usr/local/lib/node_modules node /screenshot.cjs \
        "http://127.0.0.1:$SHOT_PORT" "${SCREENSHOT_PATHS:-/}" "$SHOT_DIR" || true
    else
      echo "📸 visual: app not up on :$SHOT_PORT within ${SHOT_WAIT}s — skipping screenshots"
      tail -n 20 /tmp/screenshot-server.log 2>/dev/null || true
    fi
    kill "$SHOT_SRV" 2>/dev/null || true
    wait "$SHOT_SRV" 2>/dev/null || true
  else
    echo "📸 visual: FLEET_SCREENSHOT=on but this image lacks playwright/chromium — skipping (rebuild via deploy/sandbox/build-image.sh)"
  fi
fi

echo "SANDBOX_OK"
