# War Room

One live control-room screen for the whole AI production floor: fleet health, every agent's activity by status,
and a smart-grouped event timeline. It's a **read-only aggregation** of the existing sources — no writes, no
shell-out, no GitHub/network per poll. The page polls **one** endpoint (`/api/war-room`); everything else is
client-side filtering over that snapshot.

---

## Which live data is shown
Assembled by `buildWarRoom()` (`lib/war-room.ts`) from the fleet `status.json` + the local DB (audit log,
workflow_events, work_items, workflows, approvals) + the agents/teams registry — a fixed, bounded set of indexed
queries per poll (no per-row / per-agent fan-out).

**Fleet health strip** — fleet mode + online, active workers (`slots`), active agents, running workflows, open
decisions (pending approvals), blockers (blocked work items + blocked workflows), PRs ready (pending merge
approvals, else review-with-PR items), breaker state (tripped + consecutive fails), and a budget warning slot
(placeholder until per-agent token usage is tracked).

**Live agent overview** — every enabled agent is bucketed by its **most-pressing** current work item (precedence
`waiting_user > blocked > waiting_review > failed > working > done > sleeping`); a fleet build-slot with no linked
work item counts as *working*. Buckets: **Working · Blocked · Waiting review · Waiting on you · Failed · Done ·
Sleeping**. Each **agent card** shows: name · role · team · current task · workflow step · phase · time busy ·
last event · a waiting-approval indicator · a budget placeholder.

**Timeline** — a unified, typed, severity-coloured event stream: task/issue created, work item created/updated,
plan created/approved/rejected, decomposition proposed/materialised, approval requested, approval/merge decided,
phone command, workflow started/step-started/step-completed/completed, retries, blockers, failures, security
blocks, fleet changes. Each event carries the ids to open its context (work item / workflow / decision /
issue / PR / agent).

> Runner-phase events (code changed, tests run, QA review) surface as the agent's **phase** on its card while a
> build runs; a historical runner-event feed is a future add (there's no global events.jsonl reader yet).

## How events are grouped (no log spam)
Events from the audit log (minus `workflow.*`, which come richer from `workflow_events`; permission-*allows* are
dropped as noise) are merged with the workflow events, sorted newest-first, then **grouped**: adjacent events
with the **same type + same subject** (work item / issue / workflow / approval / actor) within a **10-minute
window** collapse into one row with a **×count** badge. The list is capped at 80 rows. So five rapid updates to
one work item read as a single `Work item updated ×5` line, not five lines.

## Which filters exist
A single filter bar, applied client-side over the snapshot: **status** (agent bucket) · **team** · **agent** ·
**role** · **workflow** · **severity**. Agent filters (status/team/agent/role) narrow the agent overview; event
filters (team/agent/role/workflow/severity) narrow the timeline; the bucket chips are one-tap status filters.
Clicking an event expands its **context links** (work item, workflow, decision, GitHub issue/PR, agent).

## Performance
- **One** endpoint, polled every **5 s**, with `cache: no-store`. The poll **pauses while the tab is hidden** and
  re-fetches on return; the previous snapshot is kept during a refetch (no flicker); the timer + listener are
  cleared on unmount (no leak, no overlapping timers).
- The aggregation is a fixed number of **bounded, indexed** queries — approvals are loaded once into a map (no
  per-audit-row point query) and teams once (no per-agent file read). No GitHub call, no shell-out.

## Tests / build
```bash
cd mission-control
node --test --experimental-sqlite lib/war-room.test.ts   # health/buckets, timeline typing+order, grouping
                                                          # (×count, no spam), facets, offline-safe (no status.json)
node --test --experimental-sqlite lib/*.test.ts           # full suite → 125 green
npm run build                                             # typecheck + Turbopack build → clean
```
