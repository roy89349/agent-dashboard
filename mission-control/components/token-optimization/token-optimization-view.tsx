"use client";
// Token Optimization control room: global mode, honest usage numbers (estimate vs actual — never
// invented dollars), per-agent/workflow breakdowns, a context inspector ("what would the agent
// receive and why"), budget policies and rule-based recommendations.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Coins, RefreshCw, Info, Users, GitBranch, Cpu, Zap, Scale, Gem, Siren } from "lucide-react";
import { PageHeader, MetricCard, SectionLabel } from "@/components/ui/glass";
import { EmptyState } from "@/components/ui/empty-state";
import type { OptimizationMode, BudgetPolicy } from "@/lib/token-optimization/types";
import type { UsageSummary } from "@/lib/token-optimization/ledger";
import { TokenTag, UsageRow, Skeleton, fmt } from "./parts";
import { ContextInspector } from "./context-inspector";
import { BudgetPolicies, type ModeDefaults } from "./budget-policies";
import { RecommendationsPanel } from "./recommendations-panel";

export type OverviewData = {
  mode: OptimizationMode | null;
  summary: UsageSummary | null;
  week: UsageSummary | null;
  efficiency: { tokens_per_ok_run: number | null; tokens_per_failed_run: number | null; ok_runs: number; failed_runs: number } | null;
  cache: { entries: number; hits: number; misses: number; hit_rate: number | null; by_kind: { kind: string; entries: number; hits: number }[] } | null;
  compression: { count: number; tokens_saved: number; avg_ratio: number | null; low_confidence: number } | null;
  policies: BudgetPolicy[] | null;
  mode_defaults: ModeDefaults;
};

const TABS = ["overview", "agents", "workflows", "inspector", "policies", "recommendations"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = {
  overview: "Overview",
  agents: "Agents",
  workflows: "Workflows",
  inspector: "Context Inspector",
  policies: "Budget Policies",
  recommendations: "Recommendations",
};

export function TokenOptimizationView() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("overview");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/token-optimization", { cache: "no-store" });
      if (r.ok) setData(await r.json());
      else toast.error("Failed to load token data");
    } catch {
      toast.error("Failed to load token data");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 pb-24 sm:px-6 md:pb-5">
      <PageHeader
        title="Token Optimization"
        subtitle="Budgets · savings · per-run usage — token counts are estimates unless actuals were reported"
        actions={
          <button onClick={load} aria-label="Refresh" className="glass-card glass-hover grid size-11 place-items-center text-white/50 hover:text-white/80">
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        }
        className="mb-4"
      />

      <div className="glass-inset mb-4 inline-flex max-w-full flex-wrap gap-1 rounded-xl p-1">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`min-h-11 rounded-lg px-3.5 text-xs font-medium transition-colors ${
              tab === t ? "bg-white/10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]" : "text-white/50 hover:bg-white/5 hover:text-white/80"
            }`}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab data={data} loading={loading} onReload={load} />}
      {tab === "agents" && <AgentsTab week={data?.week ?? null} loading={loading} />}
      {tab === "workflows" && <WorkflowsTab week={data?.week ?? null} loading={loading} />}
      {tab === "inspector" && <ContextInspector />}
      {tab === "policies" && <BudgetPolicies policies={data?.policies ?? null} modeDefaults={data?.mode_defaults ?? null} loading={loading} onChanged={load} />}
      {tab === "recommendations" && <RecommendationsPanel />}
    </div>
  );
}

// ── mode selector ───────────────────────────────────────────────────────────

const MODES: { v: OptimizationMode; l: string; desc: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { v: "economy", l: "Economy", desc: "smallest contexts, cheapest ceilings", icon: Zap },
  { v: "balanced", l: "Balanced", desc: "the sensible default", icon: Scale },
  { v: "high_quality", l: "High quality", desc: "big contexts, generous budgets", icon: Gem },
  { v: "emergency", l: "Emergency", desc: "near-unlimited — requires approval", icon: Siren },
];

function ModeSelector({ mode, onChanged }: { mode: OptimizationMode | null; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  async function set(m: OptimizationMode) {
    if (busy || m === mode) return;
    setBusy(true);
    try {
      const r = await fetch("/api/token-optimization/mode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: m }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) toast.error(j.error ?? "Failed to switch mode");
      else if (j.needs_approval) toast.warning("Emergency mode needs approval — a request was created in the Decision Inbox");
      else toast.success(`Optimization mode → ${m}`);
      onChanged();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="glass mb-4 p-4">
      <SectionLabel className="mb-2.5">Global optimization mode</SectionLabel>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {MODES.map((m) => {
          const active = mode === m.v;
          const Icon = m.icon;
          const emergency = m.v === "emergency";
          return (
            <button
              key={m.v}
              onClick={() => set(m.v)}
              disabled={busy}
              className={`min-h-[44px] rounded-xl border p-3 text-left transition-colors disabled:opacity-60 ${
                active
                  ? emergency
                    ? "border-red-500/40 bg-red-500/10"
                    : "border-emerald-500/40 bg-emerald-500/10"
                  : "border-white/10 bg-white/[0.04] hover:bg-white/[0.08]"
              }`}
            >
              <span className={`flex items-center gap-1.5 text-sm font-semibold ${active ? (emergency ? "text-red-300" : "text-emerald-300") : "text-white/80"}`}>
                <Icon className="size-4" /> {m.l}
                {active && <span className="ml-auto text-[10px] font-medium uppercase tracking-wide opacity-80">active</span>}
              </span>
              <span className="mt-0.5 block text-[11px] leading-snug text-white/40">{m.desc}</span>
              {emergency && (
                <span className="mt-1 inline-block rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 text-[10px] text-amber-300">requires approval</span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ── overview tab ────────────────────────────────────────────────────────────

function OverviewTab({ data, loading, onReload }: { data: OverviewData | null; loading: boolean; onReload: () => void }) {
  if (loading && !data) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
    );
  }
  if (!data) return <EmptyState icon={Coins} title="Token data unavailable" hint="The token-optimization endpoint did not respond. Try Refresh." tone="slate" />;

  const s = data.summary;
  const w = data.week;
  const hitRate = data.cache?.hit_rate; // already a 0–100 percentage
  const waste = w?.wasted_tokens_failed ?? 0;

  return (
    <>
      <ModeSelector mode={data.mode} onChanged={onReload} />

      <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3 text-xs text-amber-200/90 backdrop-blur-md glow-warn">
        <Info className="mt-0.5 size-4 shrink-0" />
        <span><b>Honest numbers.</b> Token counts are chars/4 estimates unless a run reported real usage (tagged <i>actual</i>). Dollar amounts only appear when a run reported a real cost — nothing is invented.</span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <MetricCard
          label="Runs today"
          value={fmt(s?.runs ?? 0)}
          hint={s ? `${s.runs_with_actuals} with reported actuals` : "no data"}
        />
        <MetricCard
          label="Tokens today"
          value={<span className="inline-flex items-center gap-1.5">{fmt(s?.est_tokens ?? 0)} <TokenTag source={s && s.runs_with_actuals > 0 ? "mixed" : "estimate"} /></span>}
          hint={s && s.actual_tokens > 0 ? `${fmt(s.actual_tokens)} tok actually reported` : "estimate — no actuals reported yet"}
        />
        {s?.actual_cost_usd != null ? (
          <MetricCard
            label="Cost today"
            value={<span className="inline-flex items-center gap-1.5">${s.actual_cost_usd.toFixed(4)} <TokenTag source="actual" /></span>}
            tone="ok"
            hint={`reported by ${s.runs_with_actuals} run(s)`}
          />
        ) : (
          <MetricCard label="Cost today" value={<span className="text-white/30">—</span>} hint="no real cost data reported" />
        )}
        <MetricCard
          label="Saved by compression (7d)"
          value={<span className="inline-flex items-center gap-1.5">{fmt(data.compression?.tokens_saved ?? 0)} <TokenTag source="estimate" /></span>}
          tone={data.compression && data.compression.tokens_saved > 0 ? "ok" : "default"}
          hint={data.compression ? `${data.compression.count} compressions · ${data.compression.low_confidence} low-confidence` : "no data"}
        />
        <MetricCard
          label="Cache hit rate"
          value={hitRate != null ? `${hitRate}%` : <span className="text-white/30">—</span>}
          tone={hitRate != null && hitRate > 0 ? "info" : "default"}
          hint={data.cache ? `${data.cache.hits} hits · ${data.cache.misses} misses · ${data.cache.entries} entries` : "no cache activity yet"}
        />
        <MetricCard
          label="Wasted on failed runs (7d)"
          value={<span className="inline-flex items-center gap-1.5">{fmt(waste)} <TokenTag source="estimate" /></span>}
          tone={waste > 0 ? "danger" : "default"}
          hint={w ? `${w.failed_runs} failed run(s) this week` : "no data"}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="glass p-4">
          <SectionLabel className="mb-2.5">Most expensive agents (7d)</SectionLabel>
          {!w || w.by_agent.length === 0 ? (
            <p className="text-xs text-white/30">No agent usage recorded this week.</p>
          ) : (
            <div className="space-y-1.5">
              {w.by_agent.slice(0, 8).map((a) => (
                <UsageRow key={a.key} name={a.key} runs={a.runs} tokens={a.tokens} failed={a.failed} source={a.is_actual_any ? "actual" : "estimate"} />
              ))}
            </div>
          )}
        </section>
        <section className="glass p-4">
          <SectionLabel className="mb-2.5">Most expensive workflows (7d)</SectionLabel>
          {!w || w.by_workflow.length === 0 ? (
            <p className="text-xs text-white/30">No workflow usage recorded this week.</p>
          ) : (
            <div className="space-y-1.5">
              {w.by_workflow.slice(0, 8).map((x) => (
                <UsageRow key={x.key} name={x.key} runs={x.runs} tokens={x.tokens} failed={x.failed} source="estimate" />
              ))}
            </div>
          )}
        </section>
      </div>

      {data.efficiency && (data.efficiency.ok_runs > 0 || data.efficiency.failed_runs > 0) && (
        <section className="glass mt-4 p-4">
          <SectionLabel className="mb-2.5">Efficiency (7d, best-known tokens)</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <MetricCard label="Tokens / successful run" value={<span className="inline-flex items-center gap-1.5">{fmt(data.efficiency.tokens_per_ok_run)} <TokenTag source="estimate" /></span>} hint={`${data.efficiency.ok_runs} ok run(s)`} />
            <MetricCard label="Tokens / failed run" value={<span className="inline-flex items-center gap-1.5">{fmt(data.efficiency.tokens_per_failed_run)} <TokenTag source="estimate" /></span>} tone={data.efficiency.failed_runs > 0 ? "warn" : "default"} hint={`${data.efficiency.failed_runs} failed run(s)`} />
          </div>
        </section>
      )}
    </>
  );
}

// ── agents / workflows tabs ─────────────────────────────────────────────────

const NO_USAGE_HINT = "No usage recorded yet — usage appears as soon as chats/gateway runs are logged.";

function AgentsTab({ week, loading }: { week: UsageSummary | null; loading: boolean }) {
  if (loading && !week) return <Skeleton className="h-40" />;
  if (!week || week.by_agent.length === 0) return <EmptyState icon={Users} title="No agent usage" hint={NO_USAGE_HINT} tone="slate" />;
  return (
    <section className="glass p-4">
      <SectionLabel className="mb-2.5">Per agent — last 7 days</SectionLabel>
      <div className="space-y-1.5">
        {week.by_agent.map((a) => (
          <UsageRow key={a.key} name={a.key} runs={a.runs} tokens={a.tokens} failed={a.failed} source={a.is_actual_any ? "actual" : "estimate"} />
        ))}
      </div>
    </section>
  );
}

function WorkflowsTab({ week, loading }: { week: UsageSummary | null; loading: boolean }) {
  if (loading && !week) return <Skeleton className="h-40" />;
  const noWf = !week || week.by_workflow.length === 0;
  const noModel = !week || week.by_model.length === 0;
  if (noWf && noModel) return <EmptyState icon={GitBranch} title="No workflow usage" hint={NO_USAGE_HINT} tone="slate" />;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section className="glass p-4">
        <SectionLabel className="mb-2.5">Per workflow — last 7 days</SectionLabel>
        {noWf ? (
          <p className="text-xs text-white/30">No workflow usage recorded this week.</p>
        ) : (
          <div className="space-y-1.5">
            {week!.by_workflow.map((x) => (
              <UsageRow key={x.key} name={x.key} runs={x.runs} tokens={x.tokens} failed={x.failed} source="estimate" />
            ))}
          </div>
        )}
      </section>
      <section className="glass p-4">
        <SectionLabel className="mb-2.5 flex items-center gap-1.5"><Cpu className="size-3.5" /> Per model — last 7 days</SectionLabel>
        {noModel ? (
          <p className="text-xs text-white/30">No model usage recorded this week.</p>
        ) : (
          <div className="space-y-1.5">
            {week!.by_model.map((x) => (
              <UsageRow key={x.key} name={x.key} runs={x.runs} tokens={x.tokens} source="estimate" />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
