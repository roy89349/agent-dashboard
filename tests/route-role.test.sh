#!/usr/bin/env bash
# Tests for the shell side of the agents registry (lib.sh): route_role precedence + fallback,
# role_field, agent_field. Run:  bash tests/route-role.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/lib.sh"

# Isolate fixtures: point the registry + fleet.json at a temp control dir (lib.sh already sourced config).
CONTROL_DIR="$(mktemp -d)"; export CONTROL_DIR
cleanup(){ rm -rf "$CONTROL_DIR"; }
trap cleanup EXIT

cat > "$CONTROL_DIR/agents.json" <<'JSON'
{ "schema": 1, "rev": 0, "agents": [
  { "id": "frontend", "role": "frontend", "enabled": true,  "model_default": "sonnet", "label_scope": ["frontend","ui"] },
  { "id": "manager",  "role": "manager",  "enabled": true,  "model_default": "sonnet", "label_scope": ["epic"] },
  { "id": "be-off",   "role": "backend",  "enabled": false, "model_default": "sonnet", "label_scope": ["backend"] }
]}
JSON
cat > "$CONTROL_DIR/fleet.json" <<'JSON'
{ "schema": 1, "rev": 0, "tasks": { "5": { "role": "backend" } } }
JSON

PASS=0; FAIL=0
ok(){ # ok <desc> <got> <want>
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); printf '  ✅ %s\n' "$1"
  else FAIL=$((FAIL+1)); printf '  ❌ %s — got [%s] want [%s]\n' "$1" "$2" "$3"; fi
}

echo "── route_role precedence ──"
ok "per-task role wins over label match"   "$(route_role 5 frontend)"        "backend"
ok "label_scope match (no per-task)"        "$(route_role 6 frontend)"        "frontend"
ok "label matches only a DISABLED agent → empty" "$(route_role 6 backend)"   ""
DEFAULT_ROLE=manager ok "configured DEFAULT_ROLE when no per-task/label" "$(DEFAULT_ROLE=manager route_role 7 nolabel)" "manager"
ok "no default + no match → empty (fallback)" "$(route_role 7 nolabel)"      ""

echo "── fallback: no registry at all ──"
rm -f "$CONTROL_DIR/agents.json"
ok "no agents.json + no default seed → empty" "$(AGENTS_DEFAULT_FILE=/nonexistent/agents.json route_role 6 frontend)" ""

echo "── role_field / agent_field ──"
cat > "$CONTROL_DIR/agents.json" <<'JSON'
{ "schema": 1, "rev": 0, "agents": [
  { "id": "frontend", "role": "frontend", "enabled": true,  "model_default": "sonnet", "label_scope": ["frontend","ui"] },
  { "id": "be-off",   "role": "backend",  "enabled": false, "model_default": "opus",   "label_scope": ["backend"] }
]}
JSON
ok "role_field: first enabled agent of role"      "$(role_field frontend model_default)" "sonnet"
ok "role_field: disabled-only role → empty"       "$(role_field backend model_default)"  ""
ok "agent_field: array joined by comma"           "$(agent_field frontend label_scope)"  "frontend,ui"
ok "agent_field: unknown agent → empty"           "$(agent_field nope model_default)"    ""

echo "────────────────────────────"
echo "route_role tests: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
