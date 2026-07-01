// Run: node --test mission-control/lib/rejection-learning.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Isolate the SQLite db in a temp FLEET_DIR before anything calls db() (created lazily once).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "rejection-learning-"));
fs.mkdirSync(path.join(TMP, "data"), { recursive: true });
process.env.FLEET_DIR = TMP;

const { learnFromRejection, WARNING_AFTER } = await import("./rejection-learning.ts");
const { listMemory, memoryWarningsFor } = await import("./agent-memory.ts");
const { createWorkItem } = await import("./work-items.ts");

let n = 0;
const approval = (over: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  kind: "merge" as const,
  summary: "merge PR: refactor payments module",
  reason: "te groot, splits dit op",
  agent_id: "backend-1" as string | null,
  work_item_id: null as string | null,
  issue: 12 as number | null,
  pr: 34 as number | null,
  ...over,
});

test("a rejected approval becomes a persisted lesson for the agent (redacted, sourced, audited)", () => {
  const a = approval({ reason: "te groot; bevat token github_pat_abcdefghij1234567890XY" });
  const mem = learnFromRejection(a, "roy");
  assert.ok(mem, "expected a memory item");
  assert.equal(mem!.agent_id, "backend-1");
  assert.equal(mem!.type, "lesson");
  assert.equal(mem!.source_type, "decision");
  assert.equal(mem!.source_ref, a.id);
  assert.match(mem!.title, /Rejected merge/);
  assert.match(mem!.content ?? "", /te groot/);
  assert.ok(!(mem!.content ?? "").includes("github_pat_"), "reason must be redacted in the stored lesson");
});

test("idempotent per approval: a re-tapped Reject never duplicates the lesson", () => {
  const a = approval();
  const first = learnFromRejection(a, "roy");
  assert.ok(first);
  const before = listMemory({ agent_id: "backend-1" }).length;
  assert.equal(learnFromRejection(a, "roy"), null);
  assert.equal(listMemory({ agent_id: "backend-1" }).length, before);
});

test(`>= ${WARNING_AFTER} same-kind rejections escalate to ONE standing warning`, () => {
  // the two tests above already wrote 2 merge-rejection lessons for backend-1 → this is #3
  assert.equal(memoryWarningsFor("backend-1").length, 0);
  learnFromRejection(approval({ summary: "merge PR: third strike" }), "roy");
  const warnings = memoryWarningsFor("backend-1");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].title, /Repeated rejections: merge/);
  // a 4th rejection does NOT add a second warning
  learnFromRejection(approval({ summary: "merge PR: fourth" }), "roy");
  assert.equal(memoryWarningsFor("backend-1").length, 1);
});

test("agent resolution falls back to the work item's role → the enabled agent for that role", () => {
  // seed a minimal registry in the temp FLEET_DIR (control/agents.json)
  fs.mkdirSync(path.join(TMP, "control"), { recursive: true });
  fs.writeFileSync(
    path.join(TMP, "control", "agents.json"),
    JSON.stringify({ schema: 1, rev: 1, agents: [{ id: "frontend", name: "Frontend Engineer", role: "frontend", enabled: true }] }),
  );
  const wi = createWorkItem({ title: "fix navbar", assigned_role: "frontend" });
  const mem = learnFromRejection(approval({ agent_id: null, work_item_id: wi.id, kind: "plan_signoff" }), "roy");
  assert.ok(mem, "expected the lesson to land on the frontend role's agent");
  assert.equal(mem!.agent_id, "frontend");
});

test("no agent resolvable or a prompt_confirm → no lesson (never throws)", () => {
  assert.equal(learnFromRejection(approval({ agent_id: null, work_item_id: null })), null);
  assert.equal(learnFromRejection(approval({ kind: "prompt_confirm" })), null);
});
