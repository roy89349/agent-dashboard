#!/usr/bin/env bash
# Tests for the night-shift helpers (lib.sh): in_night_window across boundaries (wrap + plain +
# edges), night_id day-rollover, and the per-night counter/cap logic — all without touching gh
# or the real state dir. Run:  bash tests/night-shift.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/lib.sh"

# Isolate fixtures: counter files go to a temp state dir (lib.sh already sourced config).
STATE_DIR="$(mktemp -d)"; export STATE_DIR
cleanup(){ rm -rf "$STATE_DIR"; }
trap cleanup EXIT

PASS=0; FAIL=0
ok(){ # ok <desc> <got> <want>
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); printf '  ✅ %s\n' "$1"
  else FAIL=$((FAIL+1)); printf '  ❌ %s — got [%s] want [%s]\n' "$1" "$2" "$3"; fi
}
win(){ in_night_window "$1" && echo in || echo out; }  # win <hour> under current NIGHT_* env

echo "── in_night_window: wrapped window 23→7 ──"
export NIGHT_START_HOUR=23 NIGHT_END_HOUR=7
ok "22:00 is outside"                 "$(win 22)" "out"
ok "23:00 (start edge) is inside"     "$(win 23)" "in"
ok "00:00 (midnight) is inside"       "$(win 0)"  "in"
ok "03:00 is inside"                  "$(win 3)"  "in"
ok "06:00 is inside"                  "$(win 6)"  "in"
ok "07:00 (end edge, exclusive) out"  "$(win 7)"  "out"
ok "12:00 is outside"                 "$(win 12)" "out"
ok "leading-zero hour (date +%%H) ok" "$(win 06)" "in"

echo "── in_night_window: plain window 1→5 (start<end) ──"
export NIGHT_START_HOUR=1 NIGHT_END_HOUR=5
ok "00:00 is outside"                 "$(win 0)"  "out"
ok "01:00 (start edge) is inside"     "$(win 1)"  "in"
ok "04:00 is inside"                  "$(win 4)"  "in"
ok "05:00 (end edge, exclusive) out"  "$(win 5)"  "out"
ok "23:00 is outside"                 "$(win 23)" "out"

echo "── in_night_window: degenerate configs ──"
export NIGHT_START_HOUR=3 NIGHT_END_HOUR=3
ok "start==end -> empty window"       "$(win 3)"  "out"
export NIGHT_START_HOUR=23 NIGHT_END_HOUR=7
ok "junk hour -> outside (safe)"      "$(win banana)" "out"
NIGHT_START_HOUR=banana NIGHT_END_HOUR=junk \
ok "junk config -> defaults 23→7"     "$(NIGHT_START_HOUR=banana NIGHT_END_HOUR=junk win 0)" "in"

echo "── night_id: the night keeps ONE id across midnight ──"
export NIGHT_START_HOUR=23 NIGHT_END_HOUR=7
TODAY="$(date +%Y-%m-%d)"
YDAY="$(date -v-1d +%Y-%m-%d 2>/dev/null || date -d yesterday +%Y-%m-%d)"
ok "at 23:00 the night id is today"      "$(night_id 23)" "$TODAY"
ok "at 02:00 the night id is yesterday"  "$(night_id 2)"  "$YDAY"
ok "at 12:00 (outside) id is today"      "$(night_id 12)" "$TODAY"
export NIGHT_START_HOUR=1 NIGHT_END_HOUR=5
ok "non-wrapped window never rolls back" "$(night_id 2)"  "$TODAY"

echo "── night counter + cap ──"
export NIGHT_START_HOUR=23 NIGHT_END_HOUR=7 NIGHT_MAX_PR=2
ok "fresh night -> count 0"             "$(night_count 23)" "0"
ok "count 0 < cap 2 -> not reached"     "$(night_cap_reached 23 && echo capped || echo open)" "open"
night_mark_claim 23
ok "after 1 claim -> count 1"           "$(night_count 23)" "1"
night_mark_claim 23
ok "after 2 claims -> count 2"          "$(night_count 23)" "2"
ok "count 2 >= cap 2 -> reached"        "$(night_cap_reached 23 && echo capped || echo open)" "capped"
ok "counter file uses the night id"     "$(cat "$STATE_DIR/.night-$TODAY")" "2"
# after midnight (hour 2) the same night maps to YESTERDAY's id — the counter written at 23:00
# "yesterday" is exactly the one read at 02:00 "today", so one night = one cap.
echo 2 > "$STATE_DIR/.night-$YDAY"
ok "02:00 reads the counter of the night that STARTED yesterday" "$(night_count 2)" "2"
NIGHT_MAX_PR=10 ok "raising the cap reopens claiming" "$(NIGHT_MAX_PR=10 night_cap_reached 23 && echo capped || echo open)" "open"
ok "junk counter file -> treated as 0"  "$(echo garbage > "$STATE_DIR/.night-$TODAY"; night_count 23)" "0"

echo "────────────────────────────"
echo "night-shift tests: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
