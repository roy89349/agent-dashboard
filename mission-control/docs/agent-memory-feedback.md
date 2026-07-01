# Agent Memory & Feedback Loops

Agents get better without black-box behaviour: you correct them, and your feedback becomes **visible, editable
memory** that agents consult on future work. No hidden memory, no sensitive personal info (everything is
redacted), scoped per agent/team/project.

---

## How feedback is stored
Give an agent feedback with the **Feedback** button (on a task, PR, decision, workflow step, or the agent's own
page). Each of the 9 actions — *Do this more · Never do this again · Ask me less often · Always ask me for this ·
Always run tests first · Make smaller PRs · No new dependency without explanation · Use this UI style more · Let
the Manager decide this* — does two things (`lib/agent-memory.ts` → `recordFeedback`):
1. writes an **`agent_feedback`** row (agent · the source ids · rating · type · redacted comment), and
2. **mints a `agent_memory` item** so the feedback is actually *used* later — not a one-off chat. The memory's
   **type** comes from the action (`never` → warning, `always_tests`/`ask_always`/`defer_manager` → rule,
   `do_more`/`smaller_prs`/`ui_style` → preference), its **source** from where you gave it
   (`pr > workflow > decision > task > manual`), and it's linked back via `memory_id`.

Every memory/feedback mutation is written to the **audit log**. All text is redacted before storage (no secret or
token can be persisted in memory/feedback content).

## How memory is visible
Nothing is hidden. On an **agent's detail page** (`/agents/[id]`) five tabs: **overview** (strengths · weaknesses
· rules · warnings · preferences), **performance**, **memory**, **feedback**, **recent tasks**. The **Memory
editor** lets you **add · edit · disable · archive** any item. Archive is a soft delete — the item stays
retrievable (`?all=1`) so nothing is silently lost, and a disabled/archived item is **excluded** from what agents
consult. Per agent you can capture: strengths · weaknesses · user feedback · preferred style · forbidden actions ·
forbidden libraries/patterns · lessons learned · failure patterns · preferred collaborators · review notes ·
instruction overrides — as memory items of the matching type.

## How agents use memory
- **Future task context**: the assigned agent's rules/warnings/preferences show on the **work-item detail**
  (`AgentMemoryHints`) — the constraints you set are visible exactly where the work happens.
- **Retrieval API**: `memoryForAgent(agentId, teamId)` returns only **enabled, non-archived**, agent + team-scoped
  items; `memoryWarningsFor` returns the rule/warning subset the **safety layer** can surface as an extra caution.
- **Manager** (plan-only) and the **Communication Agent** consult the same `GET /api/agents/[id]` bundle /
  `memoryForAgent` before proposing/answering — the memory is exposed for them to read (deeper auto-wiring is a
  follow-up, kept non-invasive so the reviewed engines aren't rewritten).

Scoping: memory belongs to a specific **agent** and can be tagged with a **team** (and project); the retrieval
never returns another agent's memory, and the team tag scopes team-specific rules.

## Data model
- `agent_memory`: id · agent_id · team_id · project_id · **type** · title · content · **source_type** · source_ref
  · enabled · archived · created_by · created/updated_at.
- `agent_feedback`: id · agent_id · work_item_id · workflow_id · decision_id · pr · rating · **feedback_type** ·
  comment · memory_id · created_by · created_at.

## Tests / build
```bash
cd mission-control
node --test --experimental-sqlite lib/agent-memory.test.ts   # CRUD + disable/archive, feedback→visible memory
                                                             # (type/source/link), source mapping + unknown-type
                                                             # reject, memoryForAgent enabled+team scope, warnings,
                                                             # profile grouping, content redaction
node --test --experimental-sqlite lib/*.test.ts              # full suite → 157 green
npm run build                                                # typecheck + Turbopack build → clean
```
