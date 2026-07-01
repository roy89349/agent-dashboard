"use client";
import { useCallback, useEffect, useState } from "react";
import { Trophy, RefreshCw, CheckCircle2, Clock, Users, Boxes, Ban } from "lucide-react";
import { AgentAvatar, RoleChip } from "@/components/fleet/agent-meta";
import { SourceTag } from "./parts";
import type { PerformanceReport } from "@/lib/agent-performance";

export function PerformanceView() {
  const [rep, setRep] = useState<PerformanceReport | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await fetch("/api/analytics/performance", { cache: "no-store" });
    if (r.ok) setRep(await r.json());
  }, []);
  useEffect(() => { load(); }, [load]);

  const active = rep?.agents.filter((a) => a.tasks_total > 0) ?? [];

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 pb-24 sm:px-6 md:pb-5">
      <div className="mb-4 flex items-center gap-3">
        <div className="glass-card grid size-10 place-items-center text-emerald-300"><Trophy className="size-[18px]" /></div>
        <div><h2 className="text-base font-semibold tracking-tight text-white">Agent performance</h2><p className="text-xs text-white/40">Success · duration · blockers · collaboration <SourceTag source="derived" /></p></div>
        <button onClick={load} aria-label="Refresh" className="glass-card glass-hover ml-auto grid size-10 place-items-center text-white/50 hover:text-white/80"><RefreshCw className="size-4" /></button>
      </div>

      {!rep ? <p className="text-sm text-white/40">Loading…</p> : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          {/* leaderboard */}
          <section className="glass p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/45">Leaderboard · tasks done</p>
            {active.length === 0 ? <p className="text-xs text-white/30">No completed tasks yet.</p> : (
              <div className="space-y-1.5">
                {[...active].sort((a, b) => b.tasks_done - a.tasks_done).slice(0, 12).map((a, i) => {
                  const max = Math.max(1, ...active.map((x) => x.tasks_done));
                  return (
                    <div key={a.id} className="glass-card flex items-center gap-2.5 px-2.5 py-2">
                      <span className={`w-5 shrink-0 text-center text-xs font-semibold tabular-nums ${i === 0 ? "text-amber-300" : i < 3 ? "text-white/70" : "text-white/35"}`}>{i + 1}</span>
                      <AgentAvatar name={a.name} role={a.role} className="size-6 shrink-0 text-[10px]" />
                      <span className="min-w-0 flex-1 truncate text-xs text-white/75" title={a.name}>{a.name}</span>
                      <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-black/25 sm:block"><span className="block h-full rounded-full bg-gradient-to-r from-emerald-500/60 to-indigo-500/40" style={{ width: `${Math.max(a.tasks_done ? 6 : 0, (a.tasks_done / max) * 100)}%` }} /></span>
                      <span className="shrink-0 text-xs font-medium tabular-nums text-emerald-300">{a.tasks_done}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* per-agent cards */}
          <section className="space-y-2">
            {(active.length ? active : rep.agents).map((a) => (
              <article key={a.id} className="glass-card glass-hover p-3">
                <button onClick={() => setOpen(open === a.id ? null : a.id)} className="flex w-full items-center gap-2 text-left">
                  <AgentAvatar name={a.name} role={a.role} className="size-6 text-[10px]" />
                  <span className="min-w-0"><span className="text-sm font-medium text-white/90">{a.name}</span> <RoleChip role={a.role} /></span>
                  <span className="ml-auto flex items-center gap-2 text-[11px]">
                    {a.tasks_done + a.tasks_failed === 0
                      ? <span className="text-white/30" title="no finished tasks yet">—</span>
                      : <span className="inline-flex items-center gap-0.5 text-emerald-300"><CheckCircle2 className="size-3" /> {a.success_rate.value}%</span>}
                    <span className="inline-flex items-center gap-0.5 text-white/40"><Clock className="size-3" /> {a.avg_duration.value}{a.avg_duration.unit}</span>
                  </span>
                </button>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/40">
                  <span>{a.tasks_done}✓ / {a.tasks_failed}✗ of {a.tasks_total}</span>
                  {a.team && <span>{a.team}</span>}
                  {a.feedback_score == null && <span className="text-white/25">no feedback signal</span>}
                </div>
                {open === a.id && (
                  <div className="mt-2 space-y-2 border-t border-white/10 pt-2 text-[11px]">
                    {a.last_10.length > 0 && <div><p className="mb-0.5 text-white/40">Last tasks</p><ul className="space-y-0.5">{a.last_10.slice(0, 6).map((t) => <li key={t.work_item_id} className="flex items-center gap-1.5 text-white/60"><span className={`size-1.5 rounded-full ${t.state === "done" ? "bg-emerald-400" : t.state === "failed" ? "bg-red-500" : t.state === "blocked" ? "bg-amber-400" : "bg-white/30"}`} /><span className="truncate">{t.title}</span></li>)}</ul></div>}
                    {a.best_collaborators.length > 0 && <p className="text-white/50"><Users className="mr-1 inline size-3" />Works most with: {a.best_collaborators.map((c) => `${c.name} (${c.count})`).join(", ")}</p>}
                    {a.top_skills.length > 0 && <p className="text-white/50"><Boxes className="mr-1 inline size-3" />Skills: {a.top_skills.map((s) => s.name).join(", ")}</p>}
                    {a.common_blockers.length > 0 && <div><p className="text-white/50"><Ban className="mr-1 inline size-3" />Common blockers:</p><ul className="pl-4">{a.common_blockers.map((b, i) => <li key={i} className="list-disc text-white/45">{b.text} {b.count > 1 && <span className="text-white/30">×{b.count}</span>}</li>)}</ul></div>}
                  </div>
                )}
              </article>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}
