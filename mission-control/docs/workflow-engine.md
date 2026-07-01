# Workflow engine

A **workflow** is a live, traceable pipeline: a template becomes an ordered list of **steps** that walk work
through agent **roles** (product → architect → build → qa → security → reviewer → approval …). It's an
orchestration + tracking layer over the existing **work items** and **durable approvals** — it does *not*
execute agent work itself (the runner does that later). Every transition is validated server-side, redacted,
and recorded as a `workflow_event` + audit row.

---

## Which workflows exist (default templates)
Seeded once, lazily, on first template read (`ensureDefaultTemplates`). Generic role pipelines — no
project-specific names. An 🔓 step is an **approval gate** (the workflow waits for your sign-off).

| Template | Category | Pipeline |
|---|---|---|
| **Build feature** | build | Product Owner → Architect → Build (FE/BE) → QA → Security → Reviewer → **PR approval 🔓** |
| **Fix bug** | bugfix | Debug & fix → QA → Reviewer → **PR approval 🔓** |
| **Improve UI** | ui | Designer → Frontend → Screenshot Review → QA |
| **Audit project** | audit | Architect → Security → QA → Docs → Manager summary |
| **Excel automation** | automation | Excel / Data → Validator → Backend → QA |
| **Launch SaaS** | launch | Product → Frontend → Backend → Payments (placeholder) → QA → **Deploy approval 🔓** |

Each step carries `role`, optional `required_skills`, `approval_required`, `output_expected`, and
`max_attempts` (retries). Templates live in `workflow_templates`; you can disable/customise them (re-seeding
only happens when the table is empty, so your edits survive).

## Data model
`workflow_templates` (id, name, description, category, steps_json, enabled) → `workflows` (template_id,
work_item_id, team_id, title, **status**, current_step_id) → `workflow_steps` (step_order, name,
assigned_agent_id/role, required_skills_json, approval_required, **status**, max_attempts, attempt_count,
output_expected, output_json, approval_id, started/completed_at) → `workflow_events` (type, message, payload).

- **Workflow status**: `queued · running · blocked · waiting_user · failed · done · cancelled`
- **Step status**: `queued · running · blocked · waiting_user · review · failed · done · skipped`

## How to start a workflow
**From a task (work item):** open the work item → **Run a workflow for this task** → pick a template → Start.
The workflow is linked to the work item (`work_item_id`). This is also how you start one **from an approved
plan** — the plan lives on the work item, so once a plan-only item is approved you launch its pipeline from the
same place.

**Standalone:** the **Workflows** page → **New** → choose a template (with a live step preview) → optionally a
title + a work item id → **Start workflow**.

**API:** `POST /api/workflows { template_id, work_item_id?, team_id?, title? }` → returns the workflow +
steps + events. The first step is activated immediately (running, or `waiting_user` + an approval if it gates).

## How steps are advanced
The state machine (`lib/workflows.ts`), driven from the detail view or `POST /api/workflows/[id]/advance`:

- **complete** `{stepId, output}` — the current running/review step is marked `done` (with its output), then the
  next queued step is activated. When there's no next step the workflow is `done`.
- **advance** — finish the current active step and move on (the whole-workflow "next" button).
- **fail** `{stepId, reason}` — records a failed attempt: **retries** (`running`, attempt_count++) while attempts
  remain, else the step + workflow go `failed`.
- **block** `{stepId, reason}` — the step + workflow go `blocked` (needs intervention).
- **skip** `{stepId}` — the step is `skipped`; if it was current, the workflow advances.
- **request_approval** `{stepId}` — raise a durable approval that gates the step (→ `waiting_user`).

**Approval gates:** an `approval_required` step becomes `waiting_user` and raises a `workflow_step` approval in
the **Decision Inbox / phone** (`action {type:"advance_workflow", workflow_id, step_id}`). **Approve** →
`advanceWorkflow` finishes the step and moves on (runs exactly once — guarded on the real pending→decided
transition). **Reject / Pause** → `handleWorkflowRejection` **blocks** the step. Terminal workflows
(`done/failed/cancelled`) are terminal — advancing them is a no-op and step ops return 409.

`PATCH /api/workflows/[id]` only renames or cancels (`status:"cancelled"`); it refuses arbitrary status jumps —
use the step ops to move the machine.

## Tests / build
```bash
cd mission-control
node --test --experimental-sqlite lib/workflows.test.ts   # 13 state-machine tests: seed, linear walk, complete
                                                           # guards, approval gate (+ first/last step), retry→fail,
                                                           # block, skip, cancel-is-terminal, reject→block, PATCH
node --test --experimental-sqlite lib/*.test.ts            # full suite → 105 green
npm run build                                              # typecheck + Turbopack build → clean
```

## Scope / follow-ups
Orchestration + data + UI only — no worker-engine rewrite. Steps are advanced by a human (or the API) today;
wiring the **agent runner** to drive `complete/fail` per step (through the permission gateway) is the natural
next step, same as for work items + plan-only mode.
