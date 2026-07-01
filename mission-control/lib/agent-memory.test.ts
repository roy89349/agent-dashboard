// Run: node --test --experimental-sqlite mission-control/lib/agent-memory.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mem-"));
fs.mkdirSync(path.join(TMP, "data"), { recursive: true });
process.env.FLEET_DIR = TMP;

const M = await import("./agent-memory.ts");

test("addMemory / list / update / disable / archive", () => {
  const m = M.addMemory({ agent_id: "dev", type: "strength", title: "Great at SQL", content: "Writes clean queries", created_by: "roy" });
  assert.equal(m.type, "strength");
  assert.equal(m.enabled, true);
  assert.ok(M.listMemory({ agent_id: "dev" }).some((x) => x.id === m.id));
  const off = M.updateMemory(m.id, { enabled: false, title: "Solid at SQL" });
  assert.equal(off.enabled, false);
  assert.equal(off.title, "Solid at SQL");
  const arch = M.archiveMemory(m.id);
  assert.equal(arch.archived, true);
  assert.ok(!M.listMemory({ agent_id: "dev" }).some((x) => x.id === m.id), "archived memory is hidden by default");
  assert.ok(M.listMemory({ agent_id: "dev", include_archived: true }).some((x) => x.id === m.id), "…but still visible with include_archived (no black box)");
  // archive is REVERSIBLE — restore un-archives + re-enables (no enabled/archived divergence)
  const restored = M.updateMemory(m.id, { archived: false, enabled: true });
  assert.equal(restored.archived, false);
  assert.equal(restored.enabled, true);
  assert.ok(M.listMemory({ agent_id: "dev" }).some((x) => x.id === m.id), "restored memory is visible again");
});

test("feedback becomes VISIBLE memory (the loop) with the right type + source", () => {
  const { feedback, memory } = M.recordFeedback({ agent_id: "dev", feedback_type: "never", comment: "shipped without tests", work_item_id: "wi-1" });
  assert.equal(feedback.feedback_type, "never");
  assert.equal(feedback.rating, -1);
  assert.ok(memory && memory.type === "warning", "a 'never' → a warning memory");
  assert.equal(memory!.source_type, "task"); // work_item_id → task
  assert.equal(memory!.source_ref, "wi-1");
  assert.equal(feedback.memory_id, memory!.id); // linked
  assert.ok(memory!.content?.includes("shipped without tests"), "the comment is captured");
  // the minted memory is visible on the agent
  assert.ok(M.memoryForAgent("dev").some((x) => x.id === memory!.id));
});

test("feedback source maps pr/workflow/decision correctly + rejects unknown types", () => {
  assert.equal(M.recordFeedback({ agent_id: "dev", feedback_type: "smaller_prs", pr: 42 }).memory!.source_type, "pr");
  assert.equal(M.recordFeedback({ agent_id: "dev", feedback_type: "ask_always", workflow_id: "wf-9" }).memory!.source_type, "workflow");
  assert.equal(M.recordFeedback({ agent_id: "dev", feedback_type: "defer_manager", decision_id: "ap-3" }).memory!.source_type, "decision");
  assert.throws(() => M.recordFeedback({ agent_id: "dev", feedback_type: "nonsense" }), (e) => M.memStatusOf(e) === 400);
});

test("memoryForAgent returns only ENABLED items + team scope; warnings/rules are surfaced for safety", () => {
  M.addMemory({ agent_id: "qa", type: "rule", title: "Always run tests", team_id: "team-a" });
  const disabled = M.addMemory({ agent_id: "qa", type: "preference", title: "off pref" });
  M.updateMemory(disabled.id, { enabled: false });
  const forQa = M.memoryForAgent("qa", "team-a");
  assert.ok(forQa.some((x) => x.title === "Always run tests"));
  assert.ok(!forQa.some((x) => x.id === disabled.id), "disabled memory is not in the context set");
  assert.ok(M.memoryWarningsFor("qa").some((x) => x.type === "rule"), "rules surface as safety warnings");
  // team-tagged memory is SHARED across the team; a teammate's non-team memory is NOT
  M.addMemory({ agent_id: "fe", type: "rule", title: "Team uses Postgres", team_id: "team-a" });
  const feOnly = M.addMemory({ agent_id: "fe", type: "rule", title: "fe-only rule" });
  assert.ok(M.memoryForAgent("qa", "team-a").some((x) => x.title === "Team uses Postgres"), "team memory from a teammate is shared");
  assert.ok(!M.memoryForAgent("qa", "team-a").some((x) => x.id === feOnly.id), "a teammate's agent-only memory is NOT shared");
});

test("memoryProfile groups by type for the agent overview", () => {
  const p = M.memoryProfile("dev");
  assert.ok(Array.isArray(p.warning) && Array.isArray(p.rule) && Array.isArray(p.preference));
  assert.ok(p.warning.length >= 1); // from the 'never' feedback above
});

test("content is redacted (no secret persisted)", () => {
  const m = M.addMemory({ agent_id: "dev", title: "note", content: "token gh" + "p_" + "A".repeat(36) });
  assert.ok(!(m.content ?? "").includes("ghp_AAAA"), "a leaked token is redacted out of memory content");
});
