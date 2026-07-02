# Night shift

Use idle night hours for queued chores (docs, tests, dep bumps, refactors) and wake up to a
Telegram digest of what happened. Two independent halves:

1. **Night claiming** (supervisor/lib.sh, pure bash) — during a configurable night window the
   fleet ALSO claims issues labelled `night-ready`.
2. **Morning digest** (systemd timer → dashboard endpoint) — at 07:15 the Communication agent
   generates a daily-standup summary and pushes it to your phone.

Both are **off by default** and fully additive: with `NIGHT_SHIFT=off` (the default) claiming is
byte-identical to today, and the digest simply isn't installed unless you copy the timer.

## Configuration (config.local.env)

| Var | Default | Meaning |
|---|---|---|
| `NIGHT_SHIFT` | `off` | `on` = also claim night-queue issues during the window |
| `LABEL_NIGHT` | `night-ready` | GitHub label for night-queue chores |
| `NIGHT_START_HOUR` | `23` | window start, local server time (inclusive) |
| `NIGHT_END_HOUR` | `7` | window end (exclusive) |
| `NIGHT_MAX_PR` | `5` | cap on night-claimed builds per calendar night |

## How the window works

`in_night_window` checks the current local hour `H`:

- **start > end** (e.g. 23→7): the window wraps midnight — `[23,24) ∪ [0,7)`. 23:00 is in,
  06:59 is in, 07:00 is out.
- **start < end** (e.g. 1→5): a plain `[1,5)` block.
- **start == end**: an empty window — night claiming never fires.

## Claiming rules

- Day issues (`agent-ready`) keep **absolute priority**: the night queue is only consulted when
  the day queue is empty. Daytime behaviour never changes.
- Night claims pass through **all existing gates first**: pause/stop mode, circuit breaker, the
  daily PR cap (`MAX_PR_PER_DAY`) and the attempts budget all still apply.
- On top of that, a **per-night cap**: at most `NIGHT_MAX_PR` night claims per calendar night.
  The counter lives in `state/.night-<YYYY-MM-DD>` where the date is the day the night *started*
  — a 23→7 night keeps one counter across midnight (at 02:00 it reads yesterday's file).
- Each night claim is audited in `logs/events.jsonl` as a `night-claim` event (with `night_id`
  and `night_count`), followed by the normal `claimed` event, so the worker/dashboard flow is
  unchanged.
- Queue a chore: `gh issue edit <n> --add-label night-ready` (skip the `agent-ready` label
  unless you also want it built during the day).

## Morning digest

`POST /api/communication/digest` on the dashboard generates a summary via the Communication
agent (`generateSummary`) with `notify:true` — delivery to Telegram happens through the existing
phone provider, no new external service. Auth: a dashboard session **or** the internal
`X-Watchdog-Token` (`MC_WATCHDOG_TOKEN`), same pattern as `/api/fleet/watchdog`; fail-closed 401
otherwise. Body: optional `{"type":"daily_standup"}` or `{"type":"end_of_day"}` — anything else
clamps to `daily_standup`.

`deploy/morning-digest.sh` is the timer payload: it reads `MC_WATCHDOG_TOKEN` from the dashboard
env file and requires an explicit HTTP 200 (a login-redirect counts as failure). On failure it
only logs to stderr (journal) — a dead dashboard already alarms via the watchdog, so no second
Telegram path here.

### Install the timer (VPS, as root)

```sh
cp /home/fleet/agent-dashboard/deploy/morning-digest.service /etc/systemd/system/
cp /home/fleet/agent-dashboard/deploy/morning-digest.timer   /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now morning-digest.timer

# check
systemctl list-timers morning-digest.timer
journalctl -u morning-digest.service -n 20
```

Runs daily at **07:15 local time**, `Persistent=true` (a missed run — server asleep/rebooting —
fires once on the next boot). Change the moment via `OnCalendar=` in the timer, or send an
end-of-day report instead by adding `Environment=DIGEST_TYPE=end_of_day` to the service.

## Sellability notes

- **No external services**: the window logic is pure bash + `date`; the digest reuses the
  already-configured Telegram phone provider and the existing self-auth token. No new keys,
  meters or subscriptions.
- **Off by default**: a fresh install behaves exactly as before until `NIGHT_SHIFT=on` is set
  and/or the timer is installed. Every night-shift code path is guarded, so a night-shift bug
  can never break daytime claiming.
- **Cost-bounded**: `NIGHT_MAX_PR` plus all existing day caps mean an unattended night can never
  run away with tokens.

## Tests

`bash tests/night-shift.test.sh` — window boundaries (wrap, plain, edges, junk config), the
night-id day-rollover and the counter/cap logic, all against a temp state dir (no gh calls).
