// Run: node --test --experimental-sqlite mission-control/lib/manager.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "manager-"));
fs.mkdirSync(path.join(TMP, "data"), { recursive: true });
fs.mkdirSync(path.join(TMP, "control"), { recursive: true });
process.env.FLEET_DIR = TMP;
delete process.env.MANAGER_MAX_SUBTASKS; delete process.env.MANAGER_MAX_DEPTH; delete process.env.MANAGER_ALLOW_GITHUB_ISSUES;
fs.writeFileSync(path.join(TMP, "control", "agents.json"), JSON.stringify({
  schema: 1, rev: 0, updated_at: null,
  agents: [
    { id: "dev", role: "backend", name: "Dev", enabled: true, autonomy: "review", skill_ids: [] },
    { id: "fe", role: "frontend", name: "Fe", enabled: true, autonomy: "review", skill_ids: [] },
    { id: "q", role: "qa", name: "Q", enabled: true, autonomy: "review", skill_ids: [] },
  ],
}));

const M = await import("./manager.ts");
const W = await import("./work-items.ts");
const WF = await import("./workflows.ts");
const Plans = await import("./plans.ts");
const { listMessagesForWorkItem } = await import("./agent-messages.ts");
WF.ensureDefaultTemplates();

// ── config ──
test("manager config: sane defaults, runtime-overridable", () => {
  const c = M.getManagerConfig();
  assert.equal(c.max_subtasks_per_plan, 12);
  assert.equal(c.max_depth, 2);
  assert.equal(c.allow_github_issues, false);
  M.setManagerConfig({ max_subtasks_per_plan: 5 });
  assert.equal(M.getManagerConfig().max_subtasks_per_plan, 5);
  M.setManagerConfig({ max_subtasks_per_plan: 12 }); // reset
});

// ── normalise / validate ──
test("normalizeDecomposition: validates roles (config-driven), derives ordering + roles", () => {
  const p = M.normalizeDecomposition({ goal: "G", subtasks: [
    { title: "A", role: "backend", risk_level: "low" },
    { title: "B", role: "frontend", risk_level: "high", depends_on: [0] },
    { title: "C", role: "not-a-real-role", risk_level: "low" },
  ] });
  assert.equal(p.subtasks.length, 3);
  assert.equal(p.subtasks[2].role, null); // unknown role → unassigned (never hardcoded)
  assert.ok(p.ordering.indexOf(0) < p.ordering.indexOf(1)); // A before B
  assert.deepEqual(p.roles.sort(), ["backend", "frontend"]);
});

test("normalizeDecomposition rejects: no goal, no subtasks, too many, and cycles", () => {
  assert.throws(() => M.normalizeDecomposition({ subtasks: [{ title: "a", risk_level: "low" }] }), (e) => M.httpStatusOf(e) === 400);
  assert.throws(() => M.normalizeDecomposition({ goal: "g", subtasks: [] }), (e) => M.httpStatusOf(e) === 400);
  assert.throws(() => M.normalizeDecomposition({ goal: "g", subtasks: [{ title: "a", risk_level: "low" }, { title: "b", risk_level: "low" }, { title: "c", risk_level: "low" }] }, { max_subtasks_per_plan: 2, max_depth: 2, allow_github_issues: false }), (e) => M.httpStatusOf(e) === 400);
  // cycle: a↔b
  assert.throws(() => M.normalizeDecomposition({ goal: "g", subtasks: [{ title: "a", risk_level: "low", depends_on: [1] }, { title: "b", risk_level: "low", depends_on: [0] }] }), (e) => M.httpStatusOf(e) === 400);
});

// ── propose ──
test("proposeDecomposition parks the parent in plan_only/review + raises a decomposition plan_signoff", () => {
  const { workItem, managerPlan, approval } = M.proposeDecomposition({ title: "Big feature", plan: { goal: "Big", subtasks: [{ title: "a", role: "backend", risk_level: "low" }] } });
  assert.equal(workItem.mode, "plan_only");
  assert.equal(workItem.state, "review");
  assert.equal(managerPlan.status, "proposed");
  assert.equal(approval.kind, "plan_signoff");
  assert.equal(JSON.parse(approval.action_json!).type, "approve_decomposition");
  assert.equal(JSON.parse(approval.action_json!).manager_plan_id, managerPlan.id);
  // idempotent: a second proposal for the same parent returns the open one
  const again = M.proposeDecomposition({ work_item_id: workItem.id, plan: { goal: "Big2", subtasks: [{ title: "b", risk_level: "low" }] } });
  assert.equal(again.managerPlan.id, managerPlan.id);
});

test("proposeDecomposition enforces max_depth (no unbounded nested decomposition)", () => {
  M.setManagerConfig({ max_depth: 0 });
  assert.throws(() => M.proposeDecomposition({ title: "too deep", plan: { goal: "g", subtasks: [{ title: "a", risk_level: "low" }] } }), (e) => M.httpStatusOf(e) === 400);
  M.setManagerConfig({ max_depth: 2 }); // reset
});

// ── approve → materialise ──
test("approveDecomposition materialises children (high-risk → plan_only), starts the workflow, is idempotent", async () => {
  const p = M.proposeDecomposition({ title: "Feature X", plan: {
    goal: "X", workflow_template_id: "tpl_fix_bug",
    subtasks: [{ title: "impl", role: "backend", risk_level: "low" }, { title: "harden", role: "qa", risk_level: "high", depends_on: [0] }],
  } });
  const r = await M.approveDecomposition(p.managerPlan.id, "roy");
  assert.equal(r.children.length, 2);
  assert.ok(r.children.every((c) => c.parent_task_id === r.workItem.id));
  assert.equal(r.children.find((c) => c.risk_level === "high")!.mode, "plan_only");        // high-risk needs its own plan
  assert.equal(r.children.find((c) => c.risk_level === "low")!.mode, "build_after_approval");
  assert.equal(r.workItem.mode, "build_after_approval"); // parent decomposed → may proceed
  assert.equal(r.workItem.state, "running");
  const mp = M.getManagerPlan(p.managerPlan.id)!;
  assert.equal(mp.status, "materialized");
  assert.ok(mp.workflow_id, "a workflow should be started");
  assert.equal(WF.getWorkflow(mp.workflow_id!)!.workflow.work_item_id, r.workItem.id);
  assert.ok(mp.plan.child_ids && mp.plan.child_ids.filter(Boolean).length === 2);
  // idempotent: re-approve does NOT create more children or issues
  const before = W.childWorkItems(r.workItem.id).length;
  await M.approveDecomposition(p.managerPlan.id, "roy");
  assert.equal(W.childWorkItems(r.workItem.id).length, before);
});

test("no GitHub issues are created when the global switch is off (no runaway issue creation)", async () => {
  const p = M.proposeDecomposition({ title: "Feature no-issues", plan: { goal: "N", create_github_issues: true, subtasks: [{ title: "a", role: "backend", risk_level: "low" }] } });
  const r = await M.approveDecomposition(p.managerPlan.id, "roy"); // allow_github_issues defaults false → skip issue path
  assert.equal(r.children[0].issue, null);
});

// ── reject ──
test("rejectDecomposition blocks the parent + feedback; handleDecompositionRejection ignores non-decompositions", () => {
  const p = M.proposeDecomposition({ title: "Feature Y", plan: { goal: "Y", subtasks: [{ title: "a", risk_level: "low" }] } });
  const mp = M.rejectDecomposition(p.managerPlan.id, "too big, split it", "roy");
  assert.equal(mp.status, "rejected");
  assert.equal(W.getWorkItem(p.workItem.id)!.state, "blocked");
  assert.ok(listMessagesForWorkItem(p.workItem.id).some((m) => m.type === "blocker" && String(m.payload?.note).includes("too big")));
  M.handleDecompositionRejection({ kind: "merge", action_json: null, reason: "x" } as never, "roy"); // no-op, no throw
});

test("approveDecomposition is a no-op if the parent moved on (no resurrection of a cancelled task)", async () => {
  const p = M.proposeDecomposition({ title: "Feature stale", plan: { goal: "S", subtasks: [{ title: "a", role: "backend", risk_level: "low" }] } });
  W.updateWorkItem(p.workItem.id, { state: "cancelled", actor: "roy" }); // parent cancelled while the approval is pending
  const r = await M.approveDecomposition(p.managerPlan.id, "roy");
  assert.equal(r.workItem.state, "cancelled"); // NOT resurrected to running
  assert.equal(r.children.length, 0);          // no subtasks materialised
  assert.equal(M.getManagerPlan(p.managerPlan.id)!.status, "proposed"); // still proposed (untouched)
});

test("approveDecomposition re-checks the CURRENT subtask limit (a lowered limit blocks materialisation)", async () => {
  const p = M.proposeDecomposition({ title: "Feature limit", plan: { goal: "L", subtasks: [{ title: "a", risk_level: "low" }, { title: "b", risk_level: "low" }, { title: "c", risk_level: "low" }] } });
  M.setManagerConfig({ max_subtasks_per_plan: 2 });
  await assert.rejects(() => M.approveDecomposition(p.managerPlan.id, "roy"), (e) => M.httpStatusOf(e) === 409);
  assert.equal(W.childWorkItems(p.workItem.id).length, 0); // nothing partially created
  M.setManagerConfig({ max_subtasks_per_plan: 12 }); // reset
});

test("the plan-only reject handler SKIPS a decomposition approval (no double-handling)", () => {
  const p = M.proposeDecomposition({ title: "Feature Z", plan: { goal: "Z", subtasks: [{ title: "a", risk_level: "low" }] } });
  // a decomposition uses kind plan_signoff too — handlePlanRejection must not touch it
  Plans.handlePlanRejection({ kind: "plan_signoff", work_item_id: p.workItem.id, action_json: p.approval.action_json, reason: "x" } as never, "roy");
  assert.equal(W.getWorkItem(p.workItem.id)!.state, "review"); // unchanged — the plan-only handler skipped it
});
