#!/usr/bin/env bash
# Morning digest tick — POST the dashboard's /api/communication/digest so the Communication
# agent generates a daily-standup summary and pushes it to Telegram itself (notify:true).
# Mirrors watchdog.sh: self-auth via MC_WATCHDOG_TOKEN from the dashboard env file.
# On failure: log to stderr ONLY — no direct Telegram alert here; a dead dashboard is already
# covered (and alerted) by the watchdog layer, a second alarm would just be noise.
# Install: morning-digest.service + morning-digest.timer (daily at 07:15 local).
set -u

ENV_FILE="${ENV_FILE:-/home/fleet/agent-dashboard/mission-control/.env.local}"
URL="${DIGEST_URL:-http://127.0.0.1:3000/api/communication/digest}"
DIGEST_TYPE="${DIGEST_TYPE:-daily_standup}"   # daily_standup | end_of_day (server clamps anything else)

getenv() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'"; }

TOKEN="$(getenv MC_WATCHDOG_TOKEN)"
if [ -z "$TOKEN" ]; then
  echo "morning-digest: MC_WATCHDOG_TOKEN not found in $ENV_FILE — digest not sent." >&2
  exit 1
fi

# Require an explicit HTTP 200 — `curl -f` treats a 3xx login-redirect as success, which would
# silently swallow the digest if the route ever lands behind the session proxy again.
HTTP_CODE=$(curl -sS -m 30 -o /dev/null -w '%{http_code}' -X POST \
  -H "X-Watchdog-Token: ${TOKEN}" -H "Content-Type: application/json" \
  -d "{\"type\":\"${DIGEST_TYPE}\"}" "$URL" 2>/dev/null || echo 000)
if [ "$HTTP_CODE" = "200" ]; then
  exit 0
fi

echo "morning-digest: POST $URL failed (HTTP ${HTTP_CODE}) — no digest sent." >&2
exit 1
