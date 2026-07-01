# KPIs · Costs · Agent Performance

Three dashboards over the existing fleet data — **how much the team does, what it (estimated) costs, and which
agents perform**. Everything is aggregated from data we already store; **no invented hard costs** — cost is an
activity-based *estimate* (money only when you set a rate), and every metric is tagged **real / derived /
estimate** so you always know what you're looking at.

---

## Which metrics work (and how they're labelled)
`Metric.source` is shown as a chip on every number:
- **real** — a direct count from stored data (e.g. tasks completed, PRs merged, open blockers/decisions, failed
  workflow steps, avg retries, security/permission blocks).
- **derived** — an approximation from a proxy (e.g. *avg time/task* = created→done lifespan; *bugs* ≈ blocker
  messages; *step success rate*; *reject/caution rate*; all agent-performance rates + durations).
- **estimate** — a modelled guess (all **costs/usage**, because no real token usage is connected).

**KPIs** (`/kpis`, `lib/kpis.ts`): three sections + 7-day sparklines.
- Productivity: tasks completed · workflows completed · PRs created (derived) / merged (real) · bugs found/resolved
  (derived, blocker-messages proxy) · open blockers · decisions waiting.
- Quality: workflow step success (derived) · failed steps (real) · avg retries (real) · approval reject/caution
  rate (derived) · security/permission blocks (real) · PR review outcome (✓/✗).
- Speed: avg time / task · / workflow (derived lifespan) · avg wait-on-you · time blocked · time in review
  (derived, current-item ages).

**Agent Performance** (`/agent-performance`, `lib/agent-performance.ts`): a leaderboard + per-agent success/
failure rate, avg duration, last 10 tasks, common blockers, best collaborators (from agent_messages), granted
skills, and a feedback slot (`null` — no feedback signal is tracked yet). All **derived**.

## Which metrics are estimates
**All costs/usage.** No real Claude/API token usage is tracked, so `lib/costs.ts` models usage from **activity**
(tasks · workflow steps · messages, with configurable weights) → **estimated tokens**. A **money figure is shown
only when you set `$ / 1k tokens`** in Budgets — otherwise no euro/$ number appears at all (no invented costs).
Everything is flagged `is_estimate`, and the Costs page carries a prominent "these are estimates" banner. When
real usage lands, the pluggable `realUsageSource()` takes over and those rows flip to `source: "real"`.

## Which data sources are used
`gatherAnalytics` (bounded, no full scans): **work_items** (state · timestamps · agent/team · pr), **workflows**
+ **workflow_events** (completed/failed/retries), **approvals** (merges · decisions · rejections), **agent_messages**
(blockers · collaboration), the **audit log** (security/permission blocks, newest-2000 bounded), **workflow_steps**
(avg retries, bounded SQL), and the **agents/teams/skills** registries. Fleet status feeds the War Room; here we
use the structured tables so counts are accurate and cheap.

## How budget warnings work
Budgets live in settings (`lib/costs.ts`), all in **estimated tokens**: daily per agent · daily per team · max
per task · warning threshold (%) · **cheap mode** · **high-effort mode**. `budgetStatus()` compares today's
*estimated* usage to the budget → `ok / warning / exceeded / no_budget` (a budget of 0 = off, no false warnings).
On **Save + escalate exceeded** (or `POST /api/analytics/budget {check:true}`), each exceeded budget raises **one
Decision-Inbox `escalation`** — deduped once per id per day so it never spams. (cheap/high-effort mode are stored
+ surfaced for the fleet runner to consume later.)

## Tests / build
```bash
cd mission-control
node --test --experimental-sqlite lib/analytics.test.ts   # KPIs (real/derived labels), costs (estimate, NO euros
                                                          # until a rate is set), budget exceeded → deduped
                                                          # escalation, agent performance (success/collab/leaderboard)
node --test --experimental-sqlite lib/*.test.ts            # full suite → 150 green
npm run build                                              # typecheck + Turbopack build → clean
```

## Scope / follow-ups
Deliberately no LLM/RAG. Cost is an estimate behind a **pluggable abstraction** (`realUsageSource`) so real Claude
token usage can be wired later — the same "per-agent token usage" gap noted for the War Room budget tile. Precise
per-state durations (exact time-blocked/in-review) would need a state-transition history reconstruction from the
audit log; today those are current-item-age approximations, clearly labelled derived.
