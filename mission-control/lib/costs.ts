// Costs / usage service. IMPORTANT: no real Claude/API token usage is tracked yet, so cost is an ESTIMATE from
// ACTIVITY — never a fabricated euro figure. Everything is is_estimate=true, and a money value is shown ONLY when
// a rate is explicitly configured (else null → the UI shows activity/tokens, not invented cost). A pluggable
// `realUsageSource()` returns null today; when real usage lands it takes over with source="real". No shell-out.
import { db, recordAudit, getSetting, setSetting } from "./db.ts";
import { redact } from "./redact.ts";
import { readAgents } from "./agents.ts";
import { readTeams } from "./teams.ts";
import { createApproval } from "./approvals.ts";
import { gatherAnalytics } from "./kpis.ts";
import { type Period, sinceFor, inRange } from "./analytics-shared.ts";

const num = (key: string, dflt: number): number => { const v = Number(getSetting(key, "")); return Number.isFinite(v) && getSetting(key, "") !== "" ? v : dflt; };
const bool = (key: string): boolean => getSetting(key, "").toLowerCase() === "true";
const safe = <T>(fn: () => T, dflt: T): T => { try { return fn(); } catch { return dflt; } };

// ── the model (all estimate knobs; euro rate defaults to 0 = "no money shown until you set a real rate") ──
export interface CostModel { est_tokens_per_unit: number; usd_per_1k_tokens: number; w_task: number; w_step: number; w_msg: number }
export function getCostModel(): CostModel {
  return {
    est_tokens_per_unit: num("costs.est_tokens_per_unit", 8000),
    usd_per_1k_tokens: num("costs.usd_per_1k_tokens", 0), // 0 ⇒ no fabricated cost; set a real rate to show ~$
    w_task: num("costs.w_task", 1), w_step: num("costs.w_step", 0.5), w_msg: num("costs.w_msg", 0.2),
  };
}
export interface BudgetConfig { per_agent_tokens: number; per_team_tokens: number; max_per_task_tokens: number; warning_pct: number; cheap_mode: boolean; high_effort_mode: boolean }
export function getBudgetConfig(): BudgetConfig {
  return {
    per_agent_tokens: num("budget.per_agent_tokens", 0), // 0 = no budget set (no warnings)
    per_team_tokens: num("budget.per_team_tokens", 0),
    max_per_task_tokens: num("budget.max_per_task_tokens", 0),
    warning_pct: num("budget.warning_pct", 80),
    cheap_mode: bool("budget.cheap_mode"), high_effort_mode: bool("budget.high_effort_mode"),
  };
}
export function setBudgetConfig(patch: Partial<BudgetConfig & CostModel>, actor?: string): { budget: BudgetConfig; model: CostModel } {
  const set = (k: string, v: unknown) => { if (v !== undefined) setSetting(k, typeof v === "boolean" ? (v ? "true" : "false") : String(Math.max(0, Number(v) || 0))); };
  set("budget.per_agent_tokens", patch.per_agent_tokens); set("budget.per_team_tokens", patch.per_team_tokens);
  set("budget.max_per_task_tokens", patch.max_per_task_tokens); set("budget.warning_pct", patch.warning_pct);
  if (patch.cheap_mode !== undefined) setSetting("budget.cheap_mode", patch.cheap_mode ? "true" : "false");
  if (patch.high_effort_mode !== undefined) setSetting("budget.high_effort_mode", patch.high_effort_mode ? "true" : "false");
  set("costs.est_tokens_per_unit", patch.est_tokens_per_unit); set("costs.usd_per_1k_tokens", patch.usd_per_1k_tokens);
  recordAudit({ actor: actor ?? "dashboard", via: "dashboard", action: "costs.config", detail: redact(JSON.stringify(patch)).slice(0, 200) });
  return { budget: getBudgetConfig(), model: getCostModel() };
}

// ── pluggable real-usage source (null today → estimate). Wire real Claude/API token usage here later. ──
export interface RealUsage { tokens: number; cost_usd: number }
export function realUsageSource(_scope: { period: Period }): Map<string, RealUsage> | null { void _scope; return null; }

export interface UsageRow { key: string; label: string; activity_units: number; est_tokens: number; est_cost_usd: number | null; is_estimate: boolean; source: "estimate" | "real" }
export type UsageGroup = "agent" | "team" | "workflow" | "task";

/** Estimated usage per agent/team/workflow/task for the period. Activity-based; money only when a rate is set. */
export function estimateUsage(opts: { period?: Period; groupBy?: UsageGroup } = {}): { rows: UsageRow[]; is_estimate: boolean; model: CostModel; period: Period } {
  const period = opts.period ?? "week";
  const groupBy = opts.groupBy ?? "agent";
  const since = sinceFor(period);
  const m = getCostModel();
  const d = gatherAnalytics();
  const agentName = new Map(safe(() => readAgents().agents.map((a) => [a.id, a.name] as const), []));
  const teamName = new Map(safe(() => readTeams().teams.map((t) => [t.id, t.name] as const), []));

  const units = new Map<string, { label: string; u: number }>();
  const add = (key: string | null, label: string, u: number) => { if (!key) return; const cur = units.get(key) ?? { label, u: 0 }; cur.u += u; units.set(key, cur); };

  const wfById = new Map(d.workflows.map((w) => [w.id, w])); // O(1) lookups — no O(steps×workflows) scan
  const tasksIn = d.workItems.filter((w) => inRange(w.updated_at, since));
  const msgsIn = d.messages.filter((mm) => inRange(mm.created_at, since));
  const stepsIn = d.wfEvents.filter((e) => e.type === "step_completed" && inRange(e.created_at, since)); // raw emit type

  if (groupBy === "agent") {
    for (const w of tasksIn) add(w.assigned_agent_id, agentName.get(w.assigned_agent_id ?? "") ?? w.assigned_agent_id ?? "", m.w_task);
    for (const mm of msgsIn) add(mm.from_agent_id, agentName.get(mm.from_agent_id ?? "") ?? mm.from_agent_id ?? "", m.w_msg);
  } else if (groupBy === "team") {
    for (const w of tasksIn) add(w.team_id, teamName.get(w.team_id ?? "") ?? w.team_id ?? "", m.w_task);
  } else if (groupBy === "workflow") {
    for (const e of stepsIn) add(e.workflow_id, wfById.get(e.workflow_id)?.title ?? e.workflow_id, m.w_step);
  } else { // task
    for (const w of tasksIn) add(w.id, w.title, m.w_task);
    for (const e of stepsIn) { const wf = wfById.get(e.workflow_id); if (wf?.work_item_id) add(wf.work_item_id, wf.title, m.w_step); }
  }

  const real = realUsageSource({ period });
  const rows: UsageRow[] = Array.from(units.entries()).map(([key, { label, u }]): UsageRow => {
    const r = real?.get(key);
    if (r) return { key, label, activity_units: Math.round(u * 10) / 10, est_tokens: r.tokens, est_cost_usd: r.cost_usd, is_estimate: false, source: "real" };
    const est_tokens = Math.round(u * m.est_tokens_per_unit);
    return { key, label, activity_units: Math.round(u * 10) / 10, est_tokens, est_cost_usd: m.usd_per_1k_tokens > 0 ? Math.round((est_tokens / 1000) * m.usd_per_1k_tokens * 100) / 100 : null, is_estimate: true, source: "estimate" };
  }).sort((a, b) => b.est_tokens - a.est_tokens);

  return { rows, is_estimate: !real, model: m, period };
}

// ── budget status + escalation ──
export interface BudgetRow { key: string; label: string; est_used_tokens: number; budget: number; pct: number; state: "ok" | "warning" | "exceeded" | "no_budget" }
export function budgetStatus(): { agents: BudgetRow[]; teams: BudgetRow[]; config: BudgetConfig; is_estimate: boolean } {
  const cfg = getBudgetConfig();
  const mk = (rows: { key: string; label: string; est_tokens: number }[], budget: number): BudgetRow[] => rows.map((r) => {
    if (budget <= 0) return { key: r.key, label: r.label, est_used_tokens: r.est_tokens, budget: 0, pct: 0, state: "no_budget" };
    const p = Math.round((r.est_tokens / budget) * 1000) / 10;
    return { key: r.key, label: r.label, est_used_tokens: r.est_tokens, budget, pct: p, state: p >= 100 ? "exceeded" : p >= cfg.warning_pct ? "warning" : "ok" };
  });
  const today = estimateUsage({ period: "today", groupBy: "agent" }).rows;
  const teamsToday = estimateUsage({ period: "today", groupBy: "team" }).rows;
  return {
    agents: mk(today.map((r) => ({ key: r.key, label: r.label, est_tokens: r.est_tokens })), cfg.per_agent_tokens),
    teams: mk(teamsToday.map((r) => ({ key: r.key, label: r.label, est_tokens: r.est_tokens })), cfg.per_team_tokens),
    config: cfg,
    is_estimate: true,
  };
}

/** Raise a Decision-Inbox escalation for each budget exceeded today (deduped once per id per day). */
export function checkBudgetsAndEscalate(actor?: string): { escalated: string[] } {
  const st = budgetStatus();
  const day = new Date().toISOString().slice(0, 10);
  const escalated: string[] = [];
  // namespace the dedupe key by SCOPE — an agent and a team can share an id (same slug regex), so keying on id
  // alone would let one suppress the other's genuine breach.
  for (const { scope, r } of [...st.agents.map((r) => ({ scope: "agent" as const, r })), ...st.teams.map((r) => ({ scope: "team" as const, r }))]) {
    if (r.state !== "exceeded") continue;
    const dedupe = `budget.esc.${day}.${scope}.${r.key}`;
    if (getSetting(dedupe, "")) continue;
    try {
      createApproval({
        kind: "escalation",
        summary: `Budget exceeded (estimate): ${scope} ${r.label} used ~${r.est_used_tokens.toLocaleString()} tokens vs ${r.budget.toLocaleString()} budget (${r.pct}%)`,
        risk: "budget",
        advice: "Estimated from activity — no real token usage is tracked yet. Consider cheap mode, a higher budget, or pausing.",
        action: { type: "noop" },
      });
      setSetting(dedupe, day);
      escalated.push(`${scope}:${r.key}`);
    } catch { /* skip on failure */ }
  }
  if (escalated.length) recordAudit({ actor: actor ?? "system", via: "system", action: "budget.escalate", detail: escalated.join(", ").slice(0, 200) });
  return { escalated };
}
