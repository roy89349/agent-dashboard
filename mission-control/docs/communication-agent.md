# Communication Agent (Chief of Staff)

Roy shouldn't have to chat with ten agents. The Communication Agent is **one voice**: it gathers everything the
floor is doing, produces a structured **summary**, answers "ask the team" with links, and turns **real choices**
into **Decision-Inbox** items — never a chaotic per-agent chat. Everything stays traceable to its source
(work item / workflow / decision / issue / PR), and all surfaced text is redacted. No shell-out.

---

## How it gathers context
`gatherContext(teamId?)` (`lib/communication.ts`) pulls the whole floor from the existing sources — no new
telemetry: the **War Room** snapshot (health + events), **work_items**, **workflows**, **approvals**
(read-only + effective-pending), recent **agent_messages**, **PRs** (from work items + merge approvals), **fleet
status**, and the **Knowledge Vault** flag if `VAULT_DIR` is set. When a `team_id` is given, work items +
workflows are scoped to that team; pending decisions are shown fleet-wide (they're Roy's regardless of team).

**Per-team communicator:** each team can name a `communication_agent_id` (stored in settings, defaults to the
team lead) — set on the Updates page or `POST /api/communication/communicators`.

## Which summaries are available
`generateSummary({type})` builds and stores a summary; the type sets the reporting window:

| Type | Window |
|---|---|
| **live** | current state |
| **hourly** | the last hour |
| **daily_standup** | since local midnight |
| **end_of_day** | since local midnight |
| **urgent_question** | surfaced separately at the top of Updates |

Every summary has the **6 sections**, each a list of source-linked lines:
1. **✅ Done** — work items finished in the window + PRs merged.
2. **🔄 Running** — in-progress work items + running workflows.
3. **⛔ Blocked** — blocked work items/workflows + unresolved blocker messages.
4. **📊 Usage** — activity counts (tasks done, PRs, workflows, active agents; token cost is a placeholder).
5. **🤔 Waiting on you** — the pending Decision-Inbox approvals (referenced, not duplicated).
6. **💡 Advice** — the team's recommendation (decisions to review, blockers to clear, breaker/offline warnings).

**Ask the team** (`POST /api/communication/ask`) — Roy asks a question; the agent keyword-searches the floor and
answers **short, with ≤6 links** to the relevant tasks / decisions / workflows / events. It's a live answer, not
a stored chat (no noise).

**Real choices → Decisions** — `escalate({question, advice})` raises a durable **`escalation`** approval in the
Decision Inbox (+ phone) with the team's advice. Roy decides there; it's never a loose message. Escalations also
appear in the *Waiting on you* section and the War Room.

## /summary + updates via phone
- **`/summary`** (or `/standup`) — the phone returns the Communication Agent's **latest team status**: it
  generates a fresh live summary and replies with the 6 sections (HTML-safe). It's read-only (no fleet change).
- **Urgent updates / daily summary via phone** — `generateSummary({notify:true})` (or an escalation) pushes the
  summary/decision to Telegram through the existing Phone Command Interface. Escalations arrive as an approval
  card (Approve/Reject).
- (Scheduled hourly/daily auto-pushes are a cron over `generateSummary` — the mechanism is ready; wiring the
  schedule is a follow-up.)

## UI
The **Updates** page (`/updates`): a **generate** bar (type + send-to-phone), an **Ask the team** box (answer +
links), the **per-team communicator** panel, an **Urgent** section, and the **daily-grouped** summary feed —
each summary card expands to the 6 sections with a link on every line back to its source.

## Tests / build
```bash
cd mission-control
node --test --experimental-sqlite lib/communication.test.ts   # the 6 sections + traceable refs, generate/list/
                                                              # get, ask-the-team search+links, escalate→escalation
                                                              # approval (a real Decision), per-team communicator
node --test --experimental-sqlite lib/*.test.ts               # full suite → 133 green
npm run build                                                 # typecheck + Turbopack build → clean
```

## Scope / follow-ups
The dashboard generates/serves summaries and escalations safely; a reasoning Communication **agent** in the
fleet would `POST /api/communication/{summaries,escalate}` (via `X-Agent-Token`) with narratives it wrote. The
scheduled hourly/daily phone pushes are a cron over `generateSummary`, and token-cost/usage tracking (the Usage
placeholder) lands when per-agent usage is recorded — same deferred wiring noted for the earlier features.
