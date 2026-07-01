# Plan-only mode

For large/risky tasks an agent doesn't build straight away — it first submits a **plan** (goal, approach,
files, agents, workflow, risks, test plan, cost/time, an approval question), and you approve or reject it via
the **Decision Inbox / phone**. Plan-only is a **server-side safety gate**: while a work item is `plan_only`,
its agent may read + plan + ask, but **cannot change anything**.

---

## The three modes (per work item)
- **`plan_only`** — the agent may read/plan/ask; ALL mutations are hard-denied server-side.
- **`build_after_approval`** — normal building, still gated by the safety/permission layer (risk → approval).
- **`autonomous_within_limits`** — normal building; the autonomy ladder + team policy govern.

**Default-to-plan-only:** `createWorkItem` defaults a **high/critical-risk** work item to `plan_only`
(low/medium → `build_after_approval`). An explicit `mode` always wins.

## How plan-only works (server-side enforcement)
In `evaluateAction` (`lib/permissions.ts`), right after the totality check:

```
if (!isHuman && ctx.mode === "plan_only" && PLAN_ONLY_BLOCKED.has(action.type)) → DENY
```

`PLAN_ONLY_BLOCKED = modify_code · create_pr · merge · deploy · change_env · change_database · add_dependency ·
phone_command` (fleet mutation). **Allowed** in plan-only: `read`, `notify_user`, `create_approval`, `use_opus`
(reasoning uses the model, it isn't a change). The gate is a **hard deny** (cannot be approved away), fires
before the level/skill/risk logic, and is **agent-only** (a human operator isn't bound by a work item's mode).

### Mode resolution is agent-bound and fail-closed (not caller-controlled)
The critical invariant is that an agent **cannot widen its own permissions** by choosing what it sends.
`resolveContext` derives the mode server-side, bound to the **agent's own assignment**:
- An explicit `c.mode` wins (used only by test snapshots / callers that already resolved it).
- A caller-supplied `workItemId` counts **only if the agent actually owns that item** (`assigned_agent_id === agent.id`) —
  a *foreign* item's mode can never leak in.
- **Fail-closed floor:** if the agent holds **any still-open `plan_only` assignment** (state ≠ done/cancelled/failed),
  plan-only applies **no matter what `workItemId` it supplied — or if it omitted it entirely**. Omitting or
  swapping the id can't escape the gate. (A lookup error also resolves to plan-only — deny, don't fall open.)

This mirrors the rest of the layer's untrusted-agent posture (it already strips agent-supplied merge diffs and
refuses agent-named foreign teams). Agents reach the layer via `POST /api/agent/act`; their code-write / PR /
merge / deploy / dependency / db / env / fleet actions are blocked while they hold an open plan_only item.

### What an agent MAY do in plan-only
read the codebase · identify relevant files · name risks · make a step plan · propose needed agents ·
propose a workflow · estimate cost/time · make a test plan → **submit the plan for approval**.

### What an agent may NOT do in plan-only
change files · open a PR · install dependencies · change the database/schema · change env/config · deploy ·
merge · mutate fleet state. (All hard-denied + audited `permission.denied`.)

## How a plan goes to build
1. The agent (or you, from the work-item detail) `POST /api/work-items/[id]/plan` with the 9-section plan.
2. `submitPlan` stores it, moves the work item to **`review`**, and raises a durable **`plan_signoff` approval**
   (with the plan as its preview) in the Decision Inbox + phone.
3. **Approve** → `runApprovalAction({type:"approve_plan"})` → `approvePlan`: the work item flips to
   **`build_after_approval`** + state **`queued`**, and the agent gets an `instruction` message to proceed.
   The agent can now build — under the normal safety gates (risk → approval, etc.).
4. **Reject / Pause** → `handlePlanRejection` (in both the dashboard decide route and the phone) → `rejectPlan`:
   the work item is **`blocked`** and the agent gets a **`blocker`** message with the reason (feedback loop).

**Replay / stale-decision safety.** `decideApproval` is idempotent, so both decide paths only run the approval
action on the real `pending → decided` transition — a re-tapped inline **Approve** button can't replay
`approve_plan` (or open a duplicate task). And `approvePlan`/`rejectPlan` only act while the item is still in
`review`: a stale decision on an item that has since started building, or been cancelled/done, is a **safe no-op**
(never resurrects or resets it).

## Integrations
- **Decision Inbox + Phone** — the plan is a normal `plan_signoff` approval (Approve/Reject on both surfaces).
- **Safety/permission matrix** — the plan-only gate is part of `evaluateAction`; nothing bypasses it server-side.
- **Work items + handoffs** — the mode + plan live on the work item; approve/reject post agent_messages.
- **Manager agent / workflow engine** (later) — `approve_plan` is where a plan becomes a build task; a future
  step turns the plan's `workflow_steps` into an actual workflow.

## Tests / build
```bash
cd mission-control
node --test --experimental-sqlite lib/plans.test.ts   # 10 tests: default-to-plan-only; the plan-only HARD-DENY
                                                       # of every mutating action (the "changes nothing" test);
                                                       # enforce end-to-end (workItemId→mode→403); the bypass
                                                       # regressions (OMIT/SWAP workItemId still 403, agent-bound);
                                                       # submit/approve/reject; replay + stale-decision no-ops
node --test --experimental-sqlite lib/*.test.ts       # full suite → 92 green
npm run build                                          # typecheck + Turbopack build → clean
```

## Security review
An adversarial multi-agent review (find → independently verify) drove the hardening above. It confirmed and we
fixed: **(blocker)** plan-only was escapable because the mode was resolved purely from the caller-supplied
`workItemId` — omitting it (`mode→null`) or naming a foreign item skipped the gate; now the mode is agent-bound
and fail-closed. **(medium)** a re-tapped/stale approval could replay `approve_plan` and reset an in-flight item;
now guarded on the real transition + a `state==="review"` check. One reported issue (arbitrary plan submit via the
gateway token) was a **false positive** — `AGENT_GATEWAY_TOKEN` is a single shared fleet secret with no per-agent
identity to bind against, so there is nothing there to check.
