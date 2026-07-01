"use client";
import { useCallback, useEffect, useState } from "react";
import { BarChart3, RefreshCw, TrendingUp } from "lucide-react";
import { MetricCard, Sparkline, Select, PERIODS, useFacets } from "./parts";
import type { KpiReport } from "@/lib/kpis";
import type { Period } from "@/lib/analytics-shared";

export function KpisView() {
  const [rep, setRep] = useState<KpiReport | null>(null);
  const [period, setPeriod] = useState<Period>("week");
  const [team, setTeam] = useState("all");
  const [agent, setAgent] = useState("all");
  const [wf, setWf] = useState("all");
  const { teams, agents, workflows } = useFacets();

  const load = useCallback(async () => {
    const p = new URLSearchParams({ period });
    if (team !== "all") p.set("team_id", team);
    if (agent !== "all") p.set("agent_id", agent);
    if (wf !== "all") p.set("workflow_id", wf);
    const r = await fetch(`/api/analytics/kpis?${p}`, { cache: "no-store" });
    if (r.ok) setRep(await r.json());
  }, [period, team, agent, wf]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 pb-24 sm:px-6 md:pb-5">
      <div className="mb-4 flex items-center gap-3">
        <div className="grid size-9 place-items-center rounded-xl border border-white/10 bg-white/5 text-emerald-300"><BarChart3 className="size-[18px]" /></div>
        <div><h2 className="text-base font-semibold text-white">KPIs</h2><p className="text-xs text-white/40">Productivity · quality · speed — labelled real vs derived</p></div>
        <button onClick={load} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/50 hover:bg-white/5"><RefreshCw className="size-3.5" /></button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <Select value={period} onChange={(v) => setPeriod(v as Period)} opts={PERIODS} />
        <Select value={team} onChange={setTeam} opts={teams.map((t) => ({ v: t.id, l: t.name }))} allLabel="All teams" />
        <Select value={agent} onChange={setAgent} opts={agents.map((a) => ({ v: a.id, l: a.name }))} allLabel="All agents" />
        <Select value={wf} onChange={setWf} opts={workflows.map((w) => ({ v: w.id, l: w.title }))} allLabel="All workflows" />
      </div>

      {!rep ? <p className="text-sm text-white/40">Loading…</p> : (
        <div className="space-y-5">
          <Section title="Productivity" metrics={rep.productivity} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <p className="mb-1 flex items-center gap-1 text-[11px] text-white/45"><TrendingUp className="size-3" /> Tasks completed / day (7d)</p>
              <Sparkline data={rep.trends.tasks_done} />
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <p className="mb-1 flex items-center gap-1 text-[11px] text-white/45"><TrendingUp className="size-3" /> Workflows completed / day (7d)</p>
              <Sparkline data={rep.trends.workflows_done} className="h-8 w-full text-indigo-400/70" />
            </div>
          </div>
          <Section title="Quality" metrics={rep.quality} />
          <Section title="Speed" metrics={rep.speed} />
        </div>
      )}
    </div>
  );
}

function Section({ title, metrics }: { title: string; metrics: KpiReport["productivity"] }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/45">{title}</h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">{metrics.map((m) => <MetricCard key={m.key} m={m} />)}</div>
    </section>
  );
}
