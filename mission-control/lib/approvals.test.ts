// Run: node --test mission-control/lib/approvals.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Isolate the SQLite db in a temp FLEET_DIR before anything calls db() (it is created lazily once).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "approvals-"));
fs.mkdirSync(path.join(TMP, "data"), { recursive: true });
process.env.FLEET_DIR = TMP;

const {
  createApproval, decideApproval, getApproval, listPendingApprovals, expireApprovals,
  verifyDecisionToken, hashToken, mintDecisionToken, approvalErrorStatus,
} = await import("./approvals.ts");

test("createApproval: pending + hashed single-use token + redacted summary", () => {
  const { approval, token } = createApproval({
    kind: "merge",
    summary: "merge PR with a leaked key github_pat_abcdefghij1234567890XYZ",
    pr: 12,
    action: { type: "merge", pr: 12 },
  });
  assert.equal(approval.status, "pending");
  assert.ok(!approval.summary.includes("github_pat_"), "secret must be redacted in stored summary");
  assert.ok(approval.summary.includes("«REDACTED"));
  // token is returned raw but stored only as a hash
  assert.equal(approval.decision_token_hash, hashToken(token));
  assert.ok(verifyDecisionToken(approval.id, token));
  assert.ok(!verifyDecisionToken(approval.id, "wrong"));
});

test("approve via token, then idempotent + token consumed", () => {
  const { approval, token } = createApproval({ kind: "cap_increase", summary: "raise workers to 3", action: { type: "cap_increase", max_workers: 3 } });
  const d = decideApproval(approval.id, "approve", { via: "phone", by: "123", token });
  assert.equal(d.status, "approved");
  assert.equal(d.decided_via, "phone");
  // repeated SAME decision is idempotent (no throw), token now consumed
  const again = decideApproval(approval.id, "approve", { via: "phone", by: "123", trusted: true });
  assert.equal(again.status, "approved");
  assert.ok(!verifyDecisionToken(approval.id, token), "token must be single-use");
});

test("reject sets status + reason", () => {
  const { approval, token } = createApproval({ kind: "deploy", summary: "deploy to prod" });
  const d = decideApproval(approval.id, "reject", { via: "telegram", by: "123", token, reason: "not now" });
  assert.equal(d.status, "rejected");
  assert.equal(d.reason, "not now");
});

test("conflict: approving an already-rejected approval → 409", () => {
  const { approval } = createApproval({ kind: "risky_action", summary: "x" });
  decideApproval(approval.id, "reject", { via: "dashboard", by: "dash", trusted: true });
  assert.throws(
    () => decideApproval(approval.id, "approve", { via: "dashboard", by: "dash", trusted: true }),
    (e: unknown) => approvalErrorStatus(e) === 409,
  );
});

test("invalid / missing token rejected (403) when not trusted", () => {
  const { approval } = createApproval({ kind: "secret_access", summary: "read a secret" });
  assert.throws(
    () => decideApproval(approval.id, "approve", { via: "api", by: "x", token: "nope" }),
    (e: unknown) => approvalErrorStatus(e) === 403,
  );
  assert.throws(
    () => decideApproval(approval.id, "approve", { via: "api", by: "x" }),
    (e: unknown) => approvalErrorStatus(e) === 403,
  );
});

test("expired approval → 410 and not pending", () => {
  const { approval, token } = createApproval({ kind: "plan_signoff", summary: "old", ttlMs: -1000 });
  assert.equal(getApproval(approval.id)!.status, "expired");
  assert.throws(
    () => decideApproval(approval.id, "approve", { via: "phone", by: "1", token }),
    (e: unknown) => approvalErrorStatus(e) === 410,
  );
});

test("listPendingApprovals excludes expired; expireApprovals counts", () => {
  createApproval({ kind: "prompt_confirm", summary: "fresh pending one" });
  createApproval({ kind: "prompt_confirm", summary: "stale one", ttlMs: -1 });
  const expired = expireApprovals();
  assert.ok(expired >= 1);
  assert.ok(listPendingApprovals().every((a) => a.status === "pending"));
});

test("tokens are random + hashed (never plaintext storable)", () => {
  const t1 = mintDecisionToken();
  const t2 = mintDecisionToken();
  assert.notEqual(t1, t2);
  assert.equal(hashToken(t1).length, 64); // sha256 hex
  assert.notEqual(hashToken(t1), t1);
});
