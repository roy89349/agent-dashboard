// Run: node --test mission-control/lib/token-optimization.test.ts
// Unit tests for the token-optimization layer: compressor, context-cache, model-router,
// budget-manager, ledger, context-compiler and quality-guard.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Isolate the SQLite db in a temp FLEET_DIR before anything calls db() (it is created lazily once).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "token-opt-"));
fs.mkdirSync(path.join(TMP, "data"), { recursive: true });
process.env.FLEET_DIR = TMP;

const { estimateTokens } = await import("./token-optimization/types.ts");
const { compressLog, compressDiff, storeSummary, LOW_CONFIDENCE } = await import("./token-optimization/compressor.ts");
const { cached, cacheStats, invalidateCache } = await import("./token-optimization/context-cache.ts");
const { routeModel } = await import("./token-optimization/model-router.ts");
const { checkRunBudget, upsertPolicy, deletePolicy, setGlobalMode, getGlobalMode, MODE_DEFAULTS } = await import("./token-optimization/budget-manager.ts");
const { recordUsage, listUsage, usageSummary, eventTokens } = await import("./token-optimization/ledger.ts");
const { compileContext, renderContext } = await import("./token-optimization/context-compiler.ts");
const { qualityScore, escalationFor } = await import("./token-optimization/quality-guard.ts");
const { getApproval } = await import("./approvals.ts");
const { db } = await import("./db.ts");

const GH_SECRET = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5"; // ghp_ + 30 alphanumerics

/** A long, noisy build log with a few important lines buried in the middle. */
function noisyLog(): string {
  const lines: string[] = [];
  for (let i = 0; i < 600; i++) lines.push(`step ${i}: compiled module pkg-${i} in ${i % 97}ms without incident`);
  lines[200] = "ERROR: database connection refused (attempt 7) — will not retry";
  lines[300] = `decision: we will use sqlite for run-state storage token=${GH_SECRET}`;
  lines[400] = "ERROR: schema mismatch on token_usage_events";
  for (let i = 600; i < 640; i++) lines.push(`step ${i}: linking artifact ${i}`);
  return lines.join("\n");
}

// ── 1. compressor ─────────────────────────────────────────────────────────

test("compressLog: reduces tokens on a long noisy log, keeps ERROR + decision lines", () => {
  const raw = noisyLog();
  const res = compressLog(raw, 500);
  assert.ok(res.tokens_after < res.tokens_before, "must actually compress");
  assert.ok(res.compression_ratio < 1);
  assert.ok(res.summary.includes("ERROR: database connection refused"), "ERROR line survives");
  assert.ok(res.summary.includes("ERROR: schema mismatch"), "second ERROR survives");
  assert.ok(res.summary.includes("decision: we will use sqlite"), "decision line survives");
  assert.ok(res.tokens_after <= 500 + 5, "respects the token budget (estimate)");
});

test("compressLog: short input returned unchanged with ratio 1", () => {
  const res = compressLog("just two\nshort lines", 500);
  assert.equal(res.compression_ratio, 1);
  assert.equal(res.summary, "just two\nshort lines");
  assert.equal(res.tokens_before, res.tokens_after);
  assert.equal(res.needs_raw_context, false);
});

test("compressLog: redaction-first — a planted secret NEVER appears in the summary", () => {
  // long path (compressed) — the secret sits on a 'decision' line that is guaranteed to be kept
  const long = compressLog(noisyLog(), 500);
  assert.ok(!long.summary.includes(GH_SECRET), "secret must not survive compression");
  assert.ok(!long.summary.includes("ghp_a1B2"), "no partial leak either");
  // short path (returned 'unchanged') must STILL be redacted
  const short = compressLog(`ok\ntoken is ${GH_SECRET}\ndone`, 500);
  assert.equal(short.compression_ratio, 1);
  assert.ok(!short.summary.includes(GH_SECRET));
  assert.ok(short.summary.includes("«REDACTED"), "redaction marker present");
});

test("compressDiff: keeps file + hunk headers while shrinking a big diff", () => {
  const files: string[] = [];
  for (let f = 0; f < 2; f++) {
    files.push(`diff --git a/src/file${f}.ts b/src/file${f}.ts`, `--- a/src/file${f}.ts`, `+++ b/src/file${f}.ts`, "@@ -1,60 +1,60 @@");
    for (let i = 0; i < 60; i++) files.push(`+  const value_${f}_${i} = computeSomethingVeryLongAndDetailed(${i}); // ${"x".repeat(90)}`);
  }
  const raw = files.join("\n");
  const res = compressDiff(raw, 1500);
  assert.ok(res.tokens_after < res.tokens_before);
  assert.ok(res.summary.includes("diff --git a/src/file0.ts"), "file header kept");
  assert.ok(res.summary.includes("@@ -1,60 +1,60 @@"), "hunk header kept");
});

test("storeSummary: writes a context_summaries row with tokens_before > tokens_after", () => {
  const raw = noisyLog();
  const res = compressLog(raw, 500);
  const id = storeSummary({ source_kind: "log", source_ref: "test-run", raw, result: res });
  const row = db().prepare("SELECT * FROM context_summaries WHERE id = ?").get(id) as {
    source_kind: string; tokens_before: number; tokens_after: number; summary: string;
  };
  assert.ok(row, "row persisted");
  assert.equal(row.source_kind, "log");
  assert.ok(row.tokens_before > row.tokens_after);
  assert.ok(!row.summary.includes(GH_SECRET), "stored summary is redacted");
});

// ── 2. context-cache ──────────────────────────────────────────────────────

test("cached(): miss → compute, hit on same source, recompute on source change", () => {
  let computes = 0;
  const compute = (src: string) => { computes++; return `summary of ${src.length} chars`; };
  const a = cached("analysis", "cache-t1", "source content A", compute);
  assert.equal(a.hit, false);
  assert.equal(computes, 1);
  const b = cached("analysis", "cache-t1", "source content A", compute);
  assert.equal(b.hit, true);
  assert.equal(computes, 1, "second call must NOT recompute");
  assert.equal(b.content, a.content);
  const c = cached("analysis", "cache-t1", "source content CHANGED", compute); // hash invalidation
  assert.equal(c.hit, false);
  assert.equal(computes, 2, "changed source must recompute");
});

test("cached(): a planted secret in cached content is redacted (fresh and from cache)", () => {
  const fresh = cached("analysis", "cache-secret", "src", () => `analysis found key ${GH_SECRET} in env`);
  assert.ok(!fresh.content.includes(GH_SECRET), "fresh compute result redacted");
  const fromCache = cached("analysis", "cache-secret", "src", () => "should not run");
  assert.equal(fromCache.hit, true);
  assert.ok(!fromCache.content.includes(GH_SECRET), "cached copy redacted too");
  const row = db().prepare("SELECT content FROM context_cache WHERE key = ?").get("analysis:cache-secret") as { content: string };
  assert.ok(!row.content.includes(GH_SECRET), "nothing secret ever stored");
});

test("cacheStats counts hits/misses; invalidateCache removes entries", () => {
  const s1 = cacheStats();
  assert.ok(s1.entries >= 2, "entries from the tests above");
  // note: a hash-invalidation DELETEs the row, so hits on the old row are wiped with it —
  // only the cache-secret hit (on a still-valid row) is guaranteed to survive.
  assert.ok(s1.hits >= 1, "the cache-secret hit is counted");
  assert.ok(s1.misses >= 2, "at least the misses above");
  const removed = invalidateCache({ kind: "analysis" });
  assert.ok(removed >= 2, "invalidate returns the number of removed rows");
  let computes = 0;
  const again = cached("analysis", "cache-t1", "source content A", () => { computes++; return "x"; });
  assert.equal(again.hit, false, "after invalidation the same source is a miss again");
  assert.equal(computes, 1);
});

// ── 3. model-router (pure) ────────────────────────────────────────────────

test("router: docs/typo task at low risk → haiku, effort low", () => {
  const d = routeModel({ title: "fix typo in README docs", risk: "low", mode: "balanced" });
  assert.equal(d.selected_model, "haiku");
  assert.equal(d.selected_effort, "low");
  assert.equal(d.selected_depth, "solo");
  assert.equal(d.estimated_cost, "low");
  assert.equal(d.needs_approval, false);
});

test("router: security/architecture at critical risk → opus; approval gated on allow_opus", () => {
  const base = { title: "security review of auth architecture migration", risk: "critical" as const, mode: "balanced" as const };
  const gated = routeModel({ ...base, allow_opus: false });
  assert.equal(gated.selected_model, "opus");
  assert.equal(gated.needs_approval, true, "opus outside policy needs approval");
  const allowed = routeModel({ ...base, allow_opus: true });
  assert.equal(allowed.selected_model, "opus");
  assert.equal(allowed.needs_approval, false, "allow_opus lifts the gate");
});

test("router: economy caps opus→sonnet at low/medium risk, but NOT at high/critical", () => {
  const heavy = { title: "refactor database schema migration for auth", file_count: 10, past_failure_rate: 0.5 };
  const med = routeModel({ ...heavy, risk: "medium", mode: "economy" });
  assert.equal(med.selected_model, "sonnet", "economy caps opus to sonnet on medium risk");
  assert.ok(med.reason.includes("economy mode capped"));
  const high = routeModel({ ...heavy, risk: "high", mode: "economy" });
  assert.equal(high.selected_model, "opus", "economy must NOT cap on high risk");
  const crit = routeModel({ ...heavy, risk: "critical", mode: "economy" });
  assert.equal(crit.selected_model, "opus", "economy must NOT cap on critical risk");
});

test("router: high_quality floors haiku→sonnet (and effort low→medium)", () => {
  const d = routeModel({ title: "fix typo in README docs", risk: "low", mode: "high_quality" });
  assert.equal(d.selected_model, "sonnet");
  assert.equal(d.selected_effort, "medium");
});

// ── 4. budget-manager ─────────────────────────────────────────────────────

test("checkRunBudget: within balanced limits → allowed", () => {
  const d = checkRunBudget({ agent_id: "budget-a1", estimated_tokens: 10_000 });
  assert.equal(d.allowed, true);
  assert.equal(d.mode, "balanced");
  assert.equal(d.needs_approval, false);
  assert.equal(d.approval_id, null);
  assert.equal(d.max_run_tokens, MODE_DEFAULTS.balanced.max_run_tokens);
});

test("checkRunBudget: estimate above the approval threshold → blocked with a REAL approval", () => {
  const est = MODE_DEFAULTS.balanced.approval_threshold_tokens + 50_000;
  const d = checkRunBudget({ agent_id: "budget-a1", estimated_tokens: est });
  assert.equal(d.allowed, false);
  assert.equal(d.needs_approval, true);
  assert.ok(d.approval_id, "approval id returned");
  const a = getApproval(d.approval_id!);
  assert.ok(a, "approval row really exists");
  assert.equal(a!.status, "pending");
  assert.equal(a!.kind, "escalation");
});

test("checkRunBudget: retry_count above max_retries → blocked WITHOUT approval", () => {
  const d = checkRunBudget({ agent_id: "budget-a1", estimated_tokens: 1_000, retry_count: MODE_DEFAULTS.balanced.max_retries + 1 });
  assert.equal(d.allowed, false);
  assert.equal(d.needs_approval, false);
  assert.equal(d.approval_id, null);
  assert.ok(d.reason.includes("max_retries"));
});

test("checkRunBudget: high risk on economy mode is raised to high_quality (with warning)", () => {
  setGlobalMode("economy", "test");
  try {
    const d = checkRunBudget({ agent_id: "budget-a2", estimated_tokens: 1_000, risk: "high" });
    assert.equal(d.mode, "high_quality", "risk floor raises the context policy");
    assert.ok(d.warnings.some((w) => w.includes("high_quality")), "warning explains the raise");
  } finally {
    setGlobalMode("balanced", "test");
  }
  assert.equal(getGlobalMode(), "balanced");
});

test("upsertPolicy: clamps insane values and rejects invalid scopes", () => {
  const p = upsertPolicy({ scope: "agent", scope_id: "clamp-agent", mode: "balanced", max_run_tokens: 999_999_999_999 }, "test");
  assert.ok((p.max_run_tokens ?? 0) <= 2_000_000, "max_run_tokens server-clamped");
  assert.throws(() => upsertPolicy({ scope: "planet" as never, scope_id: "*" }, "test"), /invalid scope/);
  assert.equal(deletePolicy("agent", "clamp-agent", "test"), true);
});

test("setGlobalMode('emergency'): needs approval and does NOT change the active mode", () => {
  const before = getGlobalMode();
  const r = setGlobalMode("emergency", "test");
  assert.equal(r.needs_approval, true);
  assert.ok(r.approval_id, "an approval was raised");
  assert.equal(r.mode, before, "returned mode is still the old one");
  assert.equal(getGlobalMode(), before, "active mode unchanged until approved");
  assert.ok(getApproval(r.approval_id!), "approval row exists");
  assert.throws(() => setGlobalMode("turbo", "test"), /invalid mode/);
});

// ── 5. ledger ─────────────────────────────────────────────────────────────

test("ledger: recordUsage + listUsage round-trip", () => {
  const id = recordUsage({
    agent_id: "ledger-agent",
    model: "sonnet",
    effort: "medium",
    estimated_input_tokens: 4_000,
    estimated_output_tokens: 1_000,
    compression_used: true,
    optimization_mode: "balanced",
    result_status: "ok",
    source: "manual",
    context_blocks: [{ kind: "task_brief", tokens: 40, included: true }],
  });
  const events = listUsage({ agent_id: "ledger-agent" });
  const e = events.find((x) => x.id === id);
  assert.ok(e, "recorded event listed");
  assert.equal(e!.model, "sonnet");
  assert.equal(e!.estimated_input_tokens, 4_000);
  assert.equal(e!.compression_used, true);
  assert.deepEqual(e!.context_blocks, [{ kind: "task_brief", tokens: 40, included: true }]);
});

test("ledger: usageSummary counts failed runs + wasted tokens; cost stays null without actuals", () => {
  const before = usageSummary();
  recordUsage({ agent_id: "ledger-fail", estimated_input_tokens: 5_000, estimated_output_tokens: 500, result_status: "failed" });
  const after = usageSummary();
  assert.equal(after.failed_runs, before.failed_runs + 1);
  assert.equal(after.wasted_tokens_failed, before.wasted_tokens_failed + 5_500);
  // HONESTY RULE: no event today carries a real cost → summary must NOT invent one
  assert.equal(after.actual_cost_usd, null);
});

test("ledger: eventTokens prefers actuals when present, falls back to estimates", () => {
  const idActual = recordUsage({ agent_id: "ledger-actual", estimated_input_tokens: 9_999, actual_input_tokens: 1_200, actual_output_tokens: 300, result_status: "ok" });
  const idEst = recordUsage({ agent_id: "ledger-actual", estimated_input_tokens: 2_000, estimated_output_tokens: 100, result_status: "ok" });
  const events = listUsage({ agent_id: "ledger-actual" });
  const tActual = eventTokens(events.find((e) => e.id === idActual)!);
  assert.deepEqual(tActual, { tokens: 1_500, is_actual: true }, "actuals win over the estimate");
  const tEst = eventTokens(events.find((e) => e.id === idEst)!);
  assert.deepEqual(tEst, { tokens: 2_100, is_actual: false });
});

// ── 6. context-compiler ───────────────────────────────────────────────────

test("compileContext: fits the budget or excludes over-budget blocks with reasons", () => {
  const pkg = compileContext({
    goal: "fix the login redirect bug",
    agent_id: "compiler-a1",
    system_instructions: "You are a backend agent.",
    constraints: ["never touch the auth secrets"],
    raw_log_tail: noisyLog(),
    raw_diff: "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new",
  });
  assert.ok(pkg.token_budget > 0);
  const included = pkg.blocks.filter((b) => b.included);
  const fits = pkg.estimated_tokens <= pkg.token_budget;
  assert.ok(fits || pkg.explicit_exclusions.length > 0, "either fits or something was explicitly excluded");
  for (const ex of pkg.explicit_exclusions) assert.ok(ex.reason.length > 0, "every exclusion carries a reason");
  assert.ok(included.some((b) => b.kind === "logs_summary"), "log summary included");
  assert.ok(!renderContext(pkg).includes(GH_SECRET), "secret from the log never reaches the prompt");
  assert.equal(pkg.fallback, "ok");
});

test("compileContext: identical content fed twice is deduped (one excluded as duplicate)", () => {
  const same = "export const answer = 42; // shared content\n".repeat(20);
  const pkg = compileContext({
    goal: "review the shared module",
    relevant_files: [
      { path: "src/copy-one.ts", content: same },
      { path: "src/copy-two.ts", content: same },
    ],
  });
  const fileBlocks = pkg.blocks.filter((b) => b.kind === "relevant_files");
  assert.equal(fileBlocks.length, 2, "both candidates reported");
  const dupes = fileBlocks.filter((b) => !b.included && b.reason.startsWith("duplicate"));
  assert.equal(dupes.length, 1, "exactly one excluded as duplicate");
  assert.ok(pkg.explicit_exclusions.some((e) => e.reason.startsWith("duplicate")));
});

test("compileContext: high risk keeps the diff even when it blows a tiny context budget", () => {
  upsertPolicy({ scope: "agent", scope_id: "tiny-ctx-agent", mode: "high_quality", max_context_tokens: 400 }, "test");
  try {
    const lines = ["diff --git a/big.ts b/big.ts", "--- a/big.ts", "+++ b/big.ts", "@@ -1,200 +1,200 @@"];
    for (let i = 0; i < 200; i++) lines.push(`+ const bigChange${i} = doSomethingImportantForSecurity(${i}); // ${"y".repeat(60)}`);
    const pkg = compileContext({ goal: "review this risky change", agent_id: "tiny-ctx-agent", risk: "high", raw_diff: lines.join("\n") });
    const diff = pkg.blocks.find((b) => b.kind === "relevant_diffs");
    assert.ok(diff, "diff block present");
    assert.equal(diff!.included, true, "high risk forces the diff in");
    assert.ok(diff!.tokens > pkg.token_budget, "sanity: the diff alone exceeds the tiny budget");
    assert.ok(diff!.reason.includes("required at this risk level"), "reason explains the override");
  } finally {
    deletePolicy("agent", "tiny-ctx-agent", "test");
  }
});

test("renderContext: contains included blocks only", () => {
  const same = "const shared = true; // duplicated block content\n".repeat(15);
  const pkg = compileContext({
    goal: "render test",
    system_instructions: "SYS-MARKER",
    relevant_files: [
      { path: "keep.ts", content: same },
      { path: "drop.ts", content: same },
    ],
  });
  const out = renderContext(pkg);
  assert.ok(out.includes("SYS-MARKER"));
  for (const b of pkg.blocks) {
    if (b.included) assert.ok(out.includes(`## ${b.title}`), `included block "${b.title}" rendered`);
    else assert.ok(!out.includes(`## ${b.title}`), `excluded block "${b.title}" NOT rendered`);
  }
});

// ── 7. quality-guard ──────────────────────────────────────────────────────

test("qualityScore: full pass = 100; a review reject drops it; no signals = 100", () => {
  const full = qualityScore({ tests_passed: true, review_verdict: "approve", security_verdict: "approve", pr_merged: true, user_feedback: 1 });
  assert.equal(full.score, 100);
  assert.equal(full.signals, 100);
  const rejected = qualityScore({ tests_passed: true, review_verdict: "reject", security_verdict: "approve", pr_merged: true, user_feedback: 1 });
  assert.ok(rejected.score < full.score, "reject lowers the score");
  assert.equal(rejected.score, 75);
  assert.equal(qualityScore({}).score, 100, "missing signals never count against");
});

test("escalationFor: none → more_context → stronger_model as failed optimized runs accumulate", () => {
  const scope = { work_item_id: "wi-quality-guard" };
  assert.equal(escalationFor(scope).level, "none", "empty ledger for this work item");
  recordUsage({ agent_id: "qg-agent", work_item_id: "wi-quality-guard", result_status: "failed", compression_used: true, estimated_input_tokens: 800 });
  const one = escalationFor(scope);
  assert.equal(one.level, "more_context");
  assert.equal(one.failed_optimized_runs, 1);
  recordUsage({ agent_id: "qg-agent", work_item_id: "wi-quality-guard", result_status: "failed", compression_used: true, estimated_input_tokens: 800 });
  const two = escalationFor(scope);
  assert.equal(two.level, "stronger_model");
  assert.equal(two.failed_optimized_runs, 2);
});

test("compressor exposes the LOW_CONFIDENCE floor used by needs_raw_context", () => {
  assert.equal(typeof LOW_CONFIDENCE, "number");
  assert.ok(LOW_CONFIDENCE > 0 && LOW_CONFIDENCE < 1);
  assert.equal(estimateTokens("abcd"), 1, "chars/4 heuristic");
});
