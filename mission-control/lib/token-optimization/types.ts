// Shared types for the token-optimization layer. Pure — no imports, safe everywhere (tests, client types).

export type OptimizationMode = "economy" | "balanced" | "high_quality" | "emergency";
export const OPTIMIZATION_MODES: OptimizationMode[] = ["economy", "balanced", "high_quality", "emergency"];

export type BudgetScope = "agent" | "team" | "workflow" | "task" | "day" | "model";
export const BUDGET_SCOPES: BudgetScope[] = ["agent", "team", "workflow", "task", "day", "model"];

export type ContextBlockKind =
  | "system_instructions"
  | "task_brief"
  | "constraints"
  | "relevant_files"
  | "relevant_diffs"
  | "knowledge_snippets"
  | "previous_decisions"
  | "agent_memory"
  | "recent_events_summary"
  | "workflow_state"
  | "logs_summary";

export interface ContextBlock {
  kind: ContextBlockKind;
  title: string;
  content: string; // redacted
  tokens: number; // estimate
  relevance: number; // 0..1 — sort key
  included: boolean;
  reason: string; // why selected / why excluded
  compressed: boolean;
  cache_hit: boolean;
}

export interface ContextPackage {
  system_instructions: string;
  task_brief: string;
  constraints: string[];
  blocks: ContextBlock[]; // every candidate block, included or not (explicit exclusions)
  explicit_exclusions: { kind: ContextBlockKind; title: string; reason: string; tokens: number }[];
  token_budget: number;
  estimated_tokens: number; // sum of included blocks + instructions/brief
  mode: OptimizationMode;
  needs_raw_context: boolean; // a low-confidence compression happened somewhere important
  fallback: "ok" | "summarize_first" | "needs_approval"; // when the budget can't fit the minimum
}

export interface RouteDecision {
  selected_model: "haiku" | "sonnet" | "opus";
  selected_effort: "low" | "medium" | "high" | "xhigh" | "max";
  selected_depth: "solo" | "orchestrate";
  reason: string;
  estimated_cost: "low" | "medium" | "high"; // qualitative — no invented dollars
  risk: "low" | "medium" | "high" | "critical";
  needs_approval: boolean; // opus/max escalations outside policy
}

export interface CompressionResult {
  summary: string; // redacted
  tokens_before: number;
  tokens_after: number;
  compression_ratio: number; // after/before (lower = more compressed)
  confidence: number; // 0..1
  mode: "lossy" | "lossless_ish";
  needs_raw_context: boolean; // confidence below threshold
}

export interface UsageEventInput {
  agent_id?: string | null;
  team_id?: string | null;
  work_item_id?: string | null;
  workflow_id?: string | null;
  workflow_step_id?: string | null;
  model?: string | null;
  effort?: string | null;
  depth?: string | null;
  estimated_input_tokens?: number | null;
  estimated_output_tokens?: number | null;
  actual_input_tokens?: number | null;
  actual_output_tokens?: number | null;
  estimated_cost_usd?: number | null;
  actual_cost_usd?: number | null;
  cache_hit?: boolean;
  compression_used?: boolean;
  context_blocks?: { kind: string; tokens: number; included: boolean }[];
  optimization_mode?: OptimizationMode | null;
  result_status?: "ok" | "failed" | "blocked" | "unknown";
  source?: "chat" | "gateway" | "worker" | "manual";
}

export interface BudgetPolicy {
  id: string;
  scope: BudgetScope;
  scope_id: string; // '*' = scope default
  mode: OptimizationMode;
  max_context_tokens: number | null;
  max_run_tokens: number | null;
  max_day_tokens: number | null;
  max_retries: number | null;
  approval_threshold_tokens: number | null;
  updated_at: string;
}

export interface BudgetDecision {
  allowed: boolean;
  mode: OptimizationMode;
  max_context_tokens: number;
  max_run_tokens: number;
  max_retries: number;
  needs_approval: boolean;
  approval_id: string | null;
  reason: string;
  warnings: string[];
}

/** chars/4 heuristic — ALWAYS an estimate, labeled as such everywhere it surfaces. */
export function estimateTokens(s: string | null | undefined): number {
  if (!s) return 0;
  return Math.ceil(s.length / 4);
}
