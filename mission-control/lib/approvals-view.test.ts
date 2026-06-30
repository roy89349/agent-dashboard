// Run: node --test --experimental-sqlite mission-control/lib/approvals-view.test.ts
// Covers the Decision Inbox: render mapping, the approve/reject flow (same decideApproval() the phone
// uses), and the expired-approval state. The view-model is pure; the flow uses the real approvals lib
// against an isolated temp SQLite db.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Isolate the db BEFORE the lazy db() runs (same pattern as approvals.test.ts).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "approvals-view-"));
fs.mkdirSync(path.join(TMP, "data"), { recursive: true });
process.env.FLEET_DIR = TMP;

const {
  approvalView, riskLevel, kindLabel, targetLabel, statusBadge, isExpired, expiresIn, decidedViaLabel,
} = await import("./approvals-view.ts");
const { createApproval, decideApproval, listPendingApprovals, publicApproval } = await import("./approvals.ts");

const NOW = Date.parse("2026-06-30T12:00:00.000Z");

// ── render mapping ──
test("render: maps a pending merge row to the fields the card needs", () => {
  const a = {
    id: "abc", kind: "merge", work_item_id: null, issue: 7, pr: 12, agent_id: "qa",
    requested_by_agent_id: null, summary: "Merge the dark-mode PR", diff_preview: "+ added\n- removed",
    risk: "low — docs only", advice: "looks safe", action_json: null, status: "pending",
    decided_by: null, decided_via: null, decided_at: null, reason: null,
    expires_at: new Date(NOW + 4 * 3600_000).toISOString(), notification_ids_json: null,
    created_at: new Date(NOW - 5 * 60_000).toISOString(),
  };
  const v = approvalView(a as never, NOW);
  assert.equal(v.kindLabel, "Merge PR");
  assert.equal(v.target, "PR #12"); // PR wins over issue
  assert.equal(v.agent, "qa");
  assert.equal(v.risk, "low");
  assert.equal(v.riskTone, "emerald");
  assert.equal(v.statusLabel, "Pending");
  assert.equal(v.pending, true);
  assert.equal(v.expired, false);
  assert.equal(v.createdLabel, "5m ago");
  assert.equal(v.expiresLabel, "in 4h");
  assert.equal(v.hasTarget, true);
});

test("render: helpers classify risk, target, status, via", () => {
  assert.equal(kindLabel("prompt_confirm"), "Make a task?");
  assert.equal(riskLevel({ kind: "deploy" }), "high"); // kind-based default
  assert.equal(riskLevel({ kind: "merge", risk: "could force-push to prod" }), "high"); // text wins
  assert.equal(riskLevel({ kind: "prompt_confirm" }), "none");
  assert.equal(targetLabel({ issue: 5 }), "issue #5");
  assert.equal(targetLabel({ work_item_id: "wi-9" }), "wi-9");
  assert.equal(statusBadge("approved").tone, "emerald");
  assert.equal(decidedViaLabel("telegram"), "Telegram");
  assert.equal(decidedViaLabel("dashboard"), "Dashboard");
});

// ── approve / reject flow (same server path as the phone) ──
test("approve flow: row leaves pending and records dashboard decision", () => {
  const { approval } = createApproval({ kind: "cap_increase", summary: "raise workers to 3", action: { type: "cap_increase", max_workers: 3 } });
  assert.ok(listPendingApprovals().some((p) => p.id === approval.id), "starts pending");
  const decided = decideApproval(approval.id, "approve", { via: "dashboard", by: "dashboard", trusted: true });
  assert.equal(decided.status, "approved");
  assert.equal(decided.decided_via, "dashboard");
  const v = approvalView(publicApproval(decided));
  assert.equal(v.statusLabel, "Approved");
  assert.equal(v.pending, false);
  assert.ok(!listPendingApprovals().some((p) => p.id === approval.id), "removed from pending");
});

test("reject flow: row leaves pending as rejected with reason", () => {
  const { approval } = createApproval({ kind: "risky_action", summary: "stop the fleet" });
  const decided = decideApproval(approval.id, "reject", { via: "dashboard", by: "dashboard", trusted: true, reason: "not now" });
  assert.equal(decided.status, "rejected");
  assert.equal(decided.reason, "not now");
  const v = approvalView(publicApproval(decided));
  assert.equal(v.statusTone, "red");
  assert.ok(!listPendingApprovals().some((p) => p.id === approval.id));
});

// ── expired state ──
test("expired: a past-ttl pending row reads as expired and is not actionable", async () => {
  const { approval } = createApproval({ kind: "merge", summary: "stale merge", pr: 99, ttlMs: 5 });
  // pure view: jumping past the ttl marks it expired even before the DB lazily flips it
  const future = Date.parse(approval.created_at) + 60_000;
  assert.equal(isExpired(approval, future), true);
  assert.equal(expiresIn(approval, future), "expired");
  const v = approvalView(publicApproval(approval), future);
  assert.equal(v.status, "expired");
  assert.equal(v.pending, false);
  assert.equal(v.statusLabel, "Expired");
  // let real wall-clock pass the 5ms ttl, then the server refuses to decide it (410 → throws /expired/)
  await new Promise((r) => setTimeout(r, 30));
  assert.throws(() => decideApproval(approval.id, "approve", { via: "dashboard", by: "dashboard", trusted: true }), /expired/);
});
