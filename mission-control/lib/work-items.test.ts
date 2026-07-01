// Run: node --test --experimental-sqlite mission-control/lib/work-items.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "wi-"));
fs.mkdirSync(path.join(TMP, "data"), { recursive: true });
process.env.FLEET_DIR = TMP;

const W = await import("./work-items.ts");

test("createWorkItem: defaults + enum clamp + redacted title; requires a title", () => {
  const wi = W.createWorkItem({ title: "Fix login with github_pat_abcdefghij1234567890XY", source_type: "chat", priority: "urgent", state: "bogus" as never });
  assert.equal(wi.source_type, "chat");
  assert.equal(wi.priority, "urgent");
  assert.equal(wi.state, "queued"); // invalid state → default
  assert.equal(wi.risk_level, "low");
  assert.ok(!wi.title.includes("github_pat_")); // redacted
  assert.throws(() => W.createWorkItem({ title: "   " }), /title required/);
});

test("listWorkItems: filter by state + issue", () => {
  W.createWorkItem({ title: "A", issue: 101, state: "running" });
  W.createWorkItem({ title: "B", issue: 102, state: "done" });
  assert.equal(W.listWorkItems({ issue: 101 }).length, 1);
  assert.ok(W.listWorkItems({ state: "running" }).some((w) => w.issue === 101));
});

test("update + assign + complete + block transitions (with valid enums)", () => {
  const wi = W.createWorkItem({ title: "T", issue: 200 });
  const a = W.assignWorkItem(wi.id, { agent_id: "frontend", role: "frontend", team_id: "build", actor: "dashboard" });
  assert.equal(a.assigned_agent_id, "frontend");
  const r = W.updateWorkItem(wi.id, { state: "review", risk_level: "high" });
  assert.equal(r.state, "review");
  assert.equal(r.risk_level, "high");
  const done = W.completeWorkItem(wi.id, { pr: 42 });
  assert.equal(done.state, "done");
  assert.equal(done.pr, 42);
  const blocked = W.blockWorkItem(wi.id, "waiting on secrets github_pat_zzzzzzzzzzzzzzzzzzzz");
  assert.equal(blocked.state, "blocked");
  assert.throws(() => W.updateWorkItem("nope", { state: "done" }), (e: unknown) => W.httpStatusOf(e) === 404);
});

test("workItemForIssue is idempotent (backward compat: one work item per issue)", () => {
  const a = W.workItemForIssue(999, { title: "Issue #999", assigned_role: "backend" });
  const b = W.workItemForIssue(999);
  assert.equal(a.id, b.id);
  assert.equal(a.source_type, "github_issue");
  assert.equal(a.issue, 999);
});

test("createWorkItem is idempotent by issue (no duplicate work item per issue)", () => {
  const a = W.createWorkItem({ title: "one", issue: 777 });
  const b = W.createWorkItem({ title: "two", issue: 777 }); // same issue → returns the first
  assert.equal(a.id, b.id);
  assert.equal(W.listWorkItems({ issue: 777 }).length, 1);
});

test("parent/child links; no self-parent", () => {
  const parent = W.createWorkItem({ title: "Epic" });
  const child = W.createWorkItem({ title: "Sub", parent_task_id: parent.id });
  assert.deepEqual(W.childWorkItems(parent.id).map((c) => c.id), [child.id]);
  const noSelf = W.updateWorkItem(parent.id, { parent_task_id: parent.id });
  assert.equal(noSelf.parent_task_id, null); // self-parent rejected
});
