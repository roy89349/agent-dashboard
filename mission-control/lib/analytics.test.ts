// Run: node --test --experimental-sqlite mission-control/lib/analytics.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "analytics-"));
fs.mkdirSync(path.join(TMP, "data"), { recursive: true });
fs.mkdirSync(path.join(TMP, "control"), { recursive: true });
process.env.FLEET_DIR = TMP;
fs.writeFileSync(path.join(TMP, "control", "agents.json"), JSON.stringify({
  schema: 1, rev: 0, updated_at: null,
  agents: [{ id: "dev", role: "backend", name: "Dev", enabled: true, autonomy: "review", skill_ids: [] }, { id: "qa", role: "qa", name: "Q", enabled: true, autonomy: "review", skill_ids: [] }],
}));

const KPI = await import("./kpis.ts");
const COST = await import("./costs.ts");
const PERF = await import("./agent-performance.ts");
const W = await import("./work-items.ts");
const WF = await import("./workflows.ts");
const { createApproval, listPendingApprovals } = await import("./approvals.ts");
const { postAgentMessage } = await import("./agent-messages.ts");
WF.ensureDefaultTemplates();

// seed a small floor
W.createWorkItem({ title: "done task A", assigned_agent_id: "dev", state: "done" });
W.createWorkItem({ title: "done task B", assigned_agent_id: "dev", state: "done", pr: 7 });
W.createWorkItem({ title: "failed task", assigned_agent_id: "dev", state: "failed" });
W.createWorkItem({ title: "blocked task", assigned_agent_id: "qa", state: "blocked" });
postAgentMessage({ from_agent_id: "dev", to_agent_id: "qa", type: "handoff", payload: { note: "over to you" } });
postAgentMessage({ from_agent_id: "qa", to_agent_id: null, type: "blocker", payload: { note: "waiting on keys" } });
createApproval({ kind: "merge", summary: "merge #7", pr: 7, action: { type: "merge", pr: 7 } });
// a workflow with one completed step (emits the RAW type "step_completed")
const wf = WF.createWorkflowFromTemplate({ template_id: "tpl_fix_bug", title: "kpi workflow" });
WF.completeStep(wf.workflow.id, wf.steps[0].id);

test("KPIs: productivity/quality/speed metrics with honest real/derived labels", () => {
  const r = KPI.buildKpis({ period: "all" });
  const p = Object.fromEntries(r.productivity.map((m) => [m.key, m]));
  assert.equal(p.tasks_done.value, 2);
  assert.equal(p.tasks_done.source, "real");
  assert.equal(p.open_blockers.value >= 1, true);
  assert.equal(p.open_decisions.value >= 1, true); // the pending merge approval
  assert.ok(r.speed.find((m) => m.key === "avg_task_h")?.source === "derived");
  assert.ok(Array.isArray(r.trends.tasks_done) && r.trends.tasks_done.length === 7);
});

test("Costs: activity-based ESTIMATE, no fabricated euros until a rate is set", () => {
  const u = COST.estimateUsage({ period: "all", groupBy: "agent" });
  assert.equal(u.is_estimate, true);
  const dev = u.rows.find((x) => x.key === "dev");
  assert.ok(dev && dev.activity_units > 0 && dev.est_tokens > 0);
  assert.equal(dev.est_cost_usd, null); // no rate configured ⇒ NO invented money
  COST.setBudgetConfig({ usd_per_1k_tokens: 0.006 });
  const priced = COST.estimateUsage({ period: "all", groupBy: "agent" }).rows.find((x) => x.key === "dev");
  assert.ok(priced && typeof priced.est_cost_usd === "number" && priced.est_cost_usd > 0, "a configured rate produces a (clearly-estimate) cost");
  COST.setBudgetConfig({ usd_per_1k_tokens: 0 }); // reset
});

test("Budget: exceeded → status + a deduped Decision-Inbox escalation", () => {
  COST.setBudgetConfig({ per_agent_tokens: 1 }); // tiny budget → today's estimate exceeds it
  const st = COST.budgetStatus();
  const dev = st.agents.find((a) => a.key === "dev");
  assert.ok(dev && dev.state === "exceeded", `dev should be over budget, got ${dev?.state}`);
  const before = listPendingApprovals().length;
  const esc1 = COST.checkBudgetsAndEscalate();
  assert.ok(esc1.escalated.includes("agent:dev"), "an escalation is raised for the exceeded budget (scope-namespaced)");
  assert.equal(listPendingApprovals().length, before + esc1.escalated.length);
  const esc2 = COST.checkBudgetsAndEscalate(); // deduped once per day
  assert.equal(esc2.escalated.length, 0);
  COST.setBudgetConfig({ per_agent_tokens: 0 }); // reset
});

test("Workflow-step metrics use the RAW emitted event types (step_completed), not war-room display names", () => {
  const q = Object.fromEntries(KPI.buildKpis({ period: "all" }).quality.map((m) => [m.key, m]));
  assert.ok(Number(q.step_success_rate.value) > 0, "the completed step is counted in the success rate");
  assert.ok(COST.estimateUsage({ period: "all", groupBy: "workflow" }).rows.length >= 1, "per-workflow usage counts step activity");
});

test("Agent performance: per-agent success/failure, last tasks, collaborators, leaderboard", () => {
  const r = PERF.buildAgentPerformance();
  const dev = r.agents.find((a) => a.id === "dev")!;
  assert.equal(dev.tasks_done, 2);
  assert.equal(dev.tasks_failed, 1);
  assert.ok(Math.round(Number(dev.success_rate.value)) === Math.round((2 / 3) * 100));
  assert.ok(dev.last_10.length >= 3);
  assert.ok(dev.best_collaborators.some((c) => c.agent_id === "qa"), "dev's top collaborator is qa (handoff)");
  const qa = r.agents.find((a) => a.id === "qa")!;
  assert.ok(qa.common_blockers.some((b) => b.text.includes("keys")), "qa's blocker is surfaced");
});
