// Model Router — pure decision function (unit-testable, no I/O). Smarter than "auto": weighs task
// complexity, risk, size, history and budget mode. Callers audit the decision; opus outside policy
// needs an approval (the caller enforces via budget-manager/permissions — this only decides).
import type { OptimizationMode, RouteDecision } from "./types.ts";

export interface RouteInput {
  title?: string;
  description?: string;
  risk?: "low" | "medium" | "high" | "critical";
  required_skills?: string[];
  file_count?: number | null;
  diff_size_chars?: number | null;
  past_failure_rate?: number | null; // 0..1 for this agent/task type
  autonomy?: "suggest" | "review" | "auto" | "full" | null;
  mode?: OptimizationMode;
  urgency?: "low" | "normal" | "high";
  allow_opus?: boolean; // ALLOW_GLOBAL_OPUS-style gate, resolved by the caller
}

const SIMPLE_RE = /\b(typo|readme|docs?|documentation|comment|rename|copy|text|label|wording|format|changelog|status|badge)\b/i;
const COMPLEX_RE = /\b(refactor|architec|migrat|schema|database|db|auth|security|payment|billing|deploy|infra|race|concurren|debug|memory leak|perf|encryption|multi-file|breaking)\b/i;

/** 0..10 complexity score from the available signals. Deterministic + explainable. */
export function complexityScore(i: RouteInput): { score: number; signals: string[] } {
  const text = `${i.title ?? ""} ${i.description ?? ""}`;
  const signals: string[] = [];
  let s = 3; // neutral baseline
  if (SIMPLE_RE.test(text)) {
    s -= 2;
    signals.push("simple keywords");
  }
  if (COMPLEX_RE.test(text)) {
    s += 3;
    signals.push("complex keywords");
  }
  if ((i.file_count ?? 0) > 5) {
    s += 2;
    signals.push(`${i.file_count} files`);
  } else if ((i.file_count ?? 0) > 2) {
    s += 1;
    signals.push(`${i.file_count} files`);
  }
  if ((i.diff_size_chars ?? 0) > 40_000) {
    s += 2;
    signals.push("large diff");
  }
  if ((i.past_failure_rate ?? 0) > 0.4) {
    s += 2;
    signals.push(`past failure rate ${Math.round((i.past_failure_rate ?? 0) * 100)}%`);
  }
  if (i.risk === "high") {
    s += 2;
    signals.push("high risk");
  }
  if (i.risk === "critical") {
    s += 3;
    signals.push("critical risk");
  }
  if ((i.required_skills?.length ?? 0) > 3) {
    s += 1;
    signals.push("many skills");
  }
  return { score: Math.max(0, Math.min(10, s)), signals };
}

export function routeModel(i: RouteInput): RouteDecision {
  const { score, signals } = complexityScore(i);
  const mode = i.mode ?? "balanced";
  const risk = i.risk ?? "low";

  // model ladder: cheap → mid → strong
  let model: RouteDecision["selected_model"];
  if (score <= 2 && risk === "low") model = "haiku"; // docs/status/formatting
  else if (score >= 7 || risk === "critical") model = "opus"; // architecture/security/complex debugging
  else model = "sonnet"; // normal coding work

  // budget mode bends the choice — but NEVER below sonnet on high/critical risk
  if (mode === "economy" && model === "opus" && risk !== "high" && risk !== "critical") {
    model = "sonnet";
    signals.push("economy mode capped opus→sonnet");
  }
  if (mode === "high_quality" && model === "haiku") {
    model = "sonnet";
    signals.push("high_quality floor haiku→sonnet");
  }
  if ((risk === "high" || risk === "critical") && model === "haiku") {
    model = "sonnet";
    signals.push("risk floor haiku→sonnet");
  }

  // opus gate: outside an allow policy it needs approval (caller enforces)
  const needsApproval = model === "opus" && !i.allow_opus;
  if (needsApproval) signals.push("opus outside policy → approval");

  // effort ladder follows the same shape
  let effort: RouteDecision["selected_effort"] = score <= 2 ? "low" : score >= 8 ? "high" : "medium";
  if (mode === "economy" && effort === "high") effort = "medium";
  if (mode === "high_quality" && effort === "low") effort = "medium";
  if (mode === "emergency") effort = score >= 6 ? "xhigh" : "high";

  // depth: orchestrate only for very complex work in generous modes
  const depth: RouteDecision["selected_depth"] = score >= 9 && (mode === "high_quality" || mode === "emergency") ? "orchestrate" : "solo";

  const cost: RouteDecision["estimated_cost"] = model === "opus" || depth === "orchestrate" ? "high" : model === "sonnet" ? "medium" : "low";
  return {
    selected_model: model,
    selected_effort: effort,
    selected_depth: depth,
    reason: `complexity ${score}/10 (${signals.join("; ") || "no strong signals"}), mode ${mode}, risk ${risk}`,
    estimated_cost: cost,
    risk,
    needs_approval: needsApproval,
  };
}
