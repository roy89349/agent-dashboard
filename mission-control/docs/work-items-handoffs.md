# Work items + inter-agent handoffs

The collaboration layer: every task becomes a **traceable work item**, and agents record structured
**handoffs / review requests / questions / blockers / results** on it — so the fleet works like a team, not
a set of anonymous workers. Page: `/work-items`.

> **Additive.** The existing issue→agent→PR flow and the board's GitHub issue cards are untouched. A work
> item links to an issue/PR by number; a message is a typed record (not a chat). All mutations are
> server-side validated (enums clamped), **redacted** (no secrets in titles/descriptions/payloads), and
> **audited**. A message that `requires_human` becomes a durable approval in the Decision Inbox.

---

## What was built

**SQLite (`lib/db.ts`)** — two additive tables:
- `work_items` — id, source_type (github_issue|chat|phone|agent|manual|workflow), source_ref, title,
  description, assigned_agent_id, assigned_role, team_id, state (queued|running|blocked|waiting_user|review|
  failed|done|cancelled), priority (low|normal|high|urgent), risk_level (low|medium|high|critical),
  parent_task_id, issue, pr, created_by, created_at, updated_at.
- `agent_messages` — id, from_agent_id, to_agent_id, to_role, work_item_id, type (handoff|review_request|
  question|result|blocker|instruction|summary), payload_json (redacted), thread_id, status (pending|accepted|
  in_progress|done|rejected), requires_human, approval_id (link to a durable approval), created_at, resolved_at.

**Services:**
- `lib/work-items.ts` — createWorkItem · listWorkItems · getWorkItem · updateWorkItem · assignWorkItem ·
  completeWorkItem · blockWorkItem · workItemForIssue · childWorkItems. Enum-clamps, redacts free text, audits.
- `lib/agent-messages.ts` — postAgentMessage · listThread · listMessagesForWorkItem · resolveMessage ·
  messageSummary. `requires_human` → `createApproval`.

**API** (all `verifySession`-gated): `GET/POST /api/work-items`, `GET/PATCH /api/work-items/[id]`,
`GET/POST /api/agent-messages` (POST also resolves via `{id, resolve}`), `GET /api/agent-messages/thread/[thread_id]`.

**UI** (`/work-items`): work items grouped by state with filters; a **task detail drawer** — details,
assignment, state/priority/risk, linked issue/PR (GitHub links), parent/child tasks, the **handoff trail**,
and a form to record a handoff/blocker/question (with a "needs a human decision" checkbox). Nav: sidebar +
mobile More + ⌘K.

## How a GitHub issue is linked to a work item
Backward-compatible + lazy. The board's issue cards keep working; `workItemForIssue(issue, seed?)` returns
the work item for an issue, **creating one on first touch** (`source_type: github_issue`, `source_ref: #N`,
`issue: N`). It is **idempotent** — one work item per issue. You can also link an issue when creating a work
item manually (the "link issue #" field), and `updateWorkItem` can set `issue`/`pr` as the task progresses.

## How handoffs work
An agent (or you, from the detail form) posts an `agent_message` with `from` / `to` (an agent id or a role)
/ `type` / an optional `note`, tied to the `work_item_id` and a `thread_id` (auto-started if omitted). The
detail view renders them as a human-readable trail — *"Frontend handed off to QA"*, *"Security flagged a
blocker"*, *"Manager asked Roy for a decision"* — with a per-message status you can resolve
(accepted/in_progress/done/rejected).

**Human questions:** when a message sets `requires_human: true`, `postAgentMessage` creates a durable
**approval** (`kind: plan_signoff`, linked by `work_item_id` + `approval_id`) and best-effort pushes it to
your phone — so the question shows up in the **Decision Inbox** and on Telegram, and the message links to it.
This is the safety/human-in-the-loop tie-in (plus every mutation is `recordAudit`-logged).

### TODO integration
`control/messages.jsonl` as a bridge to the shell/supervisor is intentionally left as a future step — the
supervisor doesn't consume handoffs yet (handoffs live in SQLite + the dashboard). Agent-initiated
work-item/message mutations will go through the `/api/agent/act` permission gateway once the agent runner is wired.

## Tests / build
```bash
cd mission-control
node --test --experimental-sqlite lib/work-items.test.ts      # CRUD, enum clamp, redaction, idempotent issue link, no-self-parent (5)
node --test --experimental-sqlite lib/agent-messages.test.ts  # post/thread/resolve + requires_human→approval (3)
npm run build                                                  # typecheck + build
```
