#!/usr/bin/env bash
# worker.sh <issue-number> — safely builds ONE claimed (agent-wip) task:
# crash-trap → model-routing → build → secret-gate → build-gate → PR → reviewer → notify.
set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

NUM="${1:?usage: worker.sh <issue-number>}"
TITLE="$(gh issue view "$NUM" --repo "$REPO" --json title -q .title)"
BODY="$(gh issue view "$NUM" --repo "$REPO" --json body -q .body)"
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
  python3 - "$FLEET_SLOT" "$NUM" "$$" "${MODEL_SEL:-}" "$ph" "$TITLE" "$WORKER_START" "$(ts)" "${EFFORT_SEL:-}" <<'PY' | atomic_write "$HB"
import json,sys
slot,issue,pid,model,phase,title,started,beat,effort=sys.argv[1:10]
def i(x):
    try: return int(x)
    except Exception: return None
print(json.dumps({"slot":i(slot),"issue":i(issue),"pid":i(pid),"model":model or None,
  "phase":phase or None,"title":title,"started_at":started,"beat_ts":beat,"effort":effort or None},ensure_ascii=False))
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
log "🧠 model: $MODEL_SEL · effort: $EFFORT_SEL"

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

emit "$NUM" building "$(json_obj title "$TITLE" branch "$BRANCH" model "$MODEL_SEL" effort "$EFFORT_SEL")"; set_phase building

git -C "$REPO_DIR" fetch -q origin main || fail "git fetch failed"
# clean up ONLY any stale worktree — do NOT kill the beater/heartbeat (otherwise
# the live view disappears + orphan adoption fails → double-claim). Full cleanup() stays
# exclusively on the terminal paths (fail/on_signal/end-of-run).
git -C "$REPO_DIR" worktree remove --force "$WT" 2>/dev/null || true
git -C "$REPO_DIR" push origin --delete "$BRANCH" >/dev/null 2>&1 || true   # clean up stale branch without PR
git -C "$REPO_DIR" worktree add -q -b "$BRANCH" "$WT" origin/main || fail "worktree add failed"
log "📦 npm install…"
( cd "$WT" && npm install --prefer-offline --no-audit --no-fund ) >>"$AGENT_LOG" 2>&1 || fail "npm install failed"

PROMPT="You are an autonomous software engineer working in an isolated git worktree on branch '$BRANCH' for ${PROJECT_NAME}${PROJECT_DESC:+ ($PROJECT_DESC)}.

TASK (issue #$NUM): $TITLE

$BODY

RULES:
- Implement ONLY this task; focused and minimal.
- Follow existing conventions and CLAUDE.md if present.
- Run '$GREEN_CMD' and fix any errors YOU introduce until it passes.
- Do NOT git commit/push/checkout; the harness handles git.
- Do NOT touch secrets/.env files/deploy config/.github/workflows, or anything outside this task's scope.
- End with a 1-3 sentence summary of what you changed."

log "🛠  building (model=$MODEL_SEL, max-turns=$MAX_TURNS)…"
( cd "$WT" && claude -p "$PROMPT" --model "$MODEL_SEL" --effort "$EFFORT_SEL" --dangerously-skip-permissions --max-turns "$MAX_TURNS" ) \
  >"$AGENT_LOG" 2>&1 || log "claude exit≠0 (the gates decide from here)"

if [ -n "$(git -C "$WT" status --porcelain -- package.json package-lock.json 2>/dev/null)" ]; then
  log "📦 deps changed → reinstalling"
  ( cd "$WT" && npm install --no-audit --no-fund --prefer-offline ) >>"$AGENT_LOG" 2>&1 || fail "npm install (deps) failed"
fi

# stage everything, then run the gates
git -C "$WT" add -A
git -C "$WT" diff --cached --quiet && fail "agent made no changes"

# ── SECRET-GATE (before the expensive build): reject dangerous files + secret patterns ──
if git -C "$WT" diff --cached --name-only | grep -qE '(^|/)\.env|(^|/)\.github/workflows/'; then
  fail "change touches a .env or .github/workflows file — rejected (secret/CI risk)"
fi
if git -C "$WT" diff --cached | grep -qE "$SECRET_RE"; then
  fail "diff contains a possible secret — rejected"
fi

# ── GREEN-GATE ──
emit "$NUM" gating '{}'; set_phase gating
log "🚦 green-gate: $GREEN_CMD"
( cd "$WT" && eval "$GREEN_CMD" ) >"$GATE_LOG" 2>&1 || fail "green-gate failed — $(tail -n 2 "$GATE_LOG" | tr '\n' ' ')"

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

# ── REVIEWER-AGENT (live on/off via control-plane) ──
REVIEW_EFF="$(fleet_get review "${REVIEW:-on}")"
if [ "$REVIEW_EFF" = "on" ]; then
  log "🔎 reviewer-agent…"
  DIFF="$(gh pr diff "$PR_URL" --repo "$REPO" 2>/dev/null | head -c 60000)"
  if [ -n "$DIFF" ]; then
    REVIEW_OUT="$(claude -p "You are a strict senior code reviewer. Review this PR diff for ${PROJECT_NAME}. Answer in English: line 1 = verdict starting with exactly one of ✅ / ⚠️ / ❌; then 2-5 bullets with concrete points (bugs, scope creep, security, edge cases, style); optional short suggestions. Honest and concise.

DIFF:
$DIFF" --model "${REVIEW_MODEL:-sonnet}" 2>/dev/null)"
    if [ -n "$REVIEW_OUT" ]; then
      gh pr comment "$PR_URL" --repo "$REPO" --body "🔎 **Reviewer-agent**

$REVIEW_OUT" >/dev/null 2>&1 || true
      VERDICT=reviewed
      case "$REVIEW_OUT" in (*❌*) VERDICT=reject;; (*⚠️*) VERDICT=caution;; (*✅*) VERDICT=approve;; esac
      emit "$NUM" reviewed "$(json_obj pr_url "$PR_URL" review_verdict "$VERDICT")"; set_phase reviewed
      log "🔎 verdict: $VERDICT"
    fi
  fi
fi

notify "✅ the fleet: PR ready for #$NUM — $TITLE
$PR_URL"
cleanup
log "🏁 done with #$NUM"
