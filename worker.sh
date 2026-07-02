#!/usr/bin/env bash
# worker.sh <issue-number> — safely builds ONE claimed (agent-wip) task:
# crash-trap → model-routing → build → secret-gate → build-gate → PR → reviewer → notify.
set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

NUM="${1:?usage: worker.sh <issue-number>}"
TITLE="$(gh issue view "$NUM" --repo "$REPO" --json title -q .title)"
BODY="$(gh issue view "$NUM" --repo "$REPO" --json body -q .body)"
LABELS="$(gh issue view "$NUM" --repo "$REPO" --json labels -q '[.labels[].name]|join(",")' 2>/dev/null || true)"
SLUG="$(printf '%s' "$TITLE" | tr 'A-Z' 'a-z' | tr -cs 'a-z0-9' '-' | sed 's/^-*//;s/-*$//' | cut -c1-40)"
BRANCH="agent/issue-$NUM-$SLUG"
WT="$FLEET_DIR/worktrees/issue-$NUM"
AGENT_LOG="$FLEET_DIR/logs/issue-$NUM.agent.log"
GATE_LOG="$FLEET_DIR/logs/issue-$NUM.gate.log"

# ── live heartbeat per slot (feeds the "who-does-what" lanes in the dashboard) ──
WORKER_START="$(ts)"
FLEET_SLOT="${FLEET_SLOT:-0}"           # slot index passed in by the supervisor
HB="$STATE_DIR/worker-$FLEET_SLOT.json" # full heartbeat (written by the beater)
PHASEF="$STATE_DIR/worker-$FLEET_SLOT.phase"  # current phase (written by this foreground worker)
BEATER_PID=""

# compose_beat: assemble the heartbeat (fresh beat_ts) and write it atomically. Only writer = the beater.
compose_beat(){
  local ph; ph="$(cat "$PHASEF" 2>/dev/null)"
  python3 - "$FLEET_SLOT" "$NUM" "$$" "${MODEL_SEL:-}" "$ph" "$TITLE" "$WORKER_START" "$(ts)" "${EFFORT_SEL:-}" "${DEPTH_SEL:-}" "${ROLE_SEL:-}" "${AGENT_ID_SEL:-}" "${AGENT_NAME_SEL:-}" <<'PY' | atomic_write "$HB"
import json,sys
slot,issue,pid,model,phase,title,started,beat,effort,depth,role,agent_id,agent_name=sys.argv[1:14]
def i(x):
    try: return int(x)
    except Exception: return None
print(json.dumps({"slot":i(slot),"issue":i(issue),"pid":i(pid),"model":model or None,
  "phase":phase or None,"title":title,"started_at":started,"beat_ts":beat,"effort":effort or None,"depth":depth or None,
  "role":role or None,"agent_id":agent_id or None,"agent_name":agent_name or None},ensure_ascii=False))
PY
}
# set_phase: foreground worker owns the phase file; ping the beater so the heartbeat updates immediately.
set_phase(){
  printf '%s' "$1" | atomic_write "$PHASEF"
  [ -n "$BEATER_PID" ] && kill -USR1 "$BEATER_PID" 2>/dev/null
  return 0
}

cleanup(){
  [ -n "$BEATER_PID" ] && kill "$BEATER_PID" 2>/dev/null
  rm -f "$HB" "$PHASEF" 2>/dev/null || true
  git -C "$REPO_DIR" worktree remove --force "$WT" 2>/dev/null || true
}
fail(){
  log "❌ #$NUM FAIL: $*"
  emit "$NUM" failed "$(json_obj error "$*")"
  gh issue edit "$NUM" --repo "$REPO" --add-label agent-failed --remove-label agent-wip >/dev/null 2>&1 || true
  gh issue comment "$NUM" --repo "$REPO" --body "🤖 Could not get this green: $*" >/dev/null 2>&1 || true
  notify "❌ the fleet: #$NUM failed — $*"
  cleanup; exit 1
}
# Signal trap. Distinguish cancel (do NOT resume) from a regular kill/stop (do resume)
# via the marker control/cancel/<issue> that the supervisor creates BEFORE the signal.
# This way there is exactly one label writer per outcome (no race with the supervisor).
on_signal(){
  [ -n "$BEATER_PID" ] && kill "$BEATER_PID" 2>/dev/null
  if [ -f "$CONTROL_DIR/cancel/$NUM" ]; then
    log "🚫 #$NUM cancelled via control-plane"
    gh issue edit "$NUM" --repo "$REPO" --add-label agent-cancelled --remove-label agent-wip >/dev/null 2>&1 || true
    emit "$NUM" cancelled '{}'
    rm -f "$CONTROL_DIR/cancel/$NUM" 2>/dev/null || true
  else
    log "⚠️ #$NUM interrupted — back to agent-ready"
    gh issue edit "$NUM" --repo "$REPO" --add-label agent-ready --remove-label agent-wip >/dev/null 2>&1 || true
    emit "$NUM" interrupted '{}'
  fi
  cleanup; exit 130
}
trap on_signal INT TERM

# dedup: is there already an open PR for this branch? do not rebuild
if gh pr list --repo "$REPO" --state open --json headRefName -q '.[].headRefName' 2>/dev/null | grep -qx "$BRANCH"; then
  log "ℹ️ #$NUM already has an open PR ($BRANCH) — mark agent-done"
  gh issue edit "$NUM" --repo "$REPO" --add-label agent-done --remove-label agent-wip >/dev/null 2>&1 || true
  emit "$NUM" pr-open "$(json_obj note 'existing-PR')"
  exit 0
fi

log "🎯 #$NUM: $TITLE"
MODEL_SEL="$(route_model "$NUM" "$TITLE" "$BODY")"
EFFORT_SEL="$(route_effort "$NUM")"
DEPTH_SEL="$(route_depth "$NUM")"
# Responsible role + its registry agent (display only — drives the who-does-what lanes/cards).
# Empty when nothing routes (no label_scope match, no per-task role, no DEFAULT_ROLE) → old anonymous slot.
ROLE_SEL="$(route_role "$NUM" "$LABELS" 2>/dev/null || true)"
AGENT_ID_SEL=""; AGENT_NAME_SEL=""
if [ -n "$ROLE_SEL" ]; then
  AGENT_ID_SEL="$(role_field "$ROLE_SEL" id 2>/dev/null || true)"
  AGENT_NAME_SEL="$(role_field "$ROLE_SEL" name 2>/dev/null || true)"
fi
log "🧠 model: $MODEL_SEL · effort: $EFFORT_SEL · depth: $DEPTH_SEL${ROLE_SEL:+ · role: $ROLE_SEL${AGENT_NAME_SEL:+ ($AGENT_NAME_SEL)}}"

# Start the heartbeat beater: refreshes the heartbeat every HEARTBEAT_SEC (so a long
# build is not falsely marked 'stale') + immediately on every phase change (USR1). Stops itself when
# the worker disappears (kill -0 $$), as a backstop against an orphaned beater on SIGKILL.
# NB: bash defers traps until an external 'sleep' finishes, so we sleep in the background
# and 'wait' on it (builtin) — that one IS interrupted immediately by USR1.
( trap 'compose_beat' USR1
  while kill -0 "$$" 2>/dev/null; do
    compose_beat
    sleep "${HEARTBEAT_SEC:-10}" & wait $! 2>/dev/null
  done ) &
BEATER_PID=$!

emit "$NUM" building "$(json_obj title "$TITLE" branch "$BRANCH" model "$MODEL_SEL" effort "$EFFORT_SEL" depth "$DEPTH_SEL")"; set_phase building

git -C "$REPO_DIR" fetch -q origin main || fail "git fetch failed"
# clean up ONLY any stale worktree — do NOT kill the beater/heartbeat (otherwise
# the live view disappears + orphan adoption fails → double-claim). Full cleanup() stays
# exclusively on the terminal paths (fail/on_signal/end-of-run).
git -C "$REPO_DIR" worktree remove --force "$WT" 2>/dev/null || true
git -C "$REPO_DIR" push origin --delete "$BRANCH" >/dev/null 2>&1 || true   # clean up stale remote branch without PR
git -C "$REPO_DIR" branch -D "$BRANCH" >/dev/null 2>&1 || true              # drop stale LOCAL branch (retry-safe, e.g. after a re-labelled fail)
git -C "$REPO_DIR" worktree add -q -b "$BRANCH" "$WT" origin/main || fail "worktree add failed"
# npm install now runs INSIDE the sandbox (see deploy/sandbox/run-build.sh) — no host-side repo install.

ADDDIR=()
VAULT_NOTE=""
if [ -n "${VAULT_DIR:-}" ] && [ -d "$VAULT_DIR" ]; then
  ADDDIR=(--add-dir "$VAULT_DIR")
  VAULT_NOTE="
- A knowledge base (notes vault) is attached via --add-dir; consult it for relevant context and record durable learnings there when useful."
fi

# Depth: solo (default) or orchestrate (fan out into sub-agents). Orchestrate gets more turns.
TURNS="$MAX_TURNS"; ORCH_NOTE=""
if [ "${DEPTH_SEL:-solo}" = "orchestrate" ]; then
  TURNS="${ORCH_MAX_TURNS:-60}"
  ORCH_NOTE="
- ORCHESTRATE this task: decompose it and use the Task tool to run multiple sub-agents in parallel on independent parts (different files/areas), then integrate their work, resolve conflicts and make the build pass. Never let two sub-agents edit the same file at once."
fi

PROMPT="You are an autonomous software engineer working in an isolated git worktree on branch '$BRANCH' for ${PROJECT_NAME}${PROJECT_DESC:+ ($PROJECT_DESC)}.

TASK (issue #$NUM): $TITLE

$BODY

RULES:
- Implement ONLY this task; focused and minimal.
- Follow existing conventions and CLAUDE.md if present.
- Run '$GREEN_CMD' and fix any errors YOU introduce until it passes.
- Do NOT git commit/push/checkout; the harness handles git.
- Do NOT touch secrets/.env files/deploy config/.github/workflows, or anything outside this task's scope.$VAULT_NOTE$ORCH_NOTE
- End with a 1-3 sentence summary of what you changed."

# build_on_host <wt> <model> <effort> <maxturns> <promptfile> — the SAME pipeline as the sandbox,
# but run directly on the HOST (NO isolation). ONLY used when FLEET_SANDBOX=off (local dev without
# podman). Same exit contract as deploy/sandbox/run-build.sh: 0=ok · 21/22=install · 23=green-gate.
build_on_host(){
  ( cd "$1" || exit 30
    npm ci --no-audit --no-fund 2>/dev/null || npm install --no-audit --no-fund || exit 21
    _pb="$(md5sum package.json 2>/dev/null || true)"
    claude -p "$(cat "$5")" --model "$2" --effort "$3" --dangerously-skip-permissions --max-turns "$4" || echo "claude exit≠0 (gates decide)"
    _pa="$(md5sum package.json 2>/dev/null || true)"
    [ "$_pb" = "$_pa" ] || { npm install --no-audit --no-fund || exit 22; }
    eval "$GREEN_CMD" || exit 23 )
}

PROMPT_FILE="$FLEET_DIR/logs/issue-$NUM.prompt.txt"
printf '%s' "$PROMPT" > "$PROMPT_FILE"
# ── BUILD STEP — sandbox (default) or host-fallback (FLEET_SANDBOX=off). Install + agent + green-gate
# run together; git push + PR stay OUTSIDE this orchestrator (credential broker). See deploy/sandbox/. ──
if [ "${FLEET_SANDBOX:-on}" = off ] || [ "${FLEET_SANDBOX:-on}" = 0 ]; then
  log "⚠️  FLEET_SANDBOX=off — building ON THE HOST (no isolation; agent can read host secrets). Dev only."
  build_on_host "$WT" "$MODEL_SEL" "$EFFORT_SEL" "$TURNS" "$PROMPT_FILE" >"$AGENT_LOG" 2>&1; BUILD_RC=$?
elif command -v podman >/dev/null 2>&1; then
  log "🛠  building in sandbox (image=$SANDBOX_IMAGE, model=$MODEL_SEL, effort=$EFFORT_SEL, max-turns=$TURNS)…"
  GREEN_CMD="$GREEN_CMD" "$FLEET_DIR/deploy/sandbox/run-build.sh" "$WT" "$MODEL_SEL" "$EFFORT_SEL" "$TURNS" "$PROMPT_FILE" >"$AGENT_LOG" 2>&1; BUILD_RC=$?
else
  rm -f "$PROMPT_FILE"
  fail "FLEET_SANDBOX=on but podman is not installed — install it (deploy/bootstrap.sh) or set FLEET_SANDBOX=off for host-mode dev"
fi
rm -f "$PROMPT_FILE"
case "$BUILD_RC" in
  0) : ;;
  21|22) fail "dependency install failed — $(tail -n 2 "$AGENT_LOG" | tr '\n' ' ')" ;;
  23) fail "green-gate failed — $(tail -n 2 "$AGENT_LOG" | tr '\n' ' ')" ;;
  *)  fail "build infrastructure error (rc=$BUILD_RC) — $(tail -n 2 "$AGENT_LOG" | tr '\n' ' ')" ;;
esac

# stage everything, then run the gates
git -C "$WT" add -A
# visual-PR screenshots (made pre-commit inside the sandbox) must NEVER enter the PR:
# unstage .fleet-screens BEFORE the no-change check, the secret-gate and the commit.
# The files stay on disk in the worktree — worker posts the first PNG after the PR opens.
git -C "$WT" rm -r -q --cached --ignore-unmatch -- .fleet-screens 2>/dev/null || true
git -C "$WT" diff --cached --quiet && fail "agent made no changes"

# ── SECRET-GATE (before the expensive build): reject dangerous files + secret patterns ──
if git -C "$WT" diff --cached --name-only | grep -qE '(^|/)\.env|(^|/)\.github/workflows/'; then
  fail "change touches a .env or .github/workflows file — rejected (secret/CI risk)"
fi
if git -C "$WT" diff --cached | grep -qE "$SECRET_RE"; then
  fail "diff contains a possible secret — rejected"
fi

# ── SECURITY-GATE (config-driven blocking agent; runs between the secret-gate and the green-gate) ──
# Runs ONLY when an enabled agent with role 'security' exists in agents.json — otherwise skipped
# (backward compatible: the prior flow had no security phase). It reads the STAGED diff (analysis
# only, no code execution) and returns a verdict. A blocking REJECT (or an unparseable verdict when
# blocking) ends the task via fail() — same failure flow, agent-failed label and breaker fuel as any
# other failure. It NEVER writes labels itself (only emit/set_phase + the existing fail()).
SEC_ID="$(role_field security id)"
if [ -n "$SEC_ID" ]; then
  emit "$NUM" security '{}'; set_phase security
  SEC_BLOCK="$(role_field security blocking)"; [ -n "$SEC_BLOCK" ] || SEC_BLOCK=true
  SEC_MODEL="$(role_field security model_default)"
  { [ "$SEC_MODEL" = opus ] && [ "${ALLOW_GLOBAL_OPUS:-0}" != 1 ]; } && SEC_MODEL=sonnet
  [ -n "$SEC_MODEL" ] || SEC_MODEL=sonnet
  SEC_DIFF="$(git -C "$WT" diff --cached | head -c 60000)"
  SEC_OUT="$(claude -p "You are a strict application SECURITY reviewer for ${PROJECT_NAME}. Review ONLY this staged git diff and decide if it is safe to merge.
Flag any of: hardcoded secrets / API keys / credentials or credential exposure; new or changed .env / config / secret files; authentication or authorization changes; added or changed dependencies (supply-chain); database schema or migration changes; GitHub Actions / workflow changes.
Answer EXACTLY: line 1 = a single verdict word — APPROVE, CAUTION or REJECT; then up to 5 short bullets naming the security-relevant findings (or 'no security-relevant changes'). Use REJECT only for a real exploitable risk or a leaked secret; CAUTION when a human must look; APPROVE when nothing is security-relevant.

DIFF:
$SEC_DIFF" --model "$SEC_MODEL" 2>/dev/null)"
  SEC_VERDICT="$(parse_verdict "$SEC_OUT")"
  log "🛡  security agent ($SEC_MODEL) verdict: $SEC_VERDICT (blocking=$SEC_BLOCK)"
  emit "$NUM" security "$(json_obj verdict "$SEC_VERDICT" blocking "$SEC_BLOCK")"
  if [ "$(security_decision "$SEC_VERDICT" "$SEC_BLOCK")" = fail ]; then
    fail "security agent $SEC_VERDICT (blocking) — $(printf '%s' "$SEC_OUT" | head -n1 | head -c 200)"
  fi
  [ "$SEC_VERDICT" = reject ] && log "⚠️ security REJECT is advisory (agent non-blocking) — continuing"
fi

# ── GREEN-GATE already ran inside the sandbox (exit code checked above) ──
emit "$NUM" gating '{}'; set_phase gating
log "🚦 green-gate passed in sandbox: $GREEN_CMD"

# ── COMMIT + PUSH + PR ──
GIT_EMAIL_USE="${GIT_EMAIL:-}"; [ -n "$GIT_EMAIL_USE" ] || GIT_EMAIL_USE="$(git -C "$REPO_DIR" config user.email 2>/dev/null)"
git -C "$WT" -c user.name="${GIT_NAME:-mission-control}" -c user.email="$GIT_EMAIL_USE" \
  commit -q -m "$TITLE

Closes #$NUM

🤖 Autonomously built by the fleet ($MODEL_SEL)"
git -C "$WT" push -q -u origin "$BRANCH" || fail "git push failed"
PR_URL="$(gh pr create --repo "$REPO" --base main --head "$BRANCH" --title "$TITLE" \
  --body "Closes #$NUM

🤖 Autonomously built by your agent fleet (model: $MODEL_SEL). Green-gate \`$GREEN_CMD\` passed. Review & merge — or close.")" \
  || fail "gh pr create failed"
log "✅ PR: $PR_URL"
emit "$NUM" pr-open "$(json_obj pr_url "$PR_URL")"; set_phase pr-open
gh issue edit "$NUM" --repo "$REPO" --add-label agent-done --remove-label agent-wip >/dev/null 2>&1 || true
gh issue comment "$NUM" --repo "$REPO" --body "🤖 PR opened: $PR_URL" >/dev/null 2>&1 || true
# From here the task is DONE (PR open, label agent-done). Disarm the interrupt trap so that
# a kill/cancel/stop during the reviewer phase does not relabel the issue back to ready/cancelled.
trap - INT TERM

# ── VISUAL PR APPROVAL (host side) — post the first sandbox screenshot + a diff summary to the
# dashboard, right after the PR opened. Strictly best-effort: every failure only logs/emits and
# NEVER affects the task (the PR is already open). The token is read from $MC_ENV_FILE on the
# HOST via mc_watchdog_token (lib.sh) — it never enters the sandbox container. The review verdict
# is not known yet at this point, so it is omitted (the dashboard side treats it as optional).
FIRST_PNG="$(ls "$WT/.fleet-screens/"*.png 2>/dev/null | head -n1)"
if [ -n "$FIRST_PNG" ]; then
  VIS_TOKEN="$(mc_watchdog_token)"
  if [ -n "$VIS_TOKEN" ]; then
    PR_NUM="${PR_URL##*/}"
    VIS_DIFFSTAT="$(git -C "$WT" diff --stat origin/main...HEAD 2>/dev/null | tail -20)"
    VIS_FILES="$(git -C "$WT" diff --name-only origin/main...HEAD 2>/dev/null)"
    if curl -m 30 -sf -o /dev/null -X POST \
         -H "X-Watchdog-Token: $VIS_TOKEN" \
         -F "screenshot=@$FIRST_PNG;type=image/png" \
         -F "pr=$PR_NUM" -F "issue=$NUM" -F "title=$TITLE" \
         -F "diffstat=$VIS_DIFFSTAT" -F "files=$VIS_FILES" \
         "$MC_URL/api/fleet/pr-visual" 2>/dev/null; then
      log "📸 pr-visual sent to dashboard ($(basename "$FIRST_PNG"))"
      emit "$NUM" pr-visual "$(json_obj status sent pr_url "$PR_URL")"
    else
      log "📸 pr-visual POST failed (non-blocking)"
      emit "$NUM" pr-visual "$(json_obj status failed pr_url "$PR_URL")"
    fi
  else
    log "📸 pr-visual skipped: no MC_WATCHDOG_TOKEN in ${MC_ENV_FILE:-<unset>}"
    emit "$NUM" pr-visual "$(json_obj status skipped reason no-token)"
  fi
elif [ "${FLEET_SCREENSHOT:-off}" = on ]; then
  emit "$NUM" pr-visual "$(json_obj status skipped reason no-screenshot)"
fi

# ── REVIEWER-AGENT (config-driven QA agent; live on/off via control-plane REVIEW) ──
# The reviewer is now driven by the 'qa' agent in agents.json (model/name/prompt), but stays gated by
# REVIEW for backward compatibility and stays ADVISORY (the PR is already open — it comments, never
# blocks). Falls back to REVIEW_MODEL + the built-in prompt when no qa agent / registry is present.
REVIEW_EFF="$(fleet_get review "${REVIEW:-on}")"
if [ "$REVIEW_EFF" = "on" ]; then
  RV_MODEL="$(role_field qa model_default)"
  { [ "$RV_MODEL" = opus ] && [ "${ALLOW_GLOBAL_OPUS:-0}" != 1 ]; } && RV_MODEL=sonnet
  [ -n "$RV_MODEL" ] || RV_MODEL="${REVIEW_MODEL:-sonnet}"
  RV_NAME="$(role_field qa name)"; [ -n "$RV_NAME" ] || RV_NAME="Reviewer-agent"
  RV_REF="$(role_field qa system_prompt_ref)"
  if [ -n "$RV_REF" ] && [ -f "$FLEET_DIR/$RV_REF" ]; then RV_SYS="$(cat "$FLEET_DIR/$RV_REF")"
  else RV_SYS="You are a strict senior code reviewer. Review this PR diff for ${PROJECT_NAME}. Answer in English: line 1 = verdict starting with exactly one of ✅ / ⚠️ / ❌; then 2-5 bullets with concrete points (bugs, scope creep, security, edge cases, style); optional short suggestions. Honest and concise."
  fi
  log "🔎 reviewer-agent ($RV_NAME, $RV_MODEL)…"
  DIFF="$(gh pr diff "$PR_URL" --repo "$REPO" 2>/dev/null | head -c 60000)"
  if [ -n "$DIFF" ]; then
    REVIEW_OUT="$(claude -p "$RV_SYS

DIFF:
$DIFF" --model "$RV_MODEL" 2>/dev/null)"
    if [ -n "$REVIEW_OUT" ]; then
      gh pr comment "$PR_URL" --repo "$REPO" --body "🔎 **$RV_NAME**

$REVIEW_OUT" >/dev/null 2>&1 || true
      VERDICT="$(parse_verdict "$REVIEW_OUT")"; [ "$VERDICT" = unknown ] && VERDICT=reviewed
      emit "$NUM" reviewed "$(json_obj pr_url "$PR_URL" review_verdict "$VERDICT")"; set_phase reviewed
      log "🔎 verdict: $VERDICT"
    fi
  fi
fi

notify "✅ the fleet: PR ready for #$NUM — $TITLE
$PR_URL"
cleanup
log "🏁 done with #$NUM"
