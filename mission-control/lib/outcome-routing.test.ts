// Run: node --test mission-control/lib/token-optimization/outcome-routing.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Isolate the SQLite db in a temp FLEET_DIR before anything calls db() (created lazily once).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "outcome-routing-"));
fs.mkdirSync(path.join(TMP, "data"), { recursive: true });
process.env.FLEET_DIR = TMP;

const { recordUsage } = await import("./token-optimization/ledger.ts");
const { routeModel } = await import("./token-optimization/model-router.ts");
const { applyOutcomeRouting, agentModelStats, downgradeCandidates, outcomeRoute } = await import("./token-optimization/outcome-routing.ts");
import type { AgentModelStat } from "./token-optimization/outcome-routing.ts";

const stat = (agent_id: string, model: string, ok: number, failed: number, tokens = 1000): AgentModelStat => ({
  agent_id,
  model,
  runs: ok + failed,
  ok,
  failed,
  ok_rate: ok + failed >= 5 ? ok / (ok + failed) : null,
  tokens,
});

test("downgrade: proven cheaper rung wins the work on low risk", () => {
  const base = routeModel({ title: "add a settings feature", risk: "low", mode: "balanced" });
  assert.equal(base.selected_model, "sonnet");
  const d = applyOutcomeRouting(base, { risk: "low", mode: "balanced", agent_id: "a1" }, [stat("a1", "haiku", 10, 0)]);
  assert.equal(d.selected_model, "haiku");
  assert.equal(d.outcome_applied, true);
  assert.match(d.reason, /downgrade/);
  assert.equal(d.estimated_cost, "low");
});

test("no downgrade on high/critical risk or in high_quality mode", () => {
  const stats = [stat("a1", "haiku", 10, 0)];
  const baseHigh = routeModel({ title: "fix bug", risk: "high", mode: "balanced" });
  assert.equal(applyOutcomeRouting(baseHigh, { risk: "high", mode: "balanced", agent_id: "a1" }, stats).selected_model, baseHigh.selected_model);
  const baseHQ = routeModel({ title: "fix bug", risk: "low", mode: "high_quality" });
  assert.equal(applyOutcomeRouting(baseHQ, { risk: "low", mode: "high_quality", agent_id: "a1" }, stats).selected_model, baseHQ.selected_model);
});

test("no downgrade when the cheaper rung is unproven (too few runs) or another agent's history", () => {
  const base = routeModel({ title: "add a feature", risk: "low", mode: "balanced" });
  // 4 runs < MIN_RUNS_FOR_CONFIDENCE → ok_rate null → no evidence
  assert.equal(applyOutcomeRouting(base, { risk: "low", mode: "balanced", agent_id: "a1" }, [stat("a1", "haiku", 4, 0)]).selected_model, "sonnet");
  // strong history, wrong agent → not evidence for a1
  assert.equal(applyOutcomeRouting(base, { risk: "low", mode: "balanced", agent_id: "a1" }, [stat("other", "haiku", 10, 0)]).selected_model, "sonnet");
});

test("upgrade: a provably failing rung climbs one rung (opus needs approval outside policy)", () => {
  const base = routeModel({ title: "add a feature", risk: "low", mode: "balanced" });
  const d = applyOutcomeRouting(base, { risk: "low", mode: "balanced", agent_id: "a1" }, [stat("a1", "sonnet", 2, 4)]);
  assert.equal(d.selected_model, "opus");
  assert.equal(d.needs_approval, true); // no allow_opus
  assert.match(d.reason, /stronger model/);
});

test("upgrade: quality-guard 'stronger_model' escalation bumps the rung even without stats", () => {
  const base = routeModel({ title: "add a feature", risk: "low", mode: "balanced" });
  const d = applyOutcomeRouting(base, { risk: "low", mode: "balanced", agent_id: "a1" }, [], "stronger_model");
  assert.equal(d.selected_model, "opus");
  assert.match(d.reason, /quality-guard/);
});

test("no history → decision unchanged, outcome_applied false", () => {
  const base = routeModel({ title: "add a feature", risk: "low", mode: "balanced" });
  const d = applyOutcomeRouting(base, { risk: "low", mode: "balanced", agent_id: "a1" }, []);
  assert.equal(d.selected_model, base.selected_model);
  assert.equal(d.outcome_applied, false);
  assert.equal(d.reason, base.reason);
});

test("agentModelStats + downgradeCandidates + outcomeRoute from a seeded ledger", () => {
  for (let i = 0; i < 6; i++)
    recordUsage({ agent_id: "stat-a", model: "haiku", estimated_input_tokens: 1000, result_status: "ok", source: "manual" });
  for (let i = 0; i < 3; i++)
    recordUsage({ agent_id: "stat-a", model: "sonnet", estimated_input_tokens: 50_000, result_status: "ok", source: "manual" });
  recordUsage({ agent_id: "stat-a", model: "sonnet", estimated_input_tokens: 50_000, result_status: "blocked", source: "manual" }); // blocked ⇒ no quality signal

  const stats = agentModelStats(undefined, "stat-a");
  const haiku = stats.find((s) => s.model === "haiku");
  assert.equal(haiku?.runs, 6);
  assert.equal(haiku?.ok_rate, 1);
  const sonnet = stats.find((s) => s.model === "sonnet");
  assert.equal(sonnet?.runs, 3); // the blocked run doesn't count as a decided outcome
  assert.equal(sonnet?.ok_rate, null); // below the confidence floor

  const cand = downgradeCandidates().find((c) => c.agent_id === "stat-a");
  assert.ok(cand, "expected a downgrade candidate for stat-a");
  assert.equal(cand?.from, "sonnet");
  assert.equal(cand?.to, "haiku");

  const r = outcomeRoute({ title: "add a feature", risk: "low", mode: "balanced", agent_id: "stat-a" });
  assert.equal(r.selected_model, "haiku"); // ledger-proven downgrade applied end-to-end
  assert.equal(r.outcome_applied, true);
});
