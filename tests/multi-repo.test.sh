#!/usr/bin/env bash
# Tests for the multi-repo helpers (lib.sh): repos_list parsing (valid, missing file,
# invalid id, disabled, junk JSON), repo_field lookups, claim-string round-trip helpers,
# state-file naming and namespaced emit — all pure/local, no gh calls, no real state.
# Run:  bash tests/multi-repo.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/lib.sh"

# Isolate fixtures: repos.json, state and event log all go to a temp dir.
TMP="$(mktemp -d)"
cleanup(){ rm -rf "$TMP"; }
trap cleanup EXIT
mkdir -p "$TMP/logs" "$TMP/state"
REPOS_FILE="$TMP/repos.json"; export REPOS_FILE
STATE_DIR="$TMP/state";       export STATE_DIR
FLEET_DIR="$TMP"              # emit writes $FLEET_DIR/logs/events.jsonl → temp, not the real log
SUPABASE_MC_URL="" SUPABASE_MC_WRITE_KEY=""   # push_telemetry = no-op

PASS=0; FAIL=0
ok(){ # ok <desc> <got> <want>
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); printf '  ✅ %s\n' "$1"
  else FAIL=$((FAIL+1)); printf '  ❌ %s — got [%s] want [%s]\n' "$1" "$2" "$3"; fi
}

echo "── repos_list: no file / junk file ──"
rm -f "$REPOS_FILE"
ok "missing file -> empty output"        "$(repos_list 2>/dev/null)" ""
ok "missing file -> exit 0"              "$(repos_list 2>/dev/null; echo $?)" "0"
printf 'not json at all' >"$REPOS_FILE"
ok "invalid JSON -> empty output"        "$(repos_list 2>/dev/null)" ""
printf '{"rev":1,"repos":"nope"}' >"$REPOS_FILE"
ok "repos not a list -> empty output"    "$(repos_list 2>/dev/null)" ""

echo "── repos_list: valid registry ──"
cat >"$REPOS_FILE" <<'JSON'
{ "rev": 3, "repos": [
  { "id": "tapsafe", "repo": "roy/tapsafe", "dir": "/tmp/tapsafe", "name": "TapSafe",
    "desc": "NL familie-app", "green_cmd": "npm run build", "enabled": true },
  { "id": "slipbase", "repo": "roy/slipbase", "dir": "/tmp/slipbase", "name": "Slipbase",
    "desc": "", "green_cmd": "npm test", "enabled": true }
] }
JSON
ok "two enabled repos -> two lines"      "$(repos_list 2>/dev/null | wc -l | tr -d ' ')" "2"
ok "line = id,repo,dir,green_cmd,name"   "$(repos_list 2>/dev/null | head -1)" "$(printf 'tapsafe\troy/tapsafe\t/tmp/tapsafe\tnpm run build\tTapSafe')"
ok "file order is preserved"             "$(repos_list 2>/dev/null | tail -1 | cut -f1)" "slipbase"

echo "── repos_list: invalid/disabled entries are skipped, never crash ──"
cat >"$REPOS_FILE" <<'JSON'
{ "rev": 4, "repos": [
  { "id": "ok-repo", "repo": "roy/ok", "dir": "/tmp/ok", "name": "OK", "green_cmd": "true", "enabled": true },
  { "id": "UPPER",   "repo": "roy/x",  "dir": "/tmp/x", "enabled": true },
  { "id": "-lead",   "repo": "roy/x",  "dir": "/tmp/x", "enabled": true },
  { "id": "waaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaay-too-long-id", "repo": "roy/x", "dir": "/tmp/x", "enabled": true },
  { "id": "no-dir",  "repo": "roy/x",  "dir": "", "enabled": true },
  { "id": "no-slash","repo": "justname", "dir": "/tmp/x", "enabled": true },
  { "id": "off",     "repo": "roy/off", "dir": "/tmp/off", "enabled": false },
  "not-an-object",
  { "repo": "roy/anon", "dir": "/tmp/anon", "enabled": true }
] }
JSON
ok "only the one valid+enabled survives" "$(repos_list 2>/dev/null | wc -l | tr -d ' ')" "1"
ok "the survivor is ok-repo"             "$(repos_list 2>/dev/null | cut -f1)" "ok-repo"
ok "warnings go to stderr, not stdout"   "$(repos_list 2>&1 >/dev/null | grep -c skipped)" "6"
ok "name defaults to the id"             "$(printf '{"repos":[{"id":"noname","repo":"a/b","dir":"/tmp/x","enabled":true}]}' >"$REPOS_FILE"; repos_list 2>/dev/null | cut -f5)" "noname"
ok "enabled missing -> treated as on"    "$(printf '{"repos":[{"id":"dflt","repo":"a/b","dir":"/tmp/x"}]}' >"$REPOS_FILE"; repos_list 2>/dev/null | cut -f1)" "dflt"

echo "── repo_field ──"
cat >"$REPOS_FILE" <<'JSON'
{ "repos": [
  { "id": "tapsafe", "repo": "roy/tapsafe", "dir": "/tmp/tapsafe", "name": "TapSafe",
    "desc": "NL familie-app", "green_cmd": "npm run build", "enabled": true },
  { "id": "paused", "repo": "roy/paused", "dir": "/tmp/paused", "enabled": false }
] }
JSON
ok "repo_field repo"                     "$(repo_field tapsafe repo)" "roy/tapsafe"
ok "repo_field dir"                      "$(repo_field tapsafe dir)" "/tmp/tapsafe"
ok "repo_field green_cmd"                "$(repo_field tapsafe green_cmd)" "npm run build"
ok "repo_field desc"                     "$(repo_field tapsafe desc)" "NL familie-app"
ok "repo_field bool -> true/false"       "$(repo_field tapsafe enabled)" "true"
ok "unknown id -> empty"                 "$(repo_field nope repo)" ""
ok "unknown field -> empty"              "$(repo_field tapsafe banana)" ""
ok "DISABLED repo still resolves (in-flight tasks)" "$(repo_field paused repo)" "roy/paused"
ok "no file -> empty, exit 0"            "$(rm -f "$REPOS_FILE"; repo_field tapsafe repo; echo "x$?")" "x0"

echo "── claim-string round trip ──"
ok "primary claim: issue"                "$(claim_issue_of 42)" "42"
ok "primary claim: repo id is empty"     "$(claim_repo_of 42)" ""
ok "secondary claim: issue"              "$(claim_issue_of 'tapsafe#7')" "7"
ok "secondary claim: repo id"            "$(claim_repo_of 'tapsafe#7')" "tapsafe"
ok "id with dashes round-trips"          "$(claim_repo_of 'my-app-2#123')#$(claim_issue_of 'my-app-2#123')" "my-app-2#123"

echo "── valid_repo_id ──"
v(){ valid_repo_id "$1" && echo yes || echo no; }
ok "plain slug ok"                       "$(v tapsafe)" "yes"
ok "digits + dashes ok"                  "$(v a1-b2)" "yes"
ok "single char ok"                      "$(v x)" "yes"
ok "32 chars ok"                         "$(v abcdefghijklmnopqrstuvwxyz012345)" "yes"
ok "33 chars rejected"                   "$(v abcdefghijklmnopqrstuvwxyz0123456)" "no"
ok "uppercase rejected"                  "$(v TapSafe)" "no"
ok "leading dash rejected"               "$(v -x)" "no"
ok "empty rejected"                      "$(v '')" "no"
ok "slash rejected"                      "$(v 'a/b')" "no"

echo "── state-file naming + namespaced emit ──"
ok "primary state file (legacy name)"    "$(state_file 12)" "$STATE_DIR/issue-12.json"
ok "secondary state file is namespaced"  "$(state_file 12 tapsafe)" "$STATE_DIR/issue-tapsafe--12.json"
emit 5 building '{"title":"t"}' 2>/dev/null; wait
ok "primary emit -> legacy state file"   "$(test -f "$STATE_DIR/issue-5.json" && echo yes)" "yes"
ok "primary emit adds NO repo key"       "$(python3 -c 'import json;print("repo" in json.load(open("'"$STATE_DIR"'/issue-5.json")))')" "False"
( FLEET_REPO_ID=tapsafe; emit 5 building '{"title":"t"}' 2>/dev/null; wait )
ok "namespaced emit -> issue-tapsafe--5.json" "$(test -f "$STATE_DIR/issue-tapsafe--5.json" && echo yes)" "yes"
ok "namespaced state carries repo id"    "$(python3 -c 'import json;print(json.load(open("'"$STATE_DIR"'/issue-tapsafe--5.json"))["repo"])')" "tapsafe"
ok "event line carries repo id"          "$(grep -c '"repo": *"tapsafe"' "$TMP/logs/events.jsonl")" "1"
ok "primary event line has no repo key"  "$(head -1 "$TMP/logs/events.jsonl" | grep -c repo || true)" "0"

echo "────────────────────────────"
echo "multi-repo tests: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
