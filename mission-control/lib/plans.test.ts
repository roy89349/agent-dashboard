// Run: node --test --experimental-sqlite mission-control/lib/plans.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "plans-"));
fs.mkdirSync(path.join(TMP, "data"), { recursive: true });
fs.mkdirSync(path.join(TMP, "control"), { recursive: true });
process.env.FLEET_DIR = TMP;
delete process.env.ALLOW_AUTO_MERGE;
delete process.env.ALLOW_GLOBAL_OPUS;
// an agent for the enforce end-to-end test
fs.writeFileSync(path.join(TMP, "control", "agents.json"), JSON.stringify({
  schema: 1, rev: 0, updated_at: null,
  agents: [{ id: "dev", role: "backend", name: "Dev", enabled: true, autonomy: "review", skill_ids: [] }],
}));

const W = await import("./work-items.ts");
const Plans = await import("./plans.ts");
const P = await import("./permissions.ts");
const { listMessagesForWorkItem } = await import("./agent-messages.ts");

// ── default-to-plan-only ──
test("large/risky tasks default to plan_only; low risk defaults to build; explicit mode wins", () => {
  assert.equal(W.createWorkItem({ title: "risky", risk_level: "high" }).mode, "plan_only");
  assert.equal(W.createWorkItem({ title: "critical", risk_level: "critical" }).mode, "plan_only");
  assert.equal(W.createWorkItem({ title: "small", risk_level: "low" }).mode, "build_after_approval");
  assert.equal(W.createWorkItem({ title: "override", risk_level: "high", mode: "autonomous_within_limits" }).mode, "autonomous_within_limits");
});

// ── THE core requirement: plan-only really changes nothing (server-side, agent) ──
const agentPlan = { snapshot: { agent: { id: "dev", role: "backend", enabled: true, autonomy: "full", skill_ids: [], skills: [], name: "Dev", model_default: "sonnet", effort_default: "medium", depth_default: "solo", system_prompt_ref: "", allowed_tools: [], green_cmd: null, review_of_roles: [], blocking: false, label_scope: [], max_concurrency: 1, daily_token_budget: null, credential_ref: null }, team: null, skills: [{ category: "code" }, { category: "github" }, { category: "data" }, { category: "ops" }], gates: { allowGlobalOpus: true, allowAutoMerge: true }, initiator: "agent", trusted: false, confirmed: false, mode: "plan_only" } } as never;

test("plan-only: an agent is HARD-DENIED every mutating action; read/notify stay allowed", () => {
  const mutating = [
    { type: "modify_code", files: [{ path: "src/x.ts", status: "modified" }] },
    { type: "create_pr", files: [] },
    { type: "merge", pr: 1 },
    { type: "deploy", environment: "production" },
    { type: "change_env", keys: ["FOO"] },
    { type: "change_database", statements: ["DROP TABLE x"] },
    { type: "add_dependency", deps: ["evil"] },
    { type: "phone_command", verb: "fleet_mode", mode: "stopped", mutates: true },
  ];
  for (const a of mutating) {
    const d = P.evaluateAction(a as never, agentPlan);
    assert.equal(d.effect, "deny", `${a.type} must be denied in plan-only`);
    assert.match(d.reason, /plan-only/);
  }
  // read + notify + create_approval are NOT blocked (planning/asking is allowed)
  assert.notEqual(P.evaluateAction({ type: "read" } as never, agentPlan).effect, "deny");
  assert.notEqual(P.evaluateAction({ type: "notify_user" } as never, agentPlan).effect, "deny");
  assert.notEqual(P.evaluateAction({ type: "create_approval", kind: "plan_signoff" } as never, agentPlan).effect, "deny");
});

test("plan-only gate is agent-only + mode-specific: humans + build_after_approval are not plan-blocked", () => {
  const human = { snapshot: { ...(agentPlan as { snapshot: object }).snapshot, agent: null, initiator: "human", trusted: true, confirmed: true, mode: "plan_only" } } as never;
  assert.equal(P.evaluateAction({ type: "merge", pr: 1, files: [{ path: "src/x.ts", status: "modified" }] } as never, human).effect, "allow"); // human not plan-gated (#7)
  const build = { snapshot: { ...(agentPlan as { snapshot: object }).snapshot, mode: "build_after_approval" } } as never;
  assert.notEqual(P.evaluateAction({ type: "modify_code", files: [{ path: "src/x.ts", status: "modified" }] } as never, build).reason, "plan-only mode: read/plan only — no changes until the plan is approved");
});

test("enforce end-to-end: workItemId resolves plan_only mode → agent modify_code is 403", async () => {
  const wi = W.createWorkItem({ title: "plan me", risk_level: "high", assigned_agent_id: "dev", assigned_role: "backend" }); // high ⇒ plan_only
  assert.equal(wi.mode, "plan_only");
  await assert.rejects(
    () => P.enforce({ type: "modify_code", files: [{ path: "lib/x.ts", status: "modified" }] } as never, { agentId: "dev", workItemId: wi.id, initiator: "agent" }),
    (e: unknown) => P.permissionStatusOf(e) === 403,
  );
});

// ── plan lifecycle ──
const PLAN = { goal: "Add dark mode", approach: "toggle + CSS vars", expected_files: ["app.css"], needed_agents: ["frontend", "qa"], workflow_steps: ["build", "test"], risks: ["flash of wrong theme"], test_plan: "visual + unit", cost_estimate: "~1h", approval_question: "Approve the dark-mode plan?" };

test("submitPlan stores the plan, moves to review, and raises a plan_signoff approval", () => {
  const wi = W.createWorkItem({ title: "dark mode", risk_level: "high", assigned_role: "frontend" });
  const { workItem, approval } = Plans.submitPlan(wi.id, PLAN, "frontend");
  assert.equal(workItem.state, "review");
  assert.equal(workItem.plan?.goal, "Add dark mode");
  assert.equal(approval.kind, "plan_signoff");
  assert.equal(approval.work_item_id, wi.id);
  assert.equal(JSON.parse(approval.action_json!).type, "approve_plan");
});

test("approvePlan → build_after_approval + queued + an instruction message to the agent", () => {
  const wi = W.createWorkItem({ title: "feat", risk_level: "high", assigned_agent_id: "dev" });
  Plans.submitPlan(wi.id, PLAN, "dev");
  const after = Plans.approvePlan(wi.id, "roy");
  assert.equal(after.mode, "build_after_approval");
  assert.equal(after.state, "queued");
  assert.ok(listMessagesForWorkItem(wi.id).some((m) => m.type === "instruction"));
});

test("rejectPlan → blocked + a blocker feedback message; handlePlanRejection ignores non-plan approvals", () => {
  const wi = W.createWorkItem({ title: "feat2", risk_level: "high", assigned_role: "backend" });
  Plans.submitPlan(wi.id, PLAN, "backend");
  const after = Plans.rejectPlan(wi.id, "too risky, split it up", "roy");
  assert.equal(after.state, "blocked");
  assert.ok(listMessagesForWorkItem(wi.id).some((m) => m.type === "blocker" && String(m.payload?.note).includes("too risky")));
  // a non-plan approval is a no-op (doesn't throw / touch work items)
  Plans.handlePlanRejection({ kind: "merge", work_item_id: null, reason: "x" } as never, "roy");
});

// ── the bypasses the security review found: plan-only mode is bound to the AGENT, not the caller-supplied id ──
test("plan-only can't be escaped by OMITTING or SWAPPING workItemId (fail-closed, agent-bound)", async () => {
  const mine = W.createWorkItem({ title: "gate me", risk_level: "high", assigned_agent_id: "dev" }); // high ⇒ plan_only
  assert.equal(mine.mode, "plan_only");
  const modify = { type: "modify_code", files: [{ path: "lib/x.ts", status: "modified" }] } as never;
  // (1) omit workItemId entirely → the agent still has an open plan_only item → 403 (not a silent allow)
  await assert.rejects(() => P.enforce(modify, { agentId: "dev", initiator: "agent" }), (e: unknown) => P.permissionStatusOf(e) === 403);
  // (2) point at a FOREIGN, non-plan-only item the agent does NOT own → the foreign mode does not leak in → 403
  const foreign = W.createWorkItem({ title: "someone else's build", risk_level: "low", assigned_agent_id: "other", mode: "build_after_approval" });
  assert.equal(foreign.mode, "build_after_approval");
  await assert.rejects(() => P.enforce(modify, { agentId: "dev", workItemId: foreign.id, initiator: "agent" }), (e: unknown) => P.permissionStatusOf(e) === 403);
});

test("a re-decided plan approval never resurrects an in-flight work item", () => {
  const wi = W.createWorkItem({ title: "replay", risk_level: "high", assigned_agent_id: "dev" });
  Plans.submitPlan(wi.id, PLAN, "dev");
  Plans.approvePlan(wi.id, "roy");                                  // review → queued (build_after_approval)
  W.updateWorkItem(wi.id, { state: "running", actor: "agent" });    // the agent starts building
  const after = Plans.approvePlan(wi.id, "roy");                    // a stale re-approve must be a safe no-op
  assert.equal(after.state, "running");                            // NOT reset back to queued
  assert.equal(after.mode, "build_after_approval");
});

test("a stale plan decision never forces a terminal work item to blocked", () => {
  const wi = W.createWorkItem({ title: "stale", risk_level: "high", assigned_role: "backend" });
  Plans.submitPlan(wi.id, PLAN, "backend");                         // → review
  W.updateWorkItem(wi.id, { state: "cancelled", actor: "roy" });    // human cancels while the plan is pending
  const after = Plans.rejectPlan(wi.id, "late reject", "roy");      // deciding the stale plan is a no-op
  assert.equal(after.state, "cancelled");                          // NOT forced to blocked
});
