#!/usr/bin/env bash
# Fleet watchdog tick — two layers:
#   1) normal: POST the dashboard's /api/fleet/watchdog — the app evaluates fleet health
#      (supervisor pid + heartbeat + breaker), dedupes and alerts Telegram itself.
#   2) fallback: if the DASHBOARD itself is unreachable, alert Telegram DIRECTLY from here
#      (own dedupe via a state-file, max 1 alert per 30 min) — so a dead dashboard can't
#      silence the watchdog. Recovery sends an all-clear once.
# Install: mission-control-watchdog.service + mission-control-watchdog.timer (every 2 min).
# Requires MC_WATCHDOG_TOKEN, TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_CHAT_ID in the env file.
set -u

ENV_FILE="${ENV_FILE:-/home/fleet/agent-dashboard/mission-control/.env.local}"
URL="${WATCHDOG_URL:-http://127.0.0.1:3000/api/fleet/watchdog}"
STATE="${WATCHDOG_STATE_FILE:-${HOME}/.watchdog-dashboard-down}"
COOLDOWN=1800 # seconds between direct dashboard-down alerts

getenv() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'"; }

tg_send() { # $1 = text; never fails the script
  local bot chat
  bot="$(getenv TELEGRAM_BOT_TOKEN)"
  chat="$(getenv TELEGRAM_ALLOWED_CHAT_ID)"
  [ -n "$bot" ] && [ -n "$chat" ] || return 0
  curl -fsS -m 10 "https://api.telegram.org/bot${bot}/sendMessage" \
    --data-urlencode "chat_id=${chat}" \
    --data-urlencode "text=$1" >/dev/null 2>&1 || true
}

TOKEN="$(getenv MC_WATCHDOG_TOKEN)"
if curl -fsS -m 20 -X POST -H "X-Watchdog-Token: ${TOKEN}" "$URL" >/dev/null 2>&1; then
  # Dashboard alive → the app handled fleet health itself. Clear a previous dashboard-down mark.
  if [ -f "$STATE" ]; then
    rm -f "$STATE"
    tg_send "✅ Watchdog: dashboard weer bereikbaar."
  fi
  exit 0
fi

# Dashboard unreachable → direct alert, deduped on the state-file's age.
now=$(date +%s)
if [ -f "$STATE" ]; then
  last=$(stat -c %Y "$STATE" 2>/dev/null || stat -f %m "$STATE" 2>/dev/null || echo 0)
  [ $((now - last)) -lt "$COOLDOWN" ] && exit 0
fi
touch "$STATE"
tg_send "🛑 Watchdog: het DASHBOARD is onbereikbaar (${URL} faalt) — fleet-health onbekend. Check op de server: systemctl status mission-control-dashboard dev-fleet"
exit 0
