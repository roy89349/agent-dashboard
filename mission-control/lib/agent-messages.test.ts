// Run: node --test --experimental-sqlite mission-control/lib/agent-messages.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "am-"));
fs.mkdirSync(path.join(TMP, "data"), { recursive: true });
process.env.FLEET_DIR = TMP;
delete process.env.TELEGRAM_BOT_TOKEN; // phone not configured → no notify

const M = await import("./agent-messages.ts");
const { listPendingApprovals } = await import("./approvals.ts");

test("postAgentMessage: enum, redacted payload, new thread, summary", () => {
  const m = M.postAgentMessage({
    from_agent_id: "frontend", to_role: "qa", type: "handoff", work_item_id: "wi1",
    payload: { note: "please review the navbar; token github_pat_abcdefghij1234567890XY" },
  });
  assert.equal(m.type, "handoff");
  assert.ok(m.thread_id); // generated
  assert.equal(m.status, "pending");
  assert.ok(!JSON.stringify(m.payload).includes("github_pat_")); // redacted
  assert.match(M.messageSummary(m), /handed off to qa/);
});

test("requires_human posts a durable approval (Decision Inbox) linked to the message", () => {
  const before = listPendingApprovals().length;
  const m = M.postAgentMessage({ from_agent_id: "manager", to_role: "user", type: "question", work_item_id: "wi2", requires_human: true, payload: { note: "ship on Friday?" } });
  assert.ok(m.requires_human);
  assert.ok(m.approval_id); // approval created + linked
  assert.equal(listPendingApprovals().length, before + 1);
  assert.ok(listPendingApprovals().some((a) => a.id === m.approval_id && a.kind === "plan_signoff"));
});

test("listThread + listMessagesForWorkItem are ordered; resolveMessage sets terminal state", () => {
  const t = "thread-x";
  const a = M.postAgentMessage({ from_agent_id: "backend", to_agent_id: "qa", type: "review_request", thread_id: t, work_item_id: "wi3" });
  M.postAgentMessage({ from_agent_id: "qa", to_agent_id: "backend", type: "result", thread_id: t, work_item_id: "wi3" });
  assert.equal(M.listThread(t).length, 2);
  assert.equal(M.listMessagesForWorkItem("wi3").length, 2);
  const r = M.resolveMessage(a.id, "done", "dashboard");
  assert.equal(r.status, "done");
  assert.ok(r.resolved_at); // terminal → resolved_at set
  assert.throws(() => M.resolveMessage(a.id, "in_progress"), (e: unknown) => M.httpStatusOf(e) === 409); // can't reopen a terminal message
  assert.throws(() => M.resolveMessage("nope", "done"), (e: unknown) => M.httpStatusOf(e) === 404);
});

test("redactPayload redacts secrets in KEYS as well as values", () => {
  const m = M.postAgentMessage({ from_agent_id: "x", type: "summary", payload: { "github_pat_abcdefghij1234567890XY": "used here", note: "token sk-ant-abcdefghijklmnop" } });
  const json = JSON.stringify(m.payload);
  assert.ok(!json.includes("github_pat_")); // key redacted
  assert.ok(!json.includes("sk-ant-")); // value redacted
});
