// Token Ledger — per-run usage accounting. HONESTY RULE: actual_* only when the runtime really
// reported it (e.g. the chat runner's result event); everything else stays an estimate and is
// surfaced as such. Money appears ONLY when a real rate/cost exists — never fabricated.
import { randomUUID } from "node:crypto";
import { db } from "../db.ts";
import { redact } from "../redact.ts";
import type { UsageEventInput } from "./types.ts";

export interface UsageEvent extends Required<Pick<UsageEventInput, never>> {
  id: string;
  agent_id: string | null;
  team_id: string | null;
  work_item_id: string | null;
  workflow_id: string | null;
  workflow_step_id: string | null;
  model: string | null;
  effort: string | null;
  depth: string | null;
  estimated_input_tokens: number | null;
  estimated_output_tokens: number | null;
  actual_input_tokens: number | null;
  actual_output_tokens: number | null;
  estimated_cost_usd: number | null;
  actual_cost_usd: number | null;
  cache_hit: boolean;
  compression_used: boolean;
  context_blocks: { kind: string; tokens: number; included: boolean }[];
  optimization_mode: string | null;
  result_status: string;
  source: string;
  created_at: string;
}

const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function recordUsage(input: UsageEventInput): string {
  const id = randomUUID();
  db()
    .prepare(
      `INSERT INTO token_usage_events (id, agent_id, team_id, work_item_id, workflow_id, workflow_step_id, model, effort, depth,
        estimated_input_tokens, estimated_output_tokens, actual_input_tokens, actual_output_tokens,
        estimated_cost_usd, actual_cost_usd, cache_hit, compression_used, context_blocks_json,
        optimization_mode, result_status, source, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      input.agent_id ?? null,
      input.team_id ?? null,
      input.work_item_id ?? null,
      input.workflow_id ?? null,
      input.workflow_step_id ?? null,
      input.model ?? null,
      input.effort ?? null,
      input.depth ?? null,
      n(input.estimated_input_tokens),
      n(input.estimated_output_tokens),
      n(input.actual_input_tokens),
      n(input.actual_output_tokens),
      n(input.estimated_cost_usd),
      n(input.actual_cost_usd),
      input.cache_hit ? 1 : 0,
      input.compression_used ? 1 : 0,
      input.context_blocks ? redact(JSON.stringify(input.context_blocks.slice(0, 40))) : null,
      input.optimization_mode ?? null,
      input.result_status ?? "unknown",
      input.source ?? "manual",
      new Date().toISOString(),
    );
  return id;
}

function rowToEvent(r: Record<string, unknown>): UsageEvent {
  let blocks: UsageEvent["context_blocks"] = [];
  try {
    blocks = r.context_blocks_json ? JSON.parse(String(r.context_blocks_json)) : [];
  } catch {}
  return {
    id: String(r.id),
    agent_id: (r.agent_id as string) ?? null,
    team_id: (r.team_id as string) ?? null,
    work_item_id: (r.work_item_id as string) ?? null,
    workflow_id: (r.workflow_id as string) ?? null,
    workflow_step_id: (r.workflow_step_id as string) ?? null,
    model: (r.model as string) ?? null,
    effort: (r.effort as string) ?? null,
    depth: (r.depth as string) ?? null,
    estimated_input_tokens: n(r.estimated_input_tokens),
    estimated_output_tokens: n(r.estimated_output_tokens),
    actual_input_tokens: n(r.actual_input_tokens),
    actual_output_tokens: n(r.actual_output_tokens),
    estimated_cost_usd: n(r.estimated_cost_usd),
    actual_cost_usd: n(r.actual_cost_usd),
    cache_hit: !!r.cache_hit,
    compression_used: !!r.compression_used,
    context_blocks: blocks,
    optimization_mode: (r.optimization_mode as string) ?? null,
    result_status: String(r.result_status ?? "unknown"),
    source: String(r.source ?? "manual"),
    created_at: String(r.created_at),
  };
}

export function listUsage(opts: { since?: string; agent_id?: string; workflow_id?: string; limit?: number } = {}): UsageEvent[] {
  const limit = Math.min(Math.max(1, opts.limit ?? 500), 2000);
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.since) {
    where.push("created_at >= ?");
    args.push(opts.since);
  }
  if (opts.agent_id) {
    where.push("agent_id = ?");
    args.push(opts.agent_id);
  }
  if (opts.workflow_id) {
    where.push("workflow_id = ?");
    args.push(opts.workflow_id);
  }
  const sql = `SELECT * FROM token_usage_events ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC LIMIT ${limit}`;
  return (db().prepare(sql).all(...(args as string[])) as Record<string, unknown>[]).map(rowToEvent);
}

/** Best-known tokens for an event: actual when reported, else the estimate (flag says which). */
export function eventTokens(e: UsageEvent): { tokens: number; is_actual: boolean } {
  const actual = (e.actual_input_tokens ?? 0) + (e.actual_output_tokens ?? 0);
  if (e.actual_input_tokens != null || e.actual_output_tokens != null) return { tokens: actual, is_actual: true };
  return { tokens: (e.estimated_input_tokens ?? 0) + (e.estimated_output_tokens ?? 0), is_actual: false };
}

export interface UsageSummary {
  runs: number;
  est_tokens: number;
  actual_tokens: number; // 0 when nothing real reported
  actual_cost_usd: number | null; // null when no real cost at all
  runs_with_actuals: number;
  failed_runs: number;
  wasted_tokens_failed: number; // best-known tokens spent on failed runs
  cache_hits: number;
  compression_runs: number;
  by_agent: { key: string; runs: number; tokens: number; is_actual_any: boolean; failed: number }[];
  by_workflow: { key: string; runs: number; tokens: number; failed: number }[];
  by_model: { key: string; runs: number; tokens: number }[];
}

export function usageSummary(sinceIso?: string): UsageSummary {
  const since = sinceIso ?? new Date().toISOString().slice(0, 10); // default: today
  const events = listUsage({ since, limit: 2000 });
  const agg = <K extends string>(key: (e: UsageEvent) => string | null) => {
    const m = new Map<string, { runs: number; tokens: number; failed: number; actual: boolean }>();
    for (const e of events) {
      const k = key(e);
      if (!k) continue;
      const cur = m.get(k) ?? { runs: 0, tokens: 0, failed: 0, actual: false };
      const t = eventTokens(e);
      cur.runs++;
      cur.tokens += t.tokens;
      cur.actual = cur.actual || t.is_actual;
      if (e.result_status === "failed") cur.failed++;
      m.set(k, cur);
    }
    return [...m.entries()].sort((a, b) => b[1].tokens - a[1].tokens) as [K, { runs: number; tokens: number; failed: number; actual: boolean }][];
  };
  const failed = events.filter((e) => e.result_status === "failed");
  const actualCost = events.reduce((s, e) => s + (e.actual_cost_usd ?? 0), 0);
  return {
    runs: events.length,
    est_tokens: events.reduce((s, e) => s + (e.estimated_input_tokens ?? 0) + (e.estimated_output_tokens ?? 0), 0),
    actual_tokens: events.reduce((s, e) => s + (e.actual_input_tokens ?? 0) + (e.actual_output_tokens ?? 0), 0),
    actual_cost_usd: events.some((e) => e.actual_cost_usd != null) ? Math.round(actualCost * 10000) / 10000 : null,
    runs_with_actuals: events.filter((e) => e.actual_cost_usd != null || e.actual_input_tokens != null).length,
    failed_runs: failed.length,
    wasted_tokens_failed: failed.reduce((s, e) => s + eventTokens(e).tokens, 0),
    cache_hits: events.filter((e) => e.cache_hit).length,
    compression_runs: events.filter((e) => e.compression_used).length,
    by_agent: agg((e) => e.agent_id).map(([key, v]) => ({ key, runs: v.runs, tokens: v.tokens, is_actual_any: v.actual, failed: v.failed })),
    by_workflow: agg((e) => e.workflow_id).map(([key, v]) => ({ key, runs: v.runs, tokens: v.tokens, failed: v.failed })),
    by_model: agg((e) => e.model).map(([key, v]) => ({ key, runs: v.runs, tokens: v.tokens })),
  };
}

/** Tokens per outcome — tokens/PR, per completed task, per failed attempt (best-known tokens). */
export function efficiencyMetrics(sinceIso?: string): { tokens_per_ok_run: number | null; tokens_per_failed_run: number | null; ok_runs: number; failed_runs: number } {
  const since = sinceIso ?? new Date(Date.now() - 7 * 86400_000).toISOString();
  const events = listUsage({ since, limit: 2000 });
  const ok = events.filter((e) => e.result_status === "ok");
  const failed = events.filter((e) => e.result_status === "failed");
  const sum = (l: UsageEvent[]) => l.reduce((s, e) => s + eventTokens(e).tokens, 0);
  return {
    tokens_per_ok_run: ok.length ? Math.round(sum(ok) / ok.length) : null,
    tokens_per_failed_run: failed.length ? Math.round(sum(failed) / failed.length) : null,
    ok_runs: ok.length,
    failed_runs: failed.length,
  };
}
