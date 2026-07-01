// Run: node --test --experimental-sqlite mission-control/lib/conversations.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "conv-"));
fs.mkdirSync(path.join(TMP, "data"), { recursive: true });
process.env.FLEET_DIR = TMP;

const C = await import("./conversations.ts");
const { createConversation } = await import("./db.ts");

test("kindGroup maps legacy + new kinds; old 'orchestrator'/'task' rows stay visible", () => {
  assert.equal(C.kindGroup("orchestrator"), "team");
  assert.equal(C.kindGroup("team"), "team");
  assert.equal(C.kindGroup("task"), "task");
  assert.equal(C.kindGroup("workflow"), "task");
  assert.equal(C.kindGroup("decision"), "decision");
  assert.equal(C.kindGroup("summary"), "summary");
  assert.equal(C.kindGroup("weird-legacy"), "team"); // never dropped
});

test("createThread persists link columns; grouping buckets old + new", () => {
  createConversation({ id: "legacy-1", kind: "orchestrator", title: "Old chat" }); // pre-existing row
  const dec = C.createThread({ kind: "decision", title: "d", approval_id: "ap-x" });
  const task = C.createThread({ kind: "task", title: "t", work_item_id: "wi-x" });
  assert.equal(dec.approval_id, "ap-x");
  assert.equal(task.group, "task");
  const g = C.listGrouped();
  assert.ok(g.team.some((t) => t.id === "legacy-1"), "legacy orchestrator lands in Team group");
  assert.ok(g.decision.some((t) => t.id === dec.id));
  assert.ok(g.task.some((t) => t.id === task.id));
});

test("postMessage stores type + agent_id; log-type content is redacted", () => {
  const t = C.createThread({ kind: "team", title: "chat" });
  C.postMessage({ conversation_id: t.id, role: "user", type: "question", content: "hi" });
  C.postMessage({ conversation_id: t.id, role: "system", type: "log", content: "secret ghp_" + "A".repeat(36), agent_id: "backend" });
  const msgs = C.threadMessages(t.id);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].type, "question");
  assert.equal(msgs[1].agent_id, "backend");
  assert.ok(!msgs[1].content.includes("ghp_AAAA"), "a secret in a log message is redacted");
  assert.throws(() => C.postMessage({ conversation_id: "nope", role: "user", content: "x" }), (e) => C.convStatusOf(e) === 404);
});

test("search finds by title and by message content (wildcards escaped)", () => {
  const t = C.createThread({ kind: "team", title: "Deploy planning" });
  C.postMessage({ conversation_id: t.id, role: "user", content: "let us discuss the rollback strategy" });
  assert.ok(C.searchThreads("Deploy").some((x) => x.id === t.id), "found by title");
  assert.ok(C.searchThreads("rollback").some((x) => x.id === t.id), "found by message content");
  assert.equal(C.searchThreads("").length, 0);
  assert.doesNotThrow(() => C.searchThreads("50% _off\\")); // wildcard chars must not break the query
});

test("getOrCreateTeamChat is a singleton", () => {
  const a = C.getOrCreateTeamChat();
  const b = C.getOrCreateTeamChat();
  assert.equal(a.id, b.id);
  assert.equal(a.kind, "team");
});

test("threadForApproval creates a decision thread linked to the approval (deduped)", async () => {
  const { createApproval } = await import("./approvals.ts");
  const { approval } = createApproval({ kind: "escalation", summary: "ship it?" });
  const t1 = C.threadForApproval(approval.id, { create: true })!;
  assert.equal(t1.approval_id, approval.id);
  assert.equal(t1.kind, "decision");
  const t2 = C.threadForApproval(approval.id, { create: true })!;
  assert.equal(t1.id, t2.id, "same approval → same thread");
  assert.equal(C.threadForApproval("no-such-approval"), null);
});

test("phone messages log into the team chat (redacted), typed 'log'", () => {
  const before = C.threadMessages(C.getOrCreateTeamChat().id).length;
  C.logPhoneMessage({ direction: "in", text: "status please", chatId: "123" });
  C.logPhoneMessage({ direction: "out", text: "3 tasks running" });
  const msgs = C.threadMessages(C.getOrCreateTeamChat().id);
  assert.equal(msgs.length, before + 2);
  assert.equal(msgs.at(-1)!.type, "log");
  assert.ok(msgs.at(-1)!.content.includes("phone"));
});

test("chat actions bridge to real services + drop a system note", async () => {
  const t = C.createThread({ kind: "team", title: "planning" });
  const { work_item } = C.createTaskFromChat({ conversation_id: t.id, title: "Add export button" });
  assert.ok(work_item.id);
  const { approval, thread } = C.createDecisionFromChat({ conversation_id: t.id, question: "Deploy on Friday?" });
  assert.equal(approval.kind, "escalation");
  assert.equal(thread.approval_id, approval.id);
  const asg = C.assignToAgent({ conversation_id: t.id, to_role: "backend", title: "Fix the API" });
  assert.equal(asg.work_item.assigned_role, "backend");
  const mgr = C.sendToManager({ conversation_id: t.id, note: "Prioritise the billing bug" });
  assert.equal(mgr.agent_message.to_role, "manager");
  // the thread accumulated the system notes
  const sys = C.threadMessages(t.id).filter((m) => m.role === "system");
  assert.ok(sys.length >= 4);
});

test("chat actions on a bad conversation fail fast with NO orphaned resource", async () => {
  const { listPendingApprovals } = await import("./approvals.ts");
  const before = listPendingApprovals().length;
  assert.throws(() => C.createDecisionFromChat({ conversation_id: "does-not-exist", question: "leak?" }), (e) => C.convStatusOf(e) === 404);
  assert.equal(listPendingApprovals().length, before, "no approval was minted for a bad conversation");
  assert.throws(() => C.createTaskFromChat({ conversation_id: "nope", title: "leak" }), (e) => C.convStatusOf(e) === 404);
  assert.throws(() => C.sendToManager({ conversation_id: "nope", note: "leak" }), (e) => C.convStatusOf(e) === 404);
});
