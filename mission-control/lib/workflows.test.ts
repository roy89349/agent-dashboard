// Run: node --test --experimental-sqlite mission-control/lib/workflows.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "workflows-"));
fs.mkdirSync(path.join(TMP, "data"), { recursive: true });
fs.mkdirSync(path.join(TMP, "control"), { recursive: true });
process.env.FLEET_DIR = TMP;

const WF = await import("./workflows.ts");
const { db } = await import("./db.ts");
const { getApproval, decideApproval } = await import("./approvals.ts");

// seed the defaults FIRST (production seeds on first template access, before any custom row exists)
WF.ensureDefaultTemplates();

// deterministic custom templates (independent of the default shapes)
function tpl(id: string, steps: Array<Record<string, unknown>>) {
  const now = new Date().toISOString();
  db().prepare("INSERT OR REPLACE INTO workflow_templates (id,name,description,category,steps_json,enabled,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)")
    .run(id, id, null, "test", JSON.stringify(steps), now, now);
}
tpl("t_norm", [
  { name: "A", role: "backend", max_attempts: 2 },
  { name: "B", role: "qa" },
  { name: "C", role: "qa" },
]);
tpl("t_gate_last", [{ name: "A", role: "backend" }, { name: "B", role: "qa" }, { name: "Gate", approval_required: true }]);
tpl("t_gate_first", [{ name: "Gate", approval_required: true }, { name: "B", role: "qa" }]);
tpl("t_one", [{ name: "Only", role: "backend", max_attempts: 1 }]);

// ── defaults seed ──
test("the 6 default templates seed with generic role pipelines (no project names)", () => {
  const ids = WF.listTemplates().map((t) => t.id);
  for (const id of ["tpl_build_feature", "tpl_fix_bug", "tpl_improve_ui", "tpl_audit_project", "tpl_excel_automation", "tpl_launch_saas"])
    assert.ok(ids.includes(id), `missing ${id}`);
  const build = WF.getTemplate("tpl_build_feature")!;
  assert.equal(build.steps[0].name, "Product Owner");
  assert.equal(build.steps[build.steps.length - 1].approval_required, true); // PR approval gates
});

// ── create + linear walk ──
test("createWorkflowFromTemplate activates the first step; the rest stay queued", () => {
  const { workflow, steps } = WF.createWorkflowFromTemplate({ template_id: "t_norm", title: "W1", work_item_id: "wi1" });
  assert.equal(workflow.status, "running");
  assert.equal(steps.length, 3);
  assert.deepEqual(steps.map((s) => s.status), ["running", "queued", "queued"]);
  assert.equal(workflow.current_step_id, steps[0].id);
  assert.equal(workflow.work_item_id, "wi1");
});

test("completeStep walks step→step and finishes the workflow (all done)", () => {
  const wf0 = WF.createWorkflowFromTemplate({ template_id: "t_norm", title: "W2" });
  let d = WF.completeStep(wf0.workflow.id, wf0.steps[0].id, { note: "did A" });
  assert.equal(d.steps[0].status, "done");
  assert.equal(d.steps[1].status, "running");
  assert.equal(d.workflow.current_step_id, d.steps[1].id);
  d = WF.completeStep(wf0.workflow.id, d.steps[1].id);
  d = WF.completeStep(wf0.workflow.id, d.steps[2].id);
  assert.equal(d.workflow.status, "done");
  assert.equal(d.workflow.current_step_id, null);
  assert.deepEqual(d.steps.map((s) => s.status), ["done", "done", "done"]);
  // output is stored (redacted)
  assert.ok(d.steps[0].output && typeof d.steps[0].output === "object");
});

test("completeStep guards: wrong (non-current) step, and a finished workflow, are 409", () => {
  const wf = WF.createWorkflowFromTemplate({ template_id: "t_norm", title: "W3" });
  assert.throws(() => WF.completeStep(wf.workflow.id, wf.steps[2].id), (e) => WF.httpStatusOf(e) === 409); // not current
  WF.completeStep(wf.workflow.id, wf.steps[0].id);
  WF.completeStep(wf.workflow.id, wf.steps[1].id);
  WF.completeStep(wf.workflow.id, wf.steps[2].id); // done
  assert.throws(() => WF.completeStep(wf.workflow.id, wf.steps[2].id), (e) => WF.httpStatusOf(e) === 409);
});

// ── approval gate ──
test("an approval-gated step becomes waiting_user + raises a workflow_step approval; advance completes it", () => {
  const wf = WF.createWorkflowFromTemplate({ template_id: "t_gate_last", title: "W4", work_item_id: "wiG" });
  let d = WF.completeStep(wf.workflow.id, wf.steps[0].id);
  d = WF.completeStep(wf.workflow.id, d.steps[1].id); // reaching the gate
  const gate = d.steps[2];
  assert.equal(gate.status, "waiting_user");
  assert.equal(d.workflow.status, "waiting_user");
  assert.ok(gate.approval_id, "step should link an approval");
  const appr = getApproval(gate.approval_id!)!;
  assert.equal(appr.kind, "workflow_step");
  assert.equal(appr.work_item_id, "wiG");
  const action = JSON.parse(appr.action_json!);
  assert.equal(action.type, "advance_workflow");
  assert.equal(action.step_id, gate.id);
  // a bare advance CANNOT bypass the pending gate
  assert.throws(() => WF.advanceWorkflow(wf.workflow.id), (e) => WF.httpStatusOf(e) === 409);
  // grant the durable approval, then the coupled advance (the runApprovalAction path) completes it exactly once
  decideApproval(appr.id, "approve", { trusted: true, by: "roy", via: "dashboard" });
  const done = WF.advanceWorkflowStep(wf.workflow.id, gate.id, "roy");
  assert.equal(done.workflow.status, "done");
  assert.equal(done.steps[2].status, "done");
});

test("advanceWorkflow refuses to bypass a pending approval gate (409)", () => {
  const wf = WF.createWorkflowFromTemplate({ template_id: "t_gate_first", title: "WGATE" });
  assert.equal(wf.steps[0].status, "waiting_user");
  assert.throws(() => WF.advanceWorkflow(wf.workflow.id), (e) => WF.httpStatusOf(e) === 409);
});

test("failStep + blockStep refuse a non-current step (no current_step_id hijack)", () => {
  const wf = WF.createWorkflowFromTemplate({ template_id: "t_norm", title: "WGUARD" }); // step0 running, 1/2 queued
  assert.throws(() => WF.failStep(wf.workflow.id, wf.steps[1].id), (e) => WF.httpStatusOf(e) === 409);
  assert.throws(() => WF.blockStep(wf.workflow.id, wf.steps[2].id), (e) => WF.httpStatusOf(e) === 409);
  const d = WF.getWorkflow(wf.workflow.id)!;
  assert.equal(d.workflow.current_step_id, d.steps[0].id); // unchanged
  assert.equal(d.steps[0].status, "running");
  assert.equal(d.steps[1].status, "queued");
});

test("a stale gate approval is a no-op after the workflow moved on (no double-advance)", () => {
  const wf = WF.createWorkflowFromTemplate({ template_id: "t_gate_first", title: "WSTALE" }); // gate = step0
  const apprId = wf.steps[0].approval_id!;
  const d = WF.skipStep(wf.workflow.id, wf.steps[0].id, "roy"); // move past the gate
  assert.equal(d.steps[0].status, "skipped");
  assert.equal(d.steps[1].status, "running");
  assert.notEqual(getApproval(apprId)!.status, "pending"); // approval voided on skip
  // forcing the coupled advance for the stale step must NOT touch the now-current step1
  const stale = WF.advanceWorkflowStep(wf.workflow.id, wf.steps[0].id, "roy");
  assert.equal(stale.steps[1].status, "running");
  assert.equal(stale.workflow.current_step_id, stale.steps[1].id);
});

test("requestStepApproval is idempotent — no duplicate approval for an already-gated step", () => {
  const wf = WF.createWorkflowFromTemplate({ template_id: "t_gate_first", title: "WIDEMP" });
  const first = wf.steps[0].approval_id!;
  const { approval } = WF.requestStepApproval(wf.workflow.id, wf.steps[0].id, "roy");
  assert.equal(approval.id, first); // returns the existing pending approval, not a new one
});

test("a template whose FIRST step gates starts in waiting_user", () => {
  const wf = WF.createWorkflowFromTemplate({ template_id: "t_gate_first", title: "W5" });
  assert.equal(wf.workflow.status, "waiting_user");
  assert.equal(wf.steps[0].status, "waiting_user");
  assert.ok(wf.steps[0].approval_id);
});

// ── retries + failure ──
test("failStep retries while attempts remain, then fails the step + the workflow", () => {
  const wf = WF.createWorkflowFromTemplate({ template_id: "t_norm", title: "W6" }); // step A max_attempts 2
  let d = WF.failStep(wf.workflow.id, wf.steps[0].id, "boom");
  assert.equal(d.steps[0].status, "running"); // retry
  assert.equal(d.steps[0].attempt_count, 1);
  assert.equal(d.workflow.status, "running");
  d = WF.failStep(wf.workflow.id, wf.steps[0].id, "boom again");
  assert.equal(d.steps[0].status, "failed");
  assert.equal(d.steps[0].attempt_count, 2);
  assert.equal(d.workflow.status, "failed");
});

test("a max_attempts=1 step fails the workflow on the first failure", () => {
  const wf = WF.createWorkflowFromTemplate({ template_id: "t_one", title: "W7" });
  const d = WF.failStep(wf.workflow.id, wf.steps[0].id, "nope");
  assert.equal(d.steps[0].status, "failed");
  assert.equal(d.workflow.status, "failed");
});

// ── block / skip / cancel ──
test("blockStep blocks the step + workflow", () => {
  const wf = WF.createWorkflowFromTemplate({ template_id: "t_norm", title: "W8" });
  const d = WF.blockStep(wf.workflow.id, wf.steps[0].id, "waiting on info");
  assert.equal(d.steps[0].status, "blocked");
  assert.equal(d.workflow.status, "blocked");
});

test("skipStep skips the current step and advances to the next", () => {
  const wf = WF.createWorkflowFromTemplate({ template_id: "t_norm", title: "W9" });
  const d = WF.skipStep(wf.workflow.id, wf.steps[0].id);
  assert.equal(d.steps[0].status, "skipped");
  assert.equal(d.steps[1].status, "running");
  assert.equal(d.workflow.current_step_id, d.steps[1].id);
});

test("cancelWorkflow is terminal; advance is a no-op and mutations 409 afterwards", () => {
  const wf = WF.createWorkflowFromTemplate({ template_id: "t_norm", title: "W10" });
  const c = WF.cancelWorkflow(wf.workflow.id);
  assert.equal(c.workflow.status, "cancelled");
  const adv = WF.advanceWorkflow(wf.workflow.id); // idempotent no-op
  assert.equal(adv.workflow.status, "cancelled");
  assert.throws(() => WF.completeStep(wf.workflow.id, wf.steps[0].id), (e) => WF.httpStatusOf(e) === 409);
});

// ── rejection handler ──
test("handleWorkflowRejection blocks the step; ignores non-workflow approvals", () => {
  const wf = WF.createWorkflowFromTemplate({ template_id: "t_gate_first", title: "W11" });
  const gate = wf.steps[0];
  WF.handleWorkflowRejection({ kind: "workflow_step", action_json: JSON.stringify({ type: "advance_workflow", workflow_id: wf.workflow.id, step_id: gate.id }), reason: "not yet" }, "roy");
  const d = WF.getWorkflow(wf.workflow.id)!;
  assert.equal(d.steps[0].status, "blocked");
  assert.equal(d.workflow.status, "blocked");
  // a non-workflow approval is a no-op (doesn't throw)
  WF.handleWorkflowRejection({ kind: "merge", action_json: null, reason: "x" } as never, "roy");
});

test("updateWorkflow renames + cancels, but refuses arbitrary status jumps", () => {
  const wf = WF.createWorkflowFromTemplate({ template_id: "t_norm", title: "W12" });
  const renamed = WF.updateWorkflow(wf.workflow.id, { title: "renamed" });
  assert.equal(renamed.workflow.title, "renamed");
  assert.throws(() => WF.updateWorkflow(wf.workflow.id, { status: "done" }), (e) => WF.httpStatusOf(e) === 400);
  const cancelled = WF.updateWorkflow(wf.workflow.id, { status: "cancelled" });
  assert.equal(cancelled.workflow.status, "cancelled");
});
