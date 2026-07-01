// Optimization Recommendations — deterministic rules over the ledger + cache + compression stats.
// A recommendation NEVER self-applies: apply/dismiss are explicit, authenticated actions (and even
// "apply" only flips policy through the validated budget-manager — project files can't write policy).
import { randomUUID } from "node:crypto";
import { db, recordAudit } from "../db.ts";
import { redact } from "../redact.ts";
import { usageSummary, efficiencyMetrics } from "./ledger.ts";
import { cacheStats } from "./context-cache.ts";
import { compressionStats } from "./compressor.ts";
import { listPolicies, upsertPolicy } from "./budget-manager.ts";

export interface Recommendation {
  id: string;
  rule: string;
  title: string;
  detail: string | null;
  impact: string | null;
  status: "open" | "applied" | "dismissed";
  created_at: string;
  updated_at: string;
}

const upsert = (rule: string, title: string, detail: string, impact: string) => {
  const now = new Date().toISOString();
  const existing = db().prepare("SELECT id, status FROM optimization_recommendations WHERE rule = ? AND status = 'open'").get(rule) as { id: string } | undefined;
  if (existing) {
    db().prepare("UPDATE optimization_recommendations SET title=?, detail=?, impact=?, updated_at=? WHERE id=?").run(redact(title).slice(0, 200), redact(detail).slice(0, 500), impact.slice(0, 120), now, existing.id);
    return existing.id;
  }
  const id = randomUUID();
  db()
    .prepare("INSERT INTO optimization_recommendations (id, rule, title, detail, impact, status, created_at, updated_at) VALUES (?,?,?,?,?,'open',?,?)")
    .run(id, rule, redact(title).slice(0, 200), redact(detail).slice(0, 500), impact.slice(0, 120), now, now);
  return id;
};

/** Scan the last 7 days and (re)generate rule-based recommendations. Idempotent per rule. */
export function generateRecommendations(): Recommendation[] {
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();
  const sum = usageSummary(since);
  const eff = efficiencyMetrics(since);
  const cache = cacheStats();
  const comp = compressionStats(since);
  const policies = listPolicies();

  // 1. token waste through failed runs
  const bestKnown = Math.max(sum.actual_tokens, sum.est_tokens);
  if (sum.failed_runs >= 3 && bestKnown > 0 && sum.wasted_tokens_failed / bestKnown > 0.2) {
    upsert(
      "waste.failed_runs",
      `${Math.round((sum.wasted_tokens_failed / bestKnown) * 100)}% of tokens went to failed runs`,
      `${sum.failed_runs} failed runs burned ~${sum.wasted_tokens_failed.toLocaleString()} tokens (best-known) in 7 days. Lower max_retries, or let the quality guard escalate to a stronger model sooner instead of retrying cheap.`,
      `~${sum.wasted_tokens_failed.toLocaleString()} tokens / 7d`,
    );
  }
  // 2. heavy agents without a policy
  for (const a of sum.by_agent.slice(0, 3)) {
    if (a.tokens > 100_000 && !policies.some((p) => p.scope === "agent" && p.scope_id === a.key)) {
      upsert(
        `policy.agent.${a.key}`,
        `Agent "${a.key}" is a top spender without a budget policy`,
        `~${a.tokens.toLocaleString()} tokens over ${a.runs} runs in 7 days with no per-agent policy. Add an agent policy (balanced or economy) so its context/run ceilings are explicit.`,
        `top-3 spender`,
      );
    }
  }
  // 3. low cache hit rate
  if (cache.hit_rate != null && cache.hits + cache.misses >= 20 && cache.hit_rate < 30) {
    upsert(
      "cache.low_hit_rate",
      `Context cache hit rate is low (${cache.hit_rate}%)`,
      "Summaries are being recomputed instead of reused. Pre-index knowledge summaries and keep file summaries keyed by content hash so repeated reads become hits.",
      "recompute cost on every run",
    );
  }
  // 4. compression frequently low-confidence
  if (comp.count >= 10 && comp.low_confidence / comp.count > 0.3) {
    upsert(
      "compression.low_confidence",
      `${Math.round((comp.low_confidence / comp.count) * 100)}% of compressions are low-confidence`,
      "Aggressive compression is flagging 'needs raw context' often — raise the target token budgets for those sources or send raw context for the affected kinds.",
      "quality risk",
    );
  }
  // 5. retries dominating a workflow
  for (const w of sum.by_workflow.slice(0, 3)) {
    if (w.runs >= 5 && w.failed / w.runs > 0.4) {
      upsert(
        `workflow.retry_waste.${w.key}`,
        `Workflow ${w.key.slice(0, 8)}… loses ${Math.round((w.failed / w.runs) * 100)}% of runs to failures`,
        `~${w.tokens.toLocaleString()} tokens across ${w.runs} runs with ${w.failed} failures. Review the failing step; consider a stronger model for that step instead of repeated cheap retries.`,
        `~${w.tokens.toLocaleString()} tokens / 7d`,
      );
    }
  }
  // 6. everything estimated — wire real usage
  if (sum.runs >= 10 && sum.runs_with_actuals === 0) {
    upsert(
      "ledger.no_actuals",
      "No real token usage is being captured",
      "All ledger rows are estimates. Wire the worker pipeline to capture the CLI's result JSON (cost/turns) so savings and budgets run on real numbers.",
      "accuracy",
    );
  }
  if (eff.tokens_per_failed_run != null && eff.tokens_per_ok_run != null && eff.tokens_per_failed_run > eff.tokens_per_ok_run * 1.5) {
    upsert(
      "waste.failed_heavier",
      "Failed runs are heavier than successful ones",
      `A failed run averages ~${eff.tokens_per_failed_run.toLocaleString()} tokens vs ~${eff.tokens_per_ok_run.toLocaleString()} for a success — failures burn the most context. Fail fast: lower retry ceilings and escalate model instead.`,
      "retry policy",
    );
  }
  return listRecommendations();
}

export function listRecommendations(status?: "open" | "applied" | "dismissed"): Recommendation[] {
  const sql = status
    ? "SELECT * FROM optimization_recommendations WHERE status = ? ORDER BY updated_at DESC LIMIT 100"
    : "SELECT * FROM optimization_recommendations ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, updated_at DESC LIMIT 100";
  return (status ? db().prepare(sql).all(status) : db().prepare(sql).all()) as unknown as Recommendation[];
}

/** Mark applied/dismissed. For policy.agent.* rules, "apply" also writes a balanced agent policy
 *  through the validated budget-manager (server-side clamped). */
export function setRecommendationStatus(id: string, status: "applied" | "dismissed", actor: string): Recommendation | null {
  const row = db().prepare("SELECT * FROM optimization_recommendations WHERE id = ?").get(id) as unknown as Recommendation | undefined;
  if (!row) return null;
  if (status === "applied" && row.rule.startsWith("policy.agent.")) {
    const agentId = row.rule.slice("policy.agent.".length);
    if (agentId) upsertPolicy({ scope: "agent", scope_id: agentId, mode: "balanced" }, actor);
  }
  db().prepare("UPDATE optimization_recommendations SET status = ?, updated_at = ? WHERE id = ?").run(status, new Date().toISOString(), id);
  recordAudit({ actor, via: "dashboard", action: `tokens.recommendation.${status}`, detail: row.rule.slice(0, 120) });
  return db().prepare("SELECT * FROM optimization_recommendations WHERE id = ?").get(id) as unknown as Recommendation;
}
