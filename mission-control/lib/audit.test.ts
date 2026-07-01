// Run: node --test --experimental-sqlite mission-control/lib/audit.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "audit-"));
fs.mkdirSync(path.join(TMP, "data"), { recursive: true });
process.env.FLEET_DIR = TMP;

const A = await import("./audit.ts");
const { recordAudit } = await import("./db.ts");
const TOKEN = "ghp_" + "A".repeat(36);

test("logAuditEvent appends + getAuditEvent reads; secrets are REDACTED out of old/new/details", () => {
  const id = A.logAuditEvent({
    action: "autonomy.changed", actor_type: "user", actor_id: "roy", source: "dashboard",
    risk_level: "high", status: "allowed", target_type: "agent", target_id: "backend",
    old_value: { autonomy: "review" }, new_value: { autonomy: "auto", secret: TOKEN }, details: `set with ${TOKEN}`,
    related_approval_id: "ap-1",
  });
  const ev = A.getAuditEvent(id)!;
  assert.equal(ev.action, "autonomy.changed");
  assert.equal(ev.target_id, "backend");
  assert.equal(ev.status, "allowed");
  assert.ok(!JSON.stringify(ev).includes(TOKEN), "no token anywhere in the stored event");
  assert.ok(ev.old_value_json?.includes("review"), "non-secret old value preserved");
});

test("recordAudit BRIDGES every legacy call into audit_events (inferred fields)", () => {
  recordAudit({ actor: "roy", via: "dashboard", action: "approval.decide", approval_id: "ap-9", detail: "approved #7" });
  const { events } = A.listAuditEvents({ approval_id: "ap-9" });
  assert.equal(events.length, 1);
  assert.equal(events[0].related_approval_id, "ap-9");
  assert.equal(events[0].target_type, "approval");
  assert.equal(events[0].actor_type, "user"); // via dashboard → user
  assert.equal(events[0].source, "dashboard");
  // a denied permission infers status denied
  recordAudit({ actor: "backend", via: "system", action: "permission.denied", detail: "blocked rm -rf" });
  assert.equal(A.listAuditEvents({ action: "permission.denied" }).events[0].status, "denied");
});

test("filters: action prefix, status, source, actor, agent (actor|target), date range + search", () => {
  A.logAuditEvent({ action: "workflow.started", actor_id: "a1", source: "worker", status: "allowed", related_workflow_id: "wf1" });
  A.logAuditEvent({ action: "workflow.failed", actor_id: "a1", source: "worker", status: "failed", related_workflow_id: "wf1" });
  A.logAuditEvent({ action: "memory.update", actor_id: "roy", target_id: "backend", source: "dashboard", summary: "uniqueneedle42" });
  assert.ok(A.listAuditEvents({ action: "workflow." }).events.length >= 2, "trailing-dot prefix matches the family");
  assert.equal(A.listAuditEvents({ action: "workflow.failed" }).events.length, 1);
  assert.ok(A.listAuditEvents({ status: "failed" }).events.length >= 1);
  assert.ok(A.listAuditEvents({ source: "worker" }).events.length >= 2);
  assert.ok(A.listAuditEvents({ agent_id: "backend" }).events.some((e) => e.action === "memory.update"), "agent filter matches target_id");
  assert.ok(A.listAuditEvents({ q: "uniqueneedle42" }).events.length === 1, "search hits the summary");
  assert.equal(A.listAuditEvents({ workflow_id: "wf1" }).events.length, 2);
});

test("pagination returns a total + a bounded page", () => {
  const r = A.listAuditEvents({ limit: 2, offset: 0 });
  assert.ok(r.total >= 5);
  assert.ok(r.events.length <= 2);
});

test("export JSON + CSV; CSV neutralises formula injection + escapes", () => {
  A.logAuditEvent({ action: "config.change", summary: "=SUM(A1:A9)", actor_id: "roy,evil" });
  const json = A.exportAuditEvents({}, "json");
  assert.equal(json.contentType, "application/json");
  assert.ok(JSON.parse(json.body).length >= 1);
  const csv = A.exportAuditEvents({}, "csv");
  assert.ok(csv.filename.endsWith(".csv"));
  assert.ok(csv.body.includes("'=SUM(A1:A9)"), "a leading = is prefixed to block spreadsheet formula injection");
  assert.ok(csv.body.includes('"roy,evil"'), "a comma cell is quoted");
  assert.ok(!csv.body.includes(TOKEN), "export never contains a raw token");
});

test("redactAuditDetails scrubs a token", () => {
  assert.ok(!A.redactAuditDetails({ k: TOKEN }).includes("ghp_AAAA"));
});

test("bridge status inference is precise (operational actions not mislabeled)", () => {
  recordAudit({ via: "system", action: "work_item.block", detail: "blocked on deps" });
  recordAudit({ via: "system", action: "plan.approve_skipped", detail: "stale" });
  recordAudit({ via: "system", action: "workflow.step_failed", detail: "boom" });
  const st = (action: string) => A.listAuditEvents({ action }).events[0]?.status;
  assert.equal(st("work_item.block"), "allowed", "an operational block is NOT an access-denial");
  assert.equal(st("plan.approve_skipped"), "allowed", "a skipped (no-op) approval is NOT 'approved'");
  assert.equal(st("workflow.step_failed"), "failed");
  // an explicit status always wins over inference
  recordAudit({ via: "dashboard", action: "generic.thing", status: "denied", detail: "x" });
  assert.equal(st("generic.thing"), "denied");
});
