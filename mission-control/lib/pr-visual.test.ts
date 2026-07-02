// Run: node --test mission-control/lib/pr-visual.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Isolate the SQLite db + screenshots in a temp FLEET_DIR before anything calls db() (created lazily once).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pr-visual-"));
fs.mkdirSync(path.join(TMP, "data"), { recursive: true });
process.env.FLEET_DIR = TMP;

const {
  MAX_SCREENSHOT_BYTES, parsePrNumber, parseFileList, screenshotTooLarge, saveScreenshot,
  screenshotPath, screenshotExists, riskForPr, buildDiffPreview, ensureMergeApproval, photoCaption,
} = await import("./pr-visual.ts");
const { listPendingApprovals, decideApproval } = await import("./approvals.ts");

test("riskForPr: auth-touching file list escalates to high/critical", () => {
  const auth = riskForPr(7, ["lib/session.ts", "components/task-card.tsx"]);
  assert.equal(auth.risk, "critical");
  assert.ok(auth.categories.includes("auth_security"));
  const secret = riskForPr(8, [".env.production"]);
  assert.equal(secret.risk, "critical");
  // a diff-blind PR (no file list) must fail closed to at least high
  const blind = riskForPr(9, []);
  assert.ok(["high", "critical"].includes(blind.risk));
  // a plain benign diff stays at the merge baseline (medium)
  const benign = riskForPr(10, ["components/task-card.tsx", "docs/readme-notes.txt"]);
  assert.equal(benign.risk, "medium");
});

test("ensureMergeApproval: one deduped pending approval per PR", () => {
  const input = { pr: 41, issue: 12, title: "Add board filter", verdict: "approve", diffstat: "1 file changed", files: ["components/board.tsx"] };
  const first = ensureMergeApproval(input);
  assert.equal(first.created, true);
  assert.equal(first.approval.kind, "merge");
  assert.equal(first.approval.pr, 41);
  assert.ok(first.approval.summary.includes("Merge PR #41"));
  assert.ok(first.approval.summary.includes("Add board filter"));
  const action = JSON.parse(first.approval.action_json ?? "{}");
  assert.equal(action.type, "merge");
  assert.equal(action.pr, 41);

  // second call (worker retry) reuses the pending approval — no duplicate card
  const second = ensureMergeApproval(input);
  assert.equal(second.created, false);
  assert.equal(second.approval.id, first.approval.id);
  assert.equal(listPendingApprovals().filter((a) => a.kind === "merge" && a.pr === 41).length, 1);

  // a DIFFERENT PR gets its own approval
  const other = ensureMergeApproval({ ...input, pr: 42 });
  assert.equal(other.created, true);
  assert.notEqual(other.approval.id, first.approval.id);

  // once decided, the next POST for that PR creates a FRESH approval (only PENDING dedupes)
  decideApproval(first.approval.id, "reject", { via: "dashboard", by: "test", trusted: true });
  const third = ensureMergeApproval(input);
  assert.equal(third.created, true);
  assert.notEqual(third.approval.id, first.approval.id);
});

test("screenshot size guard + save with tight permissions + overwrite", () => {
  assert.equal(screenshotTooLarge(1), false);
  assert.equal(screenshotTooLarge(MAX_SCREENSHOT_BYTES), false);
  assert.equal(screenshotTooLarge(MAX_SCREENSHOT_BYTES + 1), true);
  assert.equal(screenshotTooLarge(0), true);
  assert.throws(() => saveScreenshot(5, Buffer.alloc(MAX_SCREENSHOT_BYTES + 1)));

  const file = saveScreenshot(5, Buffer.from("PNG-bytes-1"));
  assert.equal(file, screenshotPath(5));
  assert.ok(screenshotExists(5));
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
  // overwrite on re-POST
  saveScreenshot(5, Buffer.from("PNG-bytes-2-longer"));
  assert.equal(fs.readFileSync(file, "utf8"), "PNG-bytes-2-longer");
});

test("screenshotPath: only plain positive ints (no path traversal)", () => {
  assert.throws(() => screenshotPath(-1));
  assert.throws(() => screenshotPath(1.5));
  assert.equal(parsePrNumber("41"), 41);
  assert.equal(parsePrNumber("../etc"), null);
  assert.equal(parsePrNumber("1e3"), null);
  assert.equal(parsePrNumber(""), null);
  assert.equal(parsePrNumber("0"), null);
});

test("buildDiffPreview: planted secret is redacted + preview clamped", () => {
  const diff = [
    "diff --git a/lib/x.ts b/lib/x.ts",
    "+const t = 'github_pat_abcdefghij1234567890XYZ'",
    "+const k = 'sk-ant-abc123def456ghi789'",
    ...Array.from({ length: 300 }, (_, i) => `+line of ordinary change number ${i}`),
  ].join("\n");
  const preview = buildDiffPreview(diff)!;
  assert.ok(!preview.includes("github_pat_abcdefghij"), "github PAT must be redacted");
  assert.ok(!preview.includes("sk-ant-abc123"), "anthropic key must be redacted");
  assert.ok(preview.includes("«REDACTED"));
  assert.ok(preview.length <= 1000, `preview too long: ${preview.length}`);
  assert.equal(buildDiffPreview(""), null);
  assert.equal(buildDiffPreview(null), null);
});

test("ensureMergeApproval: secret in diffstat never lands in diff_preview", () => {
  const r = ensureMergeApproval({
    pr: 77, issue: null, title: "x", verdict: null,
    diffstat: "+++ b/a.ts\n+token = github_pat_abcdefghij1234567890XYZ", files: ["a.ts"],
  });
  assert.ok(r.approval.diff_preview);
  assert.ok(!r.approval.diff_preview!.includes("github_pat_abcdefghij"));
});

test("parseFileList + photoCaption escapes dynamic values", () => {
  assert.deepEqual(parseFileList(" a.ts \n\n b/c.tsx \n"), ["a.ts", "b/c.tsx"]);
  const cap = photoCaption({ pr: 3, issue: 2, title: "<b>evil & title</b>", verdict: "approve", diffstat: null, files: [] }, "high");
  assert.ok(cap.includes("&lt;b&gt;evil &amp; title&lt;/b&gt;"));
  assert.ok(cap.includes("PR #3"));
  assert.ok(cap.includes("high"));
});
