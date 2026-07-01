// Quality Guardrails — optimization must never silently degrade output. Tracks a quality score per
// run (tests/review/security/merge/user feedback), detects repeated failure after optimization, and
// prescribes an escalation ladder: more context → stronger model → plan-only → human approval.
import { recordAudit } from "../db.ts";
import { createApproval } from "../approvals.ts";
import { listUsage, type UsageEvent } from "./ledger.ts";
import { LOW_CONFIDENCE } from "./compressor.ts";
import type { ContextPackage } from "./types.ts";

export interface QualitySignals {
  tests_passed?: boolean | null;
  review_verdict?: "approve" | "caution" | "reject" | null;
  security_verdict?: "approve" | "caution" | "reject" | null;
  pr_merged?: boolean | null;
  user_feedback?: -1 | 0 | 1 | null;
}

/** 0..100 quality score from the available signals (missing signals don't count against). */
export function qualityScore(s: QualitySignals): { score: number; signals: number } {
  let earned = 0;
  let possible = 0;
  const add = (cond: boolean | null | undefined, weight: number, pass: boolean) => {
    if (cond == null) return;
    possible += weight;
    if (pass) earned += weight;
  };
  add(s.tests_passed, 30, s.tests_passed === true);
  if (s.review_verdict != null) {
    possible += 25;
    earned += s.review_verdict === "approve" ? 25 : s.review_verdict === "caution" ? 12 : 0;
  }
  if (s.security_verdict != null) {
    possible += 25;
    earned += s.security_verdict === "approve" ? 25 : s.security_verdict === "caution" ? 12 : 0;
  }
  add(s.pr_merged, 15, s.pr_merged === true);
  if (s.user_feedback != null) {
    possible += 5;
    earned += s.user_feedback > 0 ? 5 : s.user_feedback === 0 ? 2 : 0;
  }
  return { score: possible > 0 ? Math.round((earned / possible) * 100) : 100, signals: possible };
}

/** Was the context too aggressively compressed for the task at hand? */
export function contextTooAggressive(pkg: ContextPackage): { too_aggressive: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (pkg.needs_raw_context) reasons.push("a compression fell below the confidence floor");
  const excludedImportant = pkg.explicit_exclusions.filter((e) => e.kind === "relevant_diffs" || e.kind === "previous_decisions");
  if (excludedImportant.length) reasons.push(`important blocks excluded: ${excludedImportant.map((e) => e.kind).join(", ")}`);
  const compressed = pkg.blocks.filter((b) => b.included && b.compressed);
  const lowConf = compressed.length > 0 && pkg.blocks.filter((b) => b.included).length === compressed.length && pkg.estimated_tokens < pkg.token_budget * 0.3;
  if (lowConf) reasons.push("everything compressed while budget headroom remained");
  return { too_aggressive: reasons.length > 0, reasons };
}

export type Escalation = "none" | "more_context" | "stronger_model" | "plan_only" | "human_approval";

/** Repeated failure after optimization ⇒ climb the ladder. Deterministic from the ledger. */
export function escalationFor(scope: { agent_id?: string | null; work_item_id?: string | null }, windowHours = 24): { level: Escalation; failed_optimized_runs: number; detail: string } {
  const since = new Date(Date.now() - windowHours * 3600_000).toISOString();
  let events: UsageEvent[] = [];
  try {
    events = listUsage({ since, agent_id: scope.agent_id ?? undefined, limit: 500 });
  } catch {
    return { level: "none", failed_optimized_runs: 0, detail: "ledger unavailable" };
  }
  const relevant = scope.work_item_id ? events.filter((e) => e.work_item_id === scope.work_item_id) : events;
  const failedOptimized = relevant.filter((e) => e.result_status === "failed" && (e.compression_used || e.optimization_mode === "economy"));
  const level: Escalation =
    failedOptimized.length >= 4 ? "human_approval" : failedOptimized.length === 3 ? "plan_only" : failedOptimized.length === 2 ? "stronger_model" : failedOptimized.length === 1 ? "more_context" : "none";
  return {
    level,
    failed_optimized_runs: failedOptimized.length,
    detail: failedOptimized.length ? `${failedOptimized.length} failed optimized run(s) in ${windowHours}h → ${level}` : "no failed optimized runs",
  };
}

/** Apply the ladder's top rung: raise a human approval (audited). Lower rungs are caller hints. */
export function escalateToHuman(scope: { agent_id?: string | null; work_item_id?: string | null }, detail: string): string | null {
  try {
    const { approval } = createApproval({
      kind: "escalation",
      summary: `Quality guard: repeated failures after token optimization${scope.agent_id ? ` (agent ${scope.agent_id})` : ""}`,
      risk: "medium",
      advice: `${detail}. Consider high_quality mode, a stronger model, or reviewing the task itself.`,
      action: { type: "noop" },
    });
    recordAudit({ actor: scope.agent_id ?? "system", via: "system", action: "tokens.quality.escalated", detail: detail.slice(0, 200) });
    return approval.id;
  } catch {
    return null;
  }
}

export { LOW_CONFIDENCE };
