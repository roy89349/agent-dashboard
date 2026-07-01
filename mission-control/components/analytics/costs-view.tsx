"use client";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Gauge, RefreshCw, AlertTriangle, Settings2, Info } from "lucide-react";
import { Bars, Select, PERIODS } from "./parts";
import type { UsageRow, UsageGroup, BudgetRow, BudgetConfig, CostModel } from "@/lib/costs";
import type { Period } from "@/lib/analytics-shared";

const GROUPS: { v: UsageGroup; l: string }[] = [{ v: "agent", l: "Per agent" }, { v: "team", l: "Per team" }, { v: "workflow", l: "Per workflow" }, { v: "task", l: "Per task" }];
const STATE_TONE: Record<string, string> = { ok: "text-emerald-300", warning: "text-amber-300", exceeded: "text-red-400", no_budget: "text-white/30" };

export function CostsView() {
  const [usage, setUsage] = useState<{ rows: UsageRow[]; is_estimate: boolean; model: CostModel } | null>(null);
  const [budget, setBudget] = useState<{ agents: BudgetRow[]; teams: BudgetRow[]; config: BudgetConfig } | null>(null);
  const [period, setPeriod] = useState<Period>("week");
  const [groupBy, setGroupBy] = useState<UsageGroup>("agent");
  const [cfgOpen, setCfgOpen] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/analytics/costs?period=${period}&groupBy=${groupBy}`, { cache: "no-store" });
    if (r.ok) { const j = await r.json(); setUsage(j.usage); setBudget(j.budget); }
  }, [period, groupBy]);
  useEffect(() => { load(); }, [load]);

  const rateSet = (usage?.model.usd_per_1k_tokens ?? 0) > 0;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 pb-24 sm:px-6 md:pb-5">
      <div className="mb-4 flex items-center gap-3">
        <div className="grid size-9 place-items-center rounded-xl border border-white/10 bg-white/5 text-emerald-300"><Gauge className="size-[18px]" /></div>
        <div><h2 className="text-base font-semibold text-white">Costs &amp; usage</h2><p className="text-xs text-white/40">Activity-based estimates — real usage plugs in later</p></div>
        <button onClick={() => setCfgOpen(!cfgOpen)} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/50 hover:bg-white/5"><Settings2 className="size-3.5" /> Budgets</button>
        <button onClick={load} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/50 hover:bg-white/5"><RefreshCw className="size-3.5" /></button>
      </div>

      {/* honesty banner */}
      <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3 text-xs text-amber-200/90">
        <Info className="mt-0.5 size-4 shrink-0" />
        <span><b>These are estimates.</b> No real Claude/API token usage is connected yet — usage is modelled from activity (tasks · workflow steps · messages).
          {rateSet ? " A cost rate is configured, so ~$ figures are estimates too." : " No euro/$ figures are shown until you set a real rate in Budgets (no invented costs)."}</span>
      </div>

      {cfgOpen && budget && usage && <BudgetForm config={budget.config} model={usage.model} onSaved={load} onClose={() => setCfgOpen(false)} />}

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <Select value={period} onChange={(v) => setPeriod(v as Period)} opts={PERIODS} />
        <Select value={groupBy} onChange={(v) => setGroupBy(v as UsageGroup)} opts={GROUPS} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/45">Estimated usage ({GROUPS.find((g) => g.v === groupBy)?.l})</p>
          <Bars rows={(usage?.rows ?? []).slice(0, 12).map((r) => ({ label: r.label, value: r.est_tokens }))} unit=" tok" />
          {rateSet && usage && <p className="mt-2 text-[11px] text-white/40">≈ ${usage.rows.reduce((s, r) => s + (r.est_cost_usd ?? 0), 0).toFixed(2)} total (estimate)</p>}
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-white/45"><Gauge className="size-3.5" /> Budget today (estimate)</p>
          {!budget || (budget.agents.length === 0 && budget.teams.length === 0) ? <p className="text-xs text-white/30">No activity today.</p> : (
            <div className="space-y-1.5">
              {[...budget.agents, ...budget.teams].slice(0, 12).map((r, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="w-28 shrink-0 truncate text-white/60">{r.label}</span>
                  {r.state === "no_budget" ? <span className="text-[10px] text-white/25">no budget set</span> : (
                    <>
                      <span className="h-2.5 flex-1 overflow-hidden rounded bg-white/5"><span className={`block h-full ${r.state === "exceeded" ? "bg-red-500/70" : r.state === "warning" ? "bg-amber-500/70" : "bg-emerald-500/60"}`} style={{ width: `${Math.min(100, r.pct)}%` }} /></span>
                      <span className={`shrink-0 tabular-nums ${STATE_TONE[r.state]}`}>{r.pct}%{r.state === "exceeded" && <AlertTriangle className="ml-0.5 inline size-3" />}</span>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
          {budget?.config.cheap_mode && <span className="mt-2 inline-block rounded bg-white/5 px-1.5 text-[10px] text-white/50">cheap mode on</span>}
          {budget?.config.high_effort_mode && <span className="mt-2 ml-1 inline-block rounded bg-white/5 px-1.5 text-[10px] text-white/50">high-effort mode on</span>}
        </section>
      </div>
    </div>
  );
}

function BudgetForm({ config, model, onSaved, onClose }: { config: BudgetConfig; model: CostModel; onSaved: () => void; onClose: () => void }) {
  const [f, setF] = useState({ ...config, ...model });
  async function save(check = false) {
    const r = await fetch("/api/analytics/budget", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...f, check }) });
    if (r.ok) { const j = await r.json(); toast.success(check && j.escalated?.length ? `Saved — ${j.escalated.length} budget escalation(s) raised` : "Saved"); onSaved(); if (!check) onClose(); }
    else toast.error("Save failed");
  }
  const N = (k: keyof typeof f, label: string, hint?: string) => (
    <label className="block text-xs text-white/50">{label}{hint && <span className="text-white/25"> · {hint}</span>}
      <input type="number" min={0} value={f[k] as number} onChange={(e) => setF({ ...f, [k]: Number(e.target.value) })} className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-white/5 px-2.5 text-sm text-white outline-none focus:border-emerald-500/40" />
    </label>
  );
  return (
    <div className="mb-4 space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
      <p className="text-xs font-semibold text-white/60">Budgets &amp; cost model (all in estimated tokens)</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {N("per_agent_tokens", "Daily / agent", "0 = off")}
        {N("per_team_tokens", "Daily / team", "0 = off")}
        {N("max_per_task_tokens", "Max / task", "0 = off")}
        {N("warning_pct", "Warning at", "%")}
        {N("est_tokens_per_unit", "Est tokens / unit")}
        {N("usd_per_1k_tokens", "$ / 1k tok", "0 = no $")}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-white/60">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.cheap_mode} onChange={(e) => setF({ ...f, cheap_mode: e.target.checked })} /> cheap mode</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.high_effort_mode} onChange={(e) => setF({ ...f, high_effort_mode: e.target.checked })} /> high-effort mode</label>
      </div>
      <div className="flex gap-1.5">
        <button onClick={() => save(false)} className="h-9 flex-1 rounded-lg bg-emerald-500 text-sm font-semibold text-black hover:bg-emerald-400">Save</button>
        <button onClick={() => save(true)} className="h-9 rounded-lg border border-amber-500/30 px-3 text-xs text-amber-300 hover:bg-amber-500/10">Save + escalate exceeded</button>
      </div>
    </div>
  );
}
