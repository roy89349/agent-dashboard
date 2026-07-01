# Manager / Decomposer

The Manager turns a **big task** into a validated **decomposition plan** — subtasks, roles, risks, dependencies,
a workflow proposal and a test strategy — raises a **plan_signoff** approval, and **only after you approve it**
materialises the subtasks into child work items (+ optionally agent-ready GitHub issues) and starts a workflow.
It never shells out from your text, never spams issues, and never hardcodes roles (they come from the agents
registry). It reuses **work_items + workflows + plan-only mode + durable approvals + the phone** — the existing
issue→PR flow is untouched.

---

## How the Manager splits a big task
1. A big task arrives — a new title, an existing work item, a dashboard compose, or a phone `/plan`.
2. The Manager builds a **DecompositionPlan**: `goal · scope · subtasks[] · roles · risks · workflow_template ·
   ordering · test_strategy`. Each **subtask** has a `title`, a `role` (validated against the agents registry —
   unknown ⇒ unassigned, never a hardcoded list), a `risk_level`, `skills`, and `depends_on` (indices of other
   subtasks — a DAG; **cycles are rejected**). A starter plan can be **seeded from a workflow template** (each
   step → a subtask) so nothing needs an LLM in the dashboard.
3. `normalizeDecomposition` validates it: goal required, `≤ max_subtasks_per_plan`, dependencies in range, no
   cycle (topological sort). The parent work item is a big task → **defaults to plan_only** and is parked in
   `review` awaiting your decision.

## How approvals work
- Proposing raises a durable **`plan_signoff` approval** (Decision Inbox **and** phone) whose action is
  `{type:"approve_decomposition", work_item_id, manager_plan_id}`. Only **one open proposal per parent** (idempotent).
- **Approve** → `approveDecomposition` materialises the plan (below). Runs **exactly once** (guarded on the real
  pending→decided transition *and* an idempotent `status==="materialized"` check — a replay never double-creates).
- **Adjust / Reject** → the parent is **blocked** and you get feedback; propose a revised plan to continue.
- `plan_signoff` is shared with **plan-only mode**, so the reject handlers are discriminated by the action type:
  `handlePlanRejection` skips a decomposition, `handleDecompositionRejection` owns it — **exactly one** acts.
- **Phone**: `/plan <big task>` → the Manager proposes (seeded from a default pipeline) and sends *“I propose
  this plan — approve?”* with **Approve / Reject / More info** buttons. Nothing is created until you approve.

## How subtasks enter the existing flow (materialisation)
On approve, for each subtask (in dependency order):
- a **child work_item** is created (`parent_task_id` = the big task, `assigned_role`, `risk_level`, `team_id`).
  **High/critical-risk subtasks become `plan_only`** — they need their **own plan approval** before they build.
- **optionally** an **agent-ready GitHub issue** (via the existing `createAgentTask`, label `agent-ready`) — but
  ONLY when the plan opted in **and** the global switch is on **and** the subtask is **not** high-risk, capped by
  the subtask count. Default: **work items only, no issues** (no runaway issue creation).
- the proposed **workflow** is started (linked to the parent). The parent flips to `build_after_approval` + `running`.

So subtasks are just normal work items / issues in the existing pipeline — nothing bespoke, nothing that
bypasses the safety layer.

## Limits / config
Runtime-overridable (settings → env → default), on the **Manager → Limits** dialog or `POST /api/manager/config`:

| Config | Default | Env | Purpose |
|---|---|---|---|
| `max_subtasks_per_plan` | 12 | `MANAGER_MAX_SUBTASKS` | a plan may not exceed this — no unbounded fan-out |
| `max_depth` | 2 | `MANAGER_MAX_DEPTH` | how deep nested decomposition may go |
| `allow_github_issues` | false | `MANAGER_ALLOW_GITHUB_ISSUES` | master switch for creating agent-ready issues |

Plus the intrinsic guards: high-risk ⇒ its own plan approval; issues never for high-risk; issue count ≤ subtasks;
one open proposal per parent; idempotent materialisation.

## Tests / build
```bash
cd mission-control
node --test --experimental-sqlite lib/manager.test.ts   # config, normalise (roles/cycles/limits), propose
                                                         # (plan_only+review, idempotent, max_depth), approve
                                                         # (high-risk→plan_only, workflow, idempotent, no issues),
                                                         # reject, and the plan-only/decomposition non-double-handle
node --test --experimental-sqlite lib/*.test.ts          # full suite → 118 green
npm run build                                            # typecheck + Turbopack build → clean
```

## Scope / follow-ups
Orchestration + data + UI. The dashboard composes/validates plans and materialises them safely; an actual
Manager **agent** in the fleet would `POST /api/manager/plan` (via `X-Agent-Token`) with a plan it reasoned out.
Driving the child work items through the runner is the same deferred wiring as work items + plan-only + workflows.
