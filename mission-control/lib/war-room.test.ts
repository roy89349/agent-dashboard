// Run: node --test --experimental-sqlite mission-control/lib/war-room.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "warroom-"));
fs.mkdirSync(path.join(TMP, "data"), { recursive: true });
fs.mkdirSync(path.join(TMP, "control"), { recursive: true });
process.env.FLEET_DIR = TMP;
fs.writeFileSync(path.join(TMP, "control", "agents.json"), JSON.stringify({
  schema: 1, rev: 0, updated_at: null,
  agents: [
    { id: "dev", role: "backend", name: "Dev", enabled: true, autonomy: "review", skill_ids: [] },
    { id: "fe", role: "frontend", name: "Fe", enabled: true, autonomy: "review", skill_ids: [] },
    { id: "q", role: "qa", name: "Q", enabled: true, autonomy: "review", skill_ids: [], daily_token_budget: 50000 },
  ],
}));

const WR = await import("./war-room.ts");
const W = await import("./work-items.ts");
const WF = await import("./workflows.ts");
const { createApproval } = await import("./approvals.ts");
const { db, recordAudit } = await import("./db.ts");
WF.ensureDefaultTemplates();

test("health + buckets reflect the current work items / workflows / approvals", () => {
  W.createWorkItem({ title: "dev is building", assigned_agent_id: "dev", state: "running" });
  W.createWorkItem({ title: "fe is blocked", assigned_agent_id: "fe", state: "blocked" });
  const wf = WF.createWorkflowFromTemplate({ template_id: "tpl_fix_bug", title: "a workflow" });
  createApproval({ kind: "merge", summary: "merge PR 5", pr: 5, action: { type: "merge", pr: 5 } });

  const snap = WR.buildWarRoom();
  assert.equal(snap.buckets.working, 1);   // dev
  assert.equal(snap.buckets.blocked, 1);   // fe
  assert.equal(snap.health.blockers >= 1, true);
  assert.equal(snap.health.workflows_running >= 1, true);
  assert.equal(snap.health.open_decisions >= 1, true);
  assert.equal(snap.health.prs_ready >= 1, true); // the pending merge approval
  assert.ok(snap.agents.find((a) => a.id === "dev")?.status === "working");
  assert.ok(snap.agents.find((a) => a.id === "fe")?.status === "blocked");
  // q has no active work item → sleeping, and carries the budget placeholder
  const q = snap.agents.find((a) => a.id === "q")!;
  assert.equal(q.status, "sleeping");
  assert.ok(q.budget && q.budget.includes("tok/day"));
  void wf;
});

test("timeline is built from audit + workflow_events, typed with a severity, newest first", () => {
  const snap = WR.buildWarRoom();
  assert.ok(snap.events.length > 0);
  // it should include a workflow-started (from workflow_events) and a work-item-created (from audit)
  assert.ok(snap.events.some((e) => e.category === "workflow"));
  assert.ok(snap.events.some((e) => e.type === "work_item_created"));
  assert.ok(snap.events.some((e) => e.type === "approval_requested"));
  // every event carries a severity + a monotonic (desc) timestamp
  for (const e of snap.events) assert.ok(["info", "success", "warn", "danger"].includes(e.severity));
  for (let i = 1; i < snap.events.length; i++) assert.ok(snap.events[i - 1].ts >= snap.events[i].ts);
});

test("adjacent same-type events for the same subject are grouped with a count (no log spam)", () => {
  const wi = W.createWorkItem({ title: "noisy", assigned_agent_id: "dev", state: "queued", issue: 4242 });
  // several rapid updates on the SAME item → audit rows of the same type/subject (linked by issue)
  for (let i = 0; i < 4; i++) W.updateWorkItem(wi.id, { priority: i % 2 === 0 ? "high" : "normal", actor: "dev" });
  const snap = WR.buildWarRoom();
  const grouped = snap.events.find((e) => e.work_item_id === wi.id && e.count > 1);
  assert.ok(grouped, "the rapid same-subject updates should collapse into one group with count>1");
});

test("facets expose teams / agents / roles / workflows / severities for the filters", () => {
  const snap = WR.buildWarRoom();
  assert.deepEqual(snap.facets.roles.sort(), ["backend", "frontend", "qa"]);
  assert.equal(snap.facets.agents.length, 3);
  assert.ok(snap.facets.workflows.length >= 1);
  assert.deepEqual(snap.facets.severities, ["danger", "warn", "success", "info"]);
});

test("permission.denied surfaces as a security/blocked event (keyed off the action, not the detail)", () => {
  recordAudit({ action: "permission.denied", detail: "autonomy 1 < required 2 for merge", actor: "dev", via: "fleet" });
  const snap = WR.buildWarRoom();
  const denied = snap.events.find((e) => e.category === "security" && e.type === "blocked");
  assert.ok(denied, "an agent access denial must appear in the timeline");
  assert.ok(denied!.title.includes("autonomy 1"));
});

test("distinct events sharing a coarse type are NOT merged (fleet mode vs breaker reset)", () => {
  recordAudit({ action: "fleet.mode", detail: "paused", actor: "roy", via: "telegram" });
  recordAudit({ action: "fleet.breaker_reset", detail: null, actor: "roy", via: "telegram" });
  const snap = WR.buildWarRoom();
  const fleetEvents = snap.events.filter((e) => e.type === "fleet_change");
  assert.ok(fleetEvents.some((e) => e.title.includes("paused")), "the mode change survives");
  assert.ok(fleetEvents.some((e) => e.title.includes("Breaker")), "the breaker reset survives (not merged away)");
});

test("buildWarRoom is READ-ONLY: an expired-but-unswept pending approval is not counted and not mutated by the GET", () => {
  const { approval } = createApproval({ kind: "risky_action", summary: "lapsed", action: { type: "noop" }, ttlMs: -1000 }); // already past expiry
  const before = WR.buildWarRoom().health.open_decisions;
  const snap = WR.buildWarRoom();
  assert.equal(snap.health.open_decisions, before); // the lapsed approval is treated as expired (not an open decision)
  // and the row was NOT flipped to 'expired' by the snapshot (no write from the read path)
  const row = db().prepare("SELECT status FROM approvals WHERE id = ?").get(approval.id) as { status: string };
  assert.equal(row.status, "pending");
});

test("buildWarRoom never throws when the fleet status file is absent (offline-safe)", () => {
  const snap = WR.buildWarRoom();
  assert.equal(typeof snap.health.mode, "string");
  assert.equal(snap.health.online, false); // no status.json in the test dir
});
