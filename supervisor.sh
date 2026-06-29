#!/usr/bin/env bash
# supervisor.sh [--once] — keeps up to (live) MAX_WORKERS agents building at once,
# controllable via the control-plane ($CONTROL_DIR/fleet.json + commands.jsonl) and with
# startup recovery, orphan adoption, Claude health-probe, day-cap/budget and circuit-breaker.
# Deliberately bash-3.2-compatible (macOS default): parallel indexed arrays, no 'declare -A'.
set -o pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

ONCE=0; [ "${1:-}" = "--once" ] && ONCE=1
SUPERVISOR_PID=$$

# ── single-supervisor gate: never two supervisors (double-claim) ──
# Atomic lock via mkdir (create-or-fail on macOS+Linux), no TOCTOU.
LOCKD="$CONTROL_DIR/supervisor.lock.d"
if ! mkdir "$LOCKD" 2>/dev/null; then
  OLD="$(cat "$CONTROL_DIR/supervisor.pid" 2>/dev/null)"
  if [ -n "$OLD" ] && kill -0 "$OLD" 2>/dev/null; then
    log "🛑 a supervisor is already running (pid $OLD) — NOT starting."; exit 1
  fi
  # no live pid. Only take over if the lock is OLD (real crash) — a FRESH lock
  # without a pid is another instance that just did mkdir but still has to write its pid.
  if [ -z "$(find "$LOCKD" -prune -mmin +1 2>/dev/null)" ]; then
    log "🛑 fresh supervisor lock without pid (another instance is just starting) — NOT starting."; exit 1
  fi
  rmdir "$LOCKD" 2>/dev/null || true
  mkdir "$LOCKD" 2>/dev/null || { log "🛑 supervisor lock just grabbed by another — NOT starting."; exit 1; }
  log "↩︎ adopted orphaned supervisor lock"
fi
printf '%s' "$SUPERVISOR_PID" | atomic_write "$CONTROL_DIR/supervisor.pid"
trap 'rm -f "$CONTROL_DIR/supervisor.pid" 2>/dev/null; rmdir "$LOCKD" 2>/dev/null || true' EXIT

# hold on to config defaults; fleet.json overrides them live (clamped)
MAX_WORKERS_CFG="$MAX_WORKERS"; MAX_PR_PER_DAY_CFG="$MAX_PR_PER_DAY"; FAIL_BREAK_CFG="$FAIL_BREAK"

# parallel slot arrays (index = slot 0..HARD_MAX_WORKERS-1)
SLOT_PID=(); SLOT_ISSUE=(); SLOT_START=()
i=0; while [ "$i" -lt "$HARD_MAX_WORKERS" ]; do SLOT_PID[$i]=""; SLOT_ISSUE[$i]=""; SLOT_START[$i]=""; i=$((i+1)); done
ADOPTED=""
BREAKER_NOTIFIED=0
STOPPED_SIGNALLED=0

log "🚀 supervisor — hard-max:$HARD_MAX_WORKERS · router:$ROUTER · review:$REVIEW · max-turns:$MAX_TURNS · once:$ONCE"

# ── health-probe: is Claude running at all? (avoids wasting credit on dead auth) ──
if ! claude -p "ok" --model haiku >/dev/null 2>&1; then
  log "🛑 Claude health-probe fails (auth/credit?) — fleet NOT starting."
  notify "🛑 the fleet: Claude health-probe fails — stopped. Check 'claude setup-token' / credit."
  exit 1
fi

# ── helpers ───────────────────────────────────────────────────────────────
clamp_int(){  # clamp_int <val> <min> <max> ; junk/negative -> min
  local v="$1" lo="$2" hi="$3"
  case "$v" in ''|*[!0-9]*) v="$lo";; esac
  [ "$v" -lt "$lo" ] && v="$lo"
  [ "$v" -gt "$hi" ] && v="$hi"
  echo "$v"
}

slot_of_issue(){  # echo slot index where <issue> sits in a LIVE slot, otherwise nothing
  local i
  for i in $(seq 0 $((HARD_MAX_WORKERS-1))); do
    [ "${SLOT_ISSUE[$i]:-}" = "$1" ] && [ -n "${SLOT_PID[$i]:-}" ] && { echo "$i"; return; }
  done
}

live_slots(){ local i n=0; for i in $(seq 0 $((HARD_MAX_WORKERS-1))); do [ -n "${SLOT_PID[$i]:-}" ] && n=$((n+1)); done; echo "$n"; }

free_slot(){  # first free slot index < $1 (requested max_workers)
  local i; for i in $(seq 0 $(($1-1))); do [ -z "${SLOT_PID[$i]:-}" ] && { echo "$i"; return; }; done
}

reap_slots(){  # clean up dead slots (pid gone = slot free)
  local i
  for i in $(seq 0 $((HARD_MAX_WORKERS-1))); do
    if [ -n "${SLOT_PID[$i]:-}" ] && ! kill -0 "${SLOT_PID[$i]}" 2>/dev/null; then
      SLOT_PID[$i]=""; SLOT_ISSUE[$i]=""; SLOT_START[$i]=""
    fi
  done
}

clean_cancel_markers(){  # clean up cancel markers of no-longer-active issues (backstop on SIGKILL)
  local f base
  for f in "$CONTROL_DIR"/cancel/*; do
    [ -e "$f" ] || continue
    base="$(basename "$f")"
    case "$base" in *[!0-9]*) rm -f "$f" 2>/dev/null; continue;; esac
    [ -z "$(slot_of_issue "$base")" ] && rm -f "$f" 2>/dev/null || true
  done
}

iso_to_epoch(){ python3 -c 'import sys,datetime
try: print(int(datetime.datetime.strptime(sys.argv[1],"%Y-%m-%dT%H:%M:%S%z").timestamp()))
except Exception: print("")' "$1" 2>/dev/null; }

# control-ack -> events.jsonl only (audit trail). NEVER overwrite the per-issue state file.
audit(){ local iss="${1:-0}" data="${2:-}"; [ -n "$data" ] || data='{}'
  printf '{"ts":"%s","issue":%s,"state":"control","data":%s}\n' "$(ts)" "$iss" "$data" \
    >>"$FLEET_DIR/logs/events.jsonl" 2>/dev/null || true; }

# adopt_orphans: bring live workers from a previous supervisor back into the slot arrays
adopt_orphans(){
  local i hb pid issue started
  for i in $(seq 0 $((HARD_MAX_WORKERS-1))); do
    hb="$STATE_DIR/worker-$i.json"; [ -f "$hb" ] || continue
    pid="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("pid") or "")' "$hb" 2>/dev/null)"
    issue="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("issue") or "")' "$hb" 2>/dev/null)"
    started="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("started_at") or "")' "$hb" 2>/dev/null)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      SLOT_PID[$i]="$pid"; SLOT_ISSUE[$i]="$issue"; SLOT_START[$i]="$(iso_to_epoch "$started")"
      [ -n "${SLOT_START[$i]}" ] || SLOT_START[$i]="$(date +%s)"
      ADOPTED="$ADOPTED $issue"
      log "♻︎ adopt orphan worker #$issue (slot $i, pid $pid)"
    else
      rm -f "$hb" "$STATE_DIR/worker-$i.phase" 2>/dev/null || true
    fi
  done
}

# apply_command <cmd> <issue> <slot> <id> — dispatch one validated command
apply_command(){
  local cmd="$1" issue="$2" slot="$3" id="$4" idx sz
  case "$cmd" in
    kill)
      idx="$(slot_of_issue "$issue")"
      if [ -n "$idx" ]; then
        log "🔪 kill #$issue (slot $idx, pid ${SLOT_PID[$idx]})"
        kill -TERM "${SLOT_PID[$idx]}" 2>/dev/null || true
      else
        log "🔪 kill #$issue — no longer active, no-op"
      fi
      audit "$issue" "$(json_obj cmd kill id "$id")"
      ;;
    cancel)
      idx="$(slot_of_issue "$issue")"
      if [ -n "$idx" ]; then
        ( umask 077; : >"$CONTROL_DIR/cancel/$issue" ) 2>/dev/null || true   # marker BEFORE the signal
        log "🚫 cancel #$issue (slot $idx)"
        kill -TERM "${SLOT_PID[$idx]}" 2>/dev/null || true
      else
        log "🚫 cancel #$issue — not active, no-op (use cancel-queued via GitHub)"
      fi
      audit "$issue" "$(json_obj cmd cancel id "$id")"
      ;;
    breaker-reset)
      sz="$(wc -c <"$FLEET_DIR/logs/events.jsonl" 2>/dev/null | tr -d ' ')"
      printf '%s' "${sz:-0}" | atomic_write "$CONTROL_DIR/.breaker.offset"
      BREAKER_NOTIFIED=0
      log "🧯 breaker-reset (offset=${sz:-0})"
      audit 0 "$(json_obj cmd breaker-reset id "$id")"
      ;;
  esac
}

# consume_commands — read ONLY new bytes from .cmd.offset (replay impossible),
# process only newline-terminated lines, advance the offset per line (atomic).
consume_commands(){
  local off endb id cmd issue slot n
  off="$(cat "$CONTROL_DIR/.cmd.offset" 2>/dev/null || echo 0)"
  case "$off" in ''|*[!0-9]*) off=0;; esac
  while IFS='|' read -r endb id cmd issue slot; do
    [ -n "$endb" ] || continue
    if [ -n "$cmd" ] && [ -n "$id" ]; then
      if ! grep -qxF -- "$id" "$CONTROL_DIR/commands.done" 2>/dev/null; then
        apply_command "$cmd" "$issue" "$slot" "$id"
        printf '%s\n' "$id" >>"$CONTROL_DIR/commands.done"
      fi
    fi
    printf '%s' "$endb" | atomic_write "$CONTROL_DIR/.cmd.offset"
  done < <(python3 - "$CONTROL_DIR/commands.jsonl" "$off" <<'PY'
import json,sys,re
path,off=sys.argv[1],int(sys.argv[2])
try: raw=open(path,'rb').read()
except FileNotFoundError: raw=b''
if off>len(raw): off=0          # truncation/rotation -> start over from 0
pos=off; seg=raw[off:]
while True:
    nl=seg.find(b'\n')
    if nl<0: break              # trailing partial -> leave for the next tick
    line=seg[:nl]; pos+=nl+1; seg=seg[nl+1:]
    idv=cmd=issue=slot=""
    try:
        o=json.loads(line.decode('utf-8','replace'))
        s=str(o.get('id',''))
        if re.match(r'^[0-9A-Fa-f-]{1,64}$', s): idv=s
        c=str(o.get('cmd',''))
        if c in ('kill','cancel','breaker-reset'): cmd=c
        iv=o.get('issue')
        if isinstance(iv,int) and 1<=iv<=9999999: issue=str(iv)
        sv=o.get('slot')
        if isinstance(sv,int) and 0<=sv<=999: slot=str(sv)
    except Exception:
        pass
    sys.stdout.write("%d|%s|%s|%s|%s\n"%(pos,idv,cmd,issue,slot))
PY
)
  if [ -f "$CONTROL_DIR/commands.done" ]; then
    n="$(wc -l <"$CONTROL_DIR/commands.done" 2>/dev/null | tr -d ' ')"
    [ "${n:-0}" -gt 500 ] && tail -n 500 "$CONTROL_DIR/commands.done" | atomic_write "$CONTROL_DIR/commands.done"
  fi
}

write_slots_tsv(){
  local i tmp="$CONTROL_DIR/.slots.tsv.tmp.$$"
  ( umask 077; : >"$tmp" )
  for i in $(seq 0 $((HARD_MAX_WORKERS-1))); do
    [ -n "${SLOT_PID[$i]:-}" ] || continue
    printf '%s\t%s\t%s\t%s\n' "$i" "${SLOT_PID[$i]}" "${SLOT_ISSUE[$i]}" "${SLOT_START[$i]}" >>"$tmp"
  done
  mv -f "$tmp" "$CONTROL_DIR/.slots.tsv"; chmod 600 "$CONTROL_DIR/.slots.tsv" 2>/dev/null || true
}

# status_write <mode> <can_claim> <pause_reason> — mirror live state to status.json
status_write(){
  write_slots_tsv
  ST_NOW="$(date +%s)" ST_HBNOW="$(ts)" \
  ST_MODE="$1" ST_CLAIMING="$2" ST_PAUSE="$3" \
  ST_MW="$MW" ST_DAYCAP="$DAYCAP" ST_FB="$FB" \
  ST_ROUTER="$(fleet_get router '')" ST_REVIEW="$(fleet_get review "${REVIEW:-on}")" ST_EFFORT="$(fleet_get effort '')" ST_DEPTH="$(fleet_get depth '')" \
  ST_CF="$(consecutive_fails)" ST_PRS="$(count_today pr-open)" ST_ATT="$(count_today building)" \
  ST_REV="$(fleet_get rev 0)" ST_SUPPID="$SUPERVISOR_PID" ST_HB="${HEARTBEAT_SEC:-10}" \
  ST_BB="${PHASE_BUDGET_BUILDING_SEC:-1800}" ST_BG="${PHASE_BUDGET_GATING_SEC:-600}" ST_BO="${PHASE_BUDGET_OTHER_SEC:-300}" \
  ST_STATE_DIR="$STATE_DIR" ST_SLOTS="$CONTROL_DIR/.slots.tsv" \
  python3 <<'PY' | atomic_write "$CONTROL_DIR/status.json"
import os,json,datetime
env=os.environ.get
now=int(env('ST_NOW','0') or 0)
def beat_epoch(s):
    try: return int(datetime.datetime.strptime(s,"%Y-%m-%dT%H:%M:%S%z").timestamp())
    except Exception: return None
def I(x):
    try: return int(x)
    except Exception: return None
hb=int(env('ST_HB','10') or 10)
budgets={'building':int(env('ST_BB','1800')),'gating':int(env('ST_BG','600'))}
other=int(env('ST_BO','300')); sd=env('ST_STATE_DIR')
slots=[]
try: rows=open(env('ST_SLOTS')).read().splitlines()
except Exception: rows=[]
for r in rows:
    p=r.split('\t')
    if len(p)<4: continue
    slot,pid,issue,start=p[0],p[1],p[2],p[3]
    d={}
    try: d=json.load(open('%s/worker-%s.json'%(sd,slot)))
    except Exception: pass
    st=I(start); elapsed=(now-st) if st is not None else None
    phase=d.get('phase')
    page=None
    try: page=now-int(os.stat('%s/worker-%s.phase'%(sd,slot)).st_mtime)
    except Exception: pass
    be=beat_epoch(d.get('beat_ts') or '')
    budget=budgets.get(phase,other)
    stale=False
    if be is not None and (now-be)>2*hb: stale=True
    if page is not None and budget and page>budget: stale=True
    slots.append({"slot":I(slot),"pid":I(pid),"issue":I(issue),
        "title":d.get('title'),"model":d.get('model'),"effort":d.get('effort'),"depth":d.get('depth'),"phase":phase,
        "started_at":d.get('started_at'),"elapsed_s":elapsed,"phase_age_s":page,
        "stale":stale,"log":"/api/fleet/log?issue=%s"%issue})
fb=int(env('ST_FB','0') or 0); cf=int(env('ST_CF','0') or 0)
out={"schema":1,"supervisor_pid":I(env('ST_SUPPID')),"heartbeat":env('ST_HBNOW'),
  "mode":env('ST_MODE'),"claiming":env('ST_CLAIMING')=='1',
  "pause_reason":(env('ST_PAUSE') or None),
  "knobs":{"max_workers":I(env('ST_MW')),"max_pr_per_day":I(env('ST_DAYCAP')),
    "fail_break":fb,"router":(env('ST_ROUTER') or None),"review":env('ST_REVIEW'),
    "effort":(env('ST_EFFORT') or None),"depth":(env('ST_DEPTH') or None)},
  "breaker":{"consecutive_fails":cf,"tripped":cf>=fb},
  "prs_today":int(env('ST_PRS','0') or 0),"attempts_today":int(env('ST_ATT','0') or 0),
  "applied_rev":int(env('ST_REV','0') or 0),"slots":slots}
print(json.dumps(out,ensure_ascii=False))
PY
}

# ── startup: orphan adoption + recovery (do NOT relabel adopted issues) ──
adopt_orphans
git -C "$REPO_DIR" worktree prune 2>/dev/null || true
open_heads="$(gh pr list --repo "$REPO" --state open --json headRefName -q '.[].headRefName' 2>/dev/null)"
for n in $(gh issue list --repo "$REPO" --label agent-wip --state open --json number -q '.[].number' 2>/dev/null); do
  case "$n" in ''|*[!0-9]*) continue;; esac        # ignore non-numeric gh output (defensive)
  case " $ADOPTED " in *" $n "*) continue;; esac
  if ! printf '%s\n' "$open_heads" | grep -q "^agent/issue-$n-"; then
    log "↩︎ recovery: #$n was stuck on agent-wip → agent-ready"
    gh issue edit "$n" --repo "$REPO" --add-label agent-ready --remove-label agent-wip >/dev/null 2>&1 || true
    emit "$n" recovered '{}'
  fi
done

# ── main loop ──
while true; do
  reap_slots
  clean_cancel_markers

  # effective (clamped) knobs from the control-plane
  MODE="$(fleet_get mode running)"
  MW="$(clamp_int "$(fleet_get max_workers "$MAX_WORKERS_CFG")" 1 "$HARD_MAX_WORKERS")"
  DAYCAP="$(clamp_int "$(fleet_get max_pr_per_day "$MAX_PR_PER_DAY_CFG")" 0 "$HARD_MAX_PR_PER_DAY")"
  FB="$(clamp_int "$(fleet_get fail_break "$FAIL_BREAK_CFG")" "$MIN_FAIL_BREAK" "$HARD_MAX_FAIL_BREAK")"

  consume_commands

  CAN_CLAIM=1; PAUSE_REASON=""
  case "$MODE" in
    paused)  CAN_CLAIM=0; PAUSE_REASON="paused"; STOPPED_SIGNALLED=0 ;;
    stopped) CAN_CLAIM=0; PAUSE_REASON="stopped"
             if [ "$STOPPED_SIGNALLED" -eq 0 ]; then
               log "⏹ stopped: TERM to all running workers (resumable)"
               for i in $(seq 0 $((HARD_MAX_WORKERS-1))); do [ -n "${SLOT_PID[$i]:-}" ] && kill -TERM "${SLOT_PID[$i]}" 2>/dev/null; done
               STOPPED_SIGNALLED=1
             fi ;;
    *)       STOPPED_SIGNALLED=0 ;;
  esac

  if [ "$CAN_CLAIM" -eq 1 ]; then
    CF="$(consecutive_fails)"
    if [ "$CF" -ge "$FB" ]; then
      CAN_CLAIM=0; PAUSE_REASON="breaker"
      if [ "$BREAKER_NOTIFIED" -eq 0 ]; then
        log "🧯 circuit-breaker: $CF failures in a row — claiming paused."
        notify "🧯 the fleet circuit-breaker: $CF failures in a row. Fix the cause and reset the breaker."
        BREAKER_NOTIFIED=1
      fi
    elif [ "$(count_today pr-open)" -ge "$DAYCAP" ]; then
      CAN_CLAIM=0; PAUSE_REASON="daycap"
      log "🧯 day-cap reached ($DAYCAP PRs today) — claiming paused."
    elif [ "$(count_today building)" -ge "$MAX_ATTEMPTS_PER_DAY" ]; then
      CAN_CLAIM=0; PAUSE_REASON="budget"
      log "🧯 budget-cap reached ($MAX_ATTEMPTS_PER_DAY build attempts today) — claiming paused."
    else
      BREAKER_NOTIFIED=0
    fi
  fi

  if [ "$CAN_CLAIM" -eq 1 ]; then
    while [ "$(live_slots)" -lt "$MW" ]; do
      SLOT="$(free_slot "$MW")"; [ -z "$SLOT" ] && break
      NUM="$(claim_next)"; [ -z "$NUM" ] && break
      SLOT_ISSUE[$SLOT]="$NUM"; SLOT_START[$SLOT]="$(date +%s)"
      FLEET_SLOT="$SLOT" "$FLEET_DIR/worker.sh" "$NUM" >"$FLEET_DIR/logs/issue-$NUM.run.log" 2>&1 &
      SLOT_PID[$SLOT]="$!"
      log "▶ worker #$NUM in slot $SLOT (busy: $(live_slots)/$MW)"
    done
  fi

  status_write "$MODE" "$CAN_CLAIM" "$PAUSE_REASON"

  if [ "$(live_slots)" -eq 0 ]; then
    if [ "$ONCE" -eq 1 ] && { [ "$CAN_CLAIM" -eq 0 ] || [ -z "$(pick_next)" ]; }; then
      log "🏁 supervisor stopping."; break
    fi
    sleep "${INTERVAL:-60}"
  else
    sleep 5
  fi
done
wait
