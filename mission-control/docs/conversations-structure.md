# Conversations structure

Mission Control no longer sprawls into a chat-per-agent mess. Conversations is one hub with a clear shape —
**Team Chat · Task Threads · Decision Threads · Agent Logs · Daily Summaries** — built by **extending the existing
`conversations`/`messages` tables** (no parallel message system) and surfacing the other existing systems
(`agent_messages`, `communication_summaries`) without duplicating them.

---

## How conversations are grouped now
`/conversations` has five tabs (`lib/conversations.ts` → `kindGroup` maps every stored `kind` into a group):
- **Team Chat** (prominent) — Roy ↔ the Communication/Manager assistant. The default conversation
  (`getOrCreateTeamChat`, a settings singleton). Backed by the existing Claude-streaming chat.
- **Tasks** — one thread per work item / workflow (`kind` `task`/`workflow`, linked by `work_item_id`/
  `workflow_id`). Also Claude-backed.
- **Decisions** — a discussion thread per approval (`kind` `decision`, linked by `approval_id`). Comments are cheap
  (non-Claude) and the **approval stays the source of truth in the Decision Inbox** — the thread links back to
  `/approvals`.
- **Agent Logs** — the technical `agent_messages` timeline, read-only and deliberately **less prominent** (not in
  the main chat). Filterable by agent.
- **Daily Summaries** — the existing `communication_summaries` (standup · end-of-day), generated on demand, kept
  **apart** in their own tab.

The data model was extended additively: `conversations.kind` now also takes `team|agent|decision|task|workflow|
summary`; `messages.type` (`summary|decision|log|question|answer|system|approval|blocker|instruction`) + an author
`agent_id`; and link columns `team_id/agent_id/work_item_id/workflow_id/approval_id`. Search (`?q=`) spans thread
titles and message content (parameterised, wildcard-escaped).

**From a chat** you can, without leaving Conversations: **+ Task** (`createWorkItem`), **+ Decision**
(`createApproval` → linked decision thread), **Assign** (create a work item for an agent/role), **→ Manager**
(hand off via `agent_messages`). Each drops a system note into the thread.

## How old conversations work
Nothing broke. The migration is pure `ALTER TABLE … ADD COLUMN` (idempotent), so existing rows keep their
`kind` (`orchestrator`/`task`) and simply gain nullable columns. `kindGroup` folds legacy `orchestrator` →
**Team**, legacy `task` → **Tasks**, and anything unknown → Team (never dropped). The old `/api/chats` routes and
`db.ts` `createConversation`/`addMessage`/`getMessages` are unchanged; the old `/chats` page + `ChatView` still work
(reachable via the command palette as "Team Chat (raw)"). No second message store — everything still writes to the
one `messages` table.

## How phone / team chat is linked
Team Chat is the default conversation. The **Telegram webhook** logs every *verified* inbound command and its reply
into the Team Chat as `type:"log"` messages (`logPhoneMessage`), so phone activity is visible in Conversations. It
runs **after `verifySender`** (unauthorized senders are never logged), the content is **redacted**, and it's wrapped
in try/catch so conversation logging can never break the phone reply path.

## Tests / build
```bash
cd mission-control
node --test --experimental-sqlite lib/conversations.test.ts   # kind grouping (+legacy), link columns, typed +
                                                              # redacted messages, search (title+content, escaped),
                                                              # team-chat singleton, decision thread↔approval dedupe,
                                                              # phone logging, chat actions bridge to real services
node --test --experimental-sqlite lib/*.test.ts               # full suite → 176 green
npm run build                                                 # typecheck + Turbopack build → clean
```

## Scope / follow-ups
Reuses three existing systems rather than merging them (that would be a rewrite): the chat store powers Team/Task,
`agent_messages` powers Agent Logs, `communication_summaries` powers Summaries. Weekly summaries reuse the daily
mechanism (a dedicated `weekly` type is a small follow-up). A forward "Discuss" button on the Decision Inbox
(approvals → decision thread) is optional; today the link is decision-thread → Inbox.
