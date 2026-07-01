// Token Budget Manager — central budget policy + pre-run gate. Modes set the ceilings; per-scope
// policies (agent > team > workflow > task > model > day-default) override the mode defaults but are
// server-side clamped. Over-threshold runs raise a Decision-Inbox approval (phone-notified) instead
// of silently spending. Emergency mode itself requires an approval to activate.
import { randomUUID } from "node:crypto";
import { db, recordAudit, getSetting, setSetting } from "../db.ts";
import { redact } from "../redact.ts";
import { createApproval } from "../approvals.ts";
import { listUsage, eventTokens } from "./ledger.ts";
import {
  OPTIMIZATION_MODES,
  BUDGET_SCOPES,
  type OptimizationMode,
  type BudgetScope,
  type BudgetPolicy,
  type BudgetDecision,
} from "./types.ts";

// Mode defaults (tokens are ESTIMATE-space; server-side ceilings, not promises).
export const MODE_DEFAULTS: Record<OptimizationMode, { max_context_tokens: number; max_run_tokens: number; max_retries: number; approval_threshold_tokens: number }> = {
  economy: { max_context_tokens: 6_000, max_run_tokens: 25_000, max_retries: 1, approval_threshold_tokens: 60_000 },
  balanced: { max_context_tokens: 12_000, max_run_tokens: 80_000, max_retries: 2, approval_threshold_tokens: 150_000 },
  high_quality: { max_context_tokens: 30_000, max_run_tokens: 250_000, max_retries: 3, approval_threshold_tokens: 500_000 },
  emergency: { max_context_tokens: 60_000, max_run_tokens: 1_000_000, max_retries: 4, approval_threshold_tokens: 2_000_000 },
};

// hard server clamps — a policy can never exceed these (validated on write)
const HARD_MAX = { context: 120_000, run: 2_000_000, day: 10_000_000, retries: 6, threshold: 5_000_000 };

const clampInt = (v: unknown, max: number): number | null => {
  const num = Number(v);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.min(Math.floor(num), max);
};

export function getGlobalMode(): OptimizationMode {
  const m = getSetting("tokens.mode", "balanced") as OptimizationMode;
  return OPTIMIZATION_MODES.includes(m) ? m : "balanced";
}

/** Emergency requires an approval; other modes switch directly (audited). */
export function setGlobalMode(mode: string, actor: string, via = "dashboard"): { mode: OptimizationMode; needs_approval: boolean; approval_id: string | null } {
  if (!OPTIMIZATION_MODES.includes(mode as OptimizationMode)) throw new Error(`invalid mode: ${mode}`);
  if (mode === "emergency") {
    const { approval } = createApproval({
      kind: "escalation",
      summary: "Switch token optimization to EMERGENCY mode (very high budgets, expensive)",
      risk: "budget",
      advice: "Emergency lifts nearly all token ceilings. Approve only for a real incident.",
      action: { type: "set_setting", key: "tokens.mode", value: "emergency" },
    });
    recordAudit({ actor, via, action: "tokens.mode.requested", detail: "emergency (needs approval)" });
    return { mode: getGlobalMode(), needs_approval: true, approval_id: approval.id };
  }
  setSetting("tokens.mode", mode);
  recordAudit({ actor, via, action: "tokens.mode", detail: mode });
  return { mode: mode as OptimizationMode, needs_approval: false, approval_id: null };
}

// ── policies ──────────────────────────────────────────────────────────────

export function listPolicies(): BudgetPolicy[] {
  return db().prepare("SELECT * FROM token_budget_policies ORDER BY scope, scope_id").all() as unknown as BudgetPolicy[];
}

/** Upsert a policy — every field server-side validated/clamped. Never trusts client numbers. */
export function upsertPolicy(input: Partial<BudgetPolicy> & { scope: string; scope_id: string }, actor: string): BudgetPolicy {
  if (!BUDGET_SCOPES.includes(input.scope as BudgetScope)) throw new Error(`invalid scope: ${input.scope}`);
  const scopeId = String(input.scope_id ?? "*").slice(0, 80) || "*";
  const mode = OPTIMIZATION_MODES.includes(input.mode as OptimizationMode) ? (input.mode as OptimizationMode) : "balanced";
  const now = new Date().toISOString();
  const id = randomUUID();
  db()
    .prepare(
      `INSERT INTO token_budget_policies (id, scope, scope_id, mode, max_context_tokens, max_run_tokens, max_day_tokens, max_retries, approval_threshold_tokens, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(scope, scope_id) DO UPDATE SET mode=excluded.mode, max_context_tokens=excluded.max_context_tokens,
         max_run_tokens=excluded.max_run_tokens, max_day_tokens=excluded.max_day_tokens, max_retries=excluded.max_retries,
         approval_threshold_tokens=excluded.approval_threshold_tokens, updated_at=excluded.updated_at`,
    )
    .run(
      id,
      input.scope,
      scopeId,
      mode,
      clampInt(input.max_context_tokens, HARD_MAX.context),
      clampInt(input.max_run_tokens, HARD_MAX.run),
      clampInt(input.max_day_tokens, HARD_MAX.day),
      clampInt(input.max_retries, HARD_MAX.retries),
      clampInt(input.approval_threshold_tokens, HARD_MAX.threshold),
      now,
    );
  recordAudit({ actor, via: "dashboard", action: "tokens.policy", detail: redact(`${input.scope}:${scopeId} → ${mode}`).slice(0, 200) });
  return db().prepare("SELECT * FROM token_budget_policies WHERE scope = ? AND scope_id = ?").get(input.scope, scopeId) as unknown as BudgetPolicy;
}

export function deletePolicy(scope: string, scopeId: string, actor: string): boolean {
  const res = db().prepare("DELETE FROM token_budget_policies WHERE scope = ? AND scope_id = ?").run(scope, scopeId);
  if (Number(res.changes) > 0) recordAudit({ actor, via: "dashboard", action: "tokens.policy.delete", detail: `${scope}:${scopeId}` });
  return Number(res.changes) > 0;
}

function policyFor(scope: BudgetScope, scopeId: string | null | undefined): BudgetPolicy | null {
  if (!scopeId) return null;
  const exact = db().prepare("SELECT * FROM token_budget_policies WHERE scope = ? AND scope_id = ?").get(scope, scopeId) as unknown as BudgetPolicy | undefined;
  if (exact) return exact;
  const dflt = db().prepare("SELECT * FROM token_budget_policies WHERE scope = ? AND scope_id = '*'").get(scope) as unknown as BudgetPolicy | undefined;
  return dflt ?? null;
}

// ── the pre-run gate ──────────────────────────────────────────────────────

export interface RunBudgetInput {
  agent_id?: string | null;
  team_id?: string | null;
  workflow_id?: string | null;
  work_item_id?: string | null;
  model?: string | null;
  estimated_tokens: number; // estimate for THIS run (context + expected output)
  risk?: "low" | "medium" | "high" | "critical";
  retry_count?: number;
}

/** Decide before a run: mode + ceilings + allowed/approval. High/critical risk NEVER drops below
 *  high_quality context policy (quality-over-savings on risky work). */
export function checkRunBudget(input: RunBudgetInput): BudgetDecision {
  const warnings: string[] = [];
  // effective policy: agent > team > workflow > task > model > global mode
  const pol =
    policyFor("agent", input.agent_id) ??
    policyFor("team", input.team_id) ??
    policyFor("workflow", input.workflow_id) ??
    policyFor("task", input.work_item_id) ??
    policyFor("model", input.model) ??
    null;
  let mode: OptimizationMode = pol?.mode ?? getGlobalMode();
  // safety floor: risky work never runs on economy context
  if ((input.risk === "high" || input.risk === "critical") && (mode === "economy" || mode === "balanced")) {
    mode = "high_quality";
    warnings.push(`risk=${input.risk} → context policy raised to high_quality`);
  }
  const d = MODE_DEFAULTS[mode];
  const maxContext = pol?.max_context_tokens ?? d.max_context_tokens;
  const maxRun = pol?.max_run_tokens ?? d.max_run_tokens;
  const maxRetries = pol?.max_retries ?? d.max_retries;
  const threshold = pol?.approval_threshold_tokens ?? d.approval_threshold_tokens;

  // retry ceiling
  if ((input.retry_count ?? 0) > maxRetries) {
    return { allowed: false, mode, max_context_tokens: maxContext, max_run_tokens: maxRun, max_retries: maxRetries, needs_approval: false, approval_id: null, reason: `retry ${input.retry_count} exceeds max_retries=${maxRetries} for mode ${mode}`, warnings };
  }

  // day budget (best-known tokens from the ledger, today, for this agent)
  const dayPol = policyFor("day", input.agent_id ?? "*") ?? policyFor("day", "*");
  const dayCap = dayPol?.max_day_tokens ?? null;
  if (dayCap && input.agent_id) {
    const today = new Date().toISOString().slice(0, 10);
    const spent = listUsage({ since: today, agent_id: input.agent_id, limit: 2000 }).reduce((s, e) => s + eventTokens(e).tokens, 0);
    if (spent + input.estimated_tokens > dayCap) {
      const { approval } = createApproval({
        kind: "escalation",
        summary: `Token day-budget: ${input.agent_id} would exceed ${dayCap.toLocaleString()} tokens today (~${spent.toLocaleString()} spent, +${input.estimated_tokens.toLocaleString()} requested)`,
        risk: "budget",
        advice: "Approve to allow this run past the day budget, or reject to hold it.",
        action: { type: "noop" },
      });
      recordAudit({ actor: input.agent_id ?? "system", via: "system", action: "tokens.budget.blocked", detail: `day cap ${dayCap}` });
      return { allowed: false, mode, max_context_tokens: maxContext, max_run_tokens: maxRun, max_retries: maxRetries, needs_approval: true, approval_id: approval.id, reason: "day budget exceeded — approval created", warnings };
    }
    if (spent + input.estimated_tokens > dayCap * 0.8) warnings.push("approaching day budget (>80%)");
  }

  // per-run approval threshold (expensive single run)
  if (input.estimated_tokens > threshold) {
    const { approval } = createApproval({
      kind: "escalation",
      summary: `Expensive run: ~${input.estimated_tokens.toLocaleString()} tokens (estimate) exceeds the ${mode} approval threshold (${threshold.toLocaleString()})`,
      risk: "budget",
      advice: "Approve for this run, or lower the context / split the task.",
      action: { type: "noop" },
    });
    recordAudit({ actor: input.agent_id ?? "system", via: "system", action: "tokens.budget.approval_required", detail: `est ${input.estimated_tokens} > ${threshold}` });
    return { allowed: false, mode, max_context_tokens: maxContext, max_run_tokens: maxRun, max_retries: maxRetries, needs_approval: true, approval_id: approval.id, reason: "estimated tokens above approval threshold", warnings };
  }

  if (input.estimated_tokens > maxRun) warnings.push(`estimate ${input.estimated_tokens} exceeds max_run_tokens=${maxRun} — trim context`);
  return { allowed: true, mode, max_context_tokens: maxContext, max_run_tokens: maxRun, max_retries: maxRetries, needs_approval: false, approval_id: null, reason: `within ${mode} budget`, warnings };
}
