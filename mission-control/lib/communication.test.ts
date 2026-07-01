// Run: node --test --experimental-sqlite mission-control/lib/communication.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "comm-"));
fs.mkdirSync(path.join(TMP, "data"), { recursive: true });
fs.mkdirSync(path.join(TMP, "control"), { recursive: true });
process.env.FLEET_DIR = TMP;
fs.writeFileSync(path.join(TMP, "control", "agents.json"), JSON.stringify({
  schema: 1, rev: 0, updated_at: null,
  agents: [{ id: "dev", role: "backend", name: "Dev", enabled: true, autonomy: "review", skill_ids: [] }, { id: "comms", role: "communication", name: "Comms", enabled: true, autonomy: "review", skill_ids: [] }],
}));

const C = await import("./communication.ts");
const W = await import("./work-items.ts");
const WF = await import("./workflows.ts");
const { createApproval, getApproval } = await import("./approvals.ts");
const { postAgentMessage } = await import("./agent-messages.ts");
const KI = await import("./knowledge-index.ts");
WF.ensureDefaultTemplates();

// seed a realistic floor
W.createWorkItem({ title: "shipped the dark mode toggle", assigned_agent_id: "dev", state: "done" });
W.createWorkItem({ title: "building the settings page", assigned_agent_id: "dev", state: "running" });
const blockedWi = W.createWorkItem({ title: "payments integration", assigned_agent_id: "dev", state: "blocked" });
postAgentMessage({ from_agent_id: "dev", to_agent_id: "user", work_item_id: blockedWi.id, type: "blocker", payload: { note: "waiting on API keys" } });
WF.createWorkflowFromTemplate({ template_id: "tpl_fix_bug", title: "fix the login bug" });
createApproval({ kind: "merge", summary: "merge PR 12 (login fix)", pr: 12, action: { type: "merge", pr: 12 } });

test("buildSections produces the 6-section summary with traceable source refs", () => {
  const ctx = C.gatherContext();
  const s = C.buildSections("live", ctx);
  assert.ok(s.done.some((r) => r.text.includes("dark mode") && r.work_item_id), "done includes the finished task + a link");
  assert.ok(s.running.some((r) => r.text.includes("settings page")), "running includes the in-progress task");
  assert.ok(s.blocked.some((r) => r.text.includes("payments")), "blocked includes the blocked item");
  assert.ok(s.blocked.some((r) => r.text.includes("API keys")), "blocked includes the blocker message");
  assert.ok(s.usage.length >= 2, "usage carries activity counts");
  assert.ok(s.decisions.some((r) => r.approval_id && r.text.toLowerCase().includes("merge")), "decisions references the pending approval (a real Decision-Inbox item)");
  assert.ok(s.advice.some((r) => r.text.includes("decision")), "advice nudges toward the inbox");
});

test("generateSummary stores a summary; listSummaries + getSummary return it", () => {
  const sum = C.generateSummary({ type: "daily_standup", created_by: "comms" });
  assert.equal(sum.type, "daily_standup");
  assert.ok(sum.title.includes("Daily standup"));
  assert.equal(sum.delivered_phone, false); // no phone configured in the test
  assert.ok(C.listSummaries({ type: "daily_standup" }).some((x) => x.id === sum.id));
  assert.equal(C.getSummary(sum.id)!.id, sum.id);
  // rendered text has the section headers
  const txt = C.renderSummaryText(sum);
  assert.ok(txt.includes("Done") && txt.includes("Decisions waiting"));
});

test("askTeam does a context search and answers SHORT with links (no chat noise)", () => {
  const r = C.askTeam("what is happening with dark mode?");
  assert.ok(r.refs.some((ref) => ref.text.toLowerCase().includes("dark mode") && ref.work_item_id), "found the dark-mode task with a link");
  assert.ok(r.answer.length < 200, "the answer is short");
  // an unrelated question returns the graceful fallback
  const none = C.askTeam("zxqwv nonexistent topic");
  assert.equal(none.refs.length, 0);
});

test("askTeam also consults the Knowledge Vault (the project brain informs the answer)", () => {
  KI.addKnowledgeSource({ kind: "manual", title: "Payments architecture note", content: "Stripe is the payment provider.", type: "architecture" });
  const r = C.askTeam("how do payments work?");
  assert.ok(r.refs.some((ref) => ref.knowledge_id && ref.text.includes("Payments")), "the knowledge item is cited with a link back to /kennis");
});

test("escalate turns a real choice into a Decision-Inbox approval (kind escalation)", () => {
  const { approval } = C.escalate({ question: "Ship v2 to production now?", advice: "QA is green; the team recommends shipping." });
  assert.equal(approval.kind, "escalation");
  assert.ok(approval.summary.includes("Ship v2"));
  assert.equal(getApproval(approval.id)!.status, "pending"); // it's a durable decision, not a loose message
  // it now shows up as a decision waiting on Roy
  assert.ok(C.buildSections("live", C.gatherContext()).decisions.some((d) => d.approval_id === approval.id));
});

test("usage counts are the TRUE totals, not the display cap (>8), and truncation is surfaced", () => {
  for (let i = 0; i < 10; i++) W.createWorkItem({ title: `bulk done ${i}`, state: "done" });
  const s = C.buildSections("live", C.gatherContext());
  const usage = s.usage.map((u) => u.text).join(" ");
  const m = usage.match(/(\d+) tasks done/);
  assert.ok(m && Number(m[1]) >= 10, `usage should report the true done count (≥10), got: ${usage}`);
  assert.ok(s.done.some((r) => r.text.includes("more done")), "the truncated 'done' list surfaces '…and N more'");
});

test("a team-scoped summary excludes OTHER teams' decisions (no misleading cross-team mixing)", () => {
  const wiA = W.createWorkItem({ title: "team A task", team_id: "ta" });
  const wiB = W.createWorkItem({ title: "team B task", team_id: "tb" });
  createApproval({ kind: "risky_action", summary: "team A decision", work_item_id: wiA.id, action: { type: "noop" } });
  createApproval({ kind: "risky_action", summary: "team B decision", work_item_id: wiB.id, action: { type: "noop" } });
  const decA = C.buildSections("live", C.gatherContext("ta")).decisions;
  assert.ok(decA.some((d) => d.text.includes("team A")), "team A's decision is present");
  assert.ok(!decA.some((d) => d.text.includes("team B")), "team B's decision is NOT in team A's summary");
});

test("per-team communicator config: explicit override, else the team lead default", () => {
  C.setCommunicator("team-x", "comms");
  assert.equal(C.communicatorForTeam("team-x"), "comms");
  C.setCommunicator("team-x", null); // clear → falls back (no teams.json here → null)
  assert.equal(C.communicatorForTeam("team-x"), null);
});
