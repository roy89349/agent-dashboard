"use client";
// Shared analytics UI: metric cards with a real/derived/estimate honesty tag, an inline-SVG sparkline + bar list
// (no chart lib), a period/team/agent/workflow filter bar, and a facets hook. Type-only imports (no node:sqlite).
import { useEffect, useState } from "react";
import type { Metric, MetricSource, Period } from "@/lib/analytics-shared";
import type { Agent, Team } from "@/lib/types";
import type { Workflow } from "@/lib/workflows";

export const PERIODS: { v: Period; l: string }[] = [{ v: "today", l: "Today" }, { v: "week", l: "7 days" }, { v: "month", l: "30 days" }, { v: "all", l: "All time" }];

const SRC: Record<MetricSource, string> = {
  real: "border-emerald-500/30 text-emerald-300",
  derived: "border-amber-500/25 text-amber-300/80",
  estimate: "border-amber-500/40 bg-amber-500/10 text-amber-200",
};
export function SourceTag({ source }: { source: MetricSource }) {
  return <span className={`rounded border px-1 text-[9px] font-medium uppercase tracking-wide ${SRC[source]}`}>{source}</span>;
}

export function MetricCard({ m }: { m: Metric }) {
  return (
    <div className="glass-card p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] leading-tight text-white/45">{m.label}</p>
        <SourceTag source={m.source} />
      </div>
      <p className="mt-1 text-xl font-semibold tabular-nums text-white">{typeof m.value === "number" ? m.value.toLocaleString() : m.value}{m.unit ? <span className="ml-0.5 text-xs text-white/40">{m.unit}</span> : null}</p>
      {m.note && <p className="mt-0.5 text-[10px] text-white/30">{m.note}</p>}
    </div>
  );
}

export function Sparkline({ data, className }: { data: { day: string; count: number }[]; className?: string }) {
  if (data.length < 2) return null;
  const max = Math.max(1, ...data.map((d) => d.count));
  const w = 120, h = 28;
  const pts = data.map((d, i) => `${(i / (data.length - 1)) * w},${h - (d.count / max) * (h - 2) - 1}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className ?? "h-8 w-full text-emerald-400/70"} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Bars({ rows, unit }: { rows: { label: string; value: number }[]; unit?: string }) {
  if (rows.length === 0) return <p className="text-xs text-white/30">No data yet.</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span className="w-32 shrink-0 truncate text-white/60" title={r.label}>{r.label}</span>
          <span className="h-2.5 rounded-full bg-gradient-to-r from-emerald-500/60 to-indigo-500/40 shadow-[0_0_8px_rgba(16,185,129,0.15)]" style={{ width: `${Math.max(r.value ? 3 : 0, (r.value / max) * 100)}%` }} />
          <span className="ml-auto shrink-0 tabular-nums text-white/45">{r.value.toLocaleString()}{unit ?? ""}</span>
        </div>
      ))}
    </div>
  );
}

export function Select({ value, onChange, opts, allLabel }: { value: string; onChange: (v: string) => void; opts: { v: string; l: string }[]; allLabel?: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="h-9 rounded-lg border border-white/10 bg-white/[0.06] px-2 text-xs text-white outline-none backdrop-blur-md focus:border-emerald-500/40">
      {allLabel && <option value="all" className="bg-[#0d1322]">{allLabel}</option>}
      {opts.map((o) => <option key={o.v} value={o.v} className="bg-[#0d1322]">{o.l}</option>)}
    </select>
  );
}

export function useFacets() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  useEffect(() => {
    fetch("/api/teams", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => setTeams(j?.teams ?? [])).catch(() => {});
    fetch("/api/agents", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => setAgents(j?.agents ?? [])).catch(() => {});
    fetch("/api/workflows", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => setWorkflows(j?.workflows ?? [])).catch(() => {});
  }, []);
  return { teams, agents, workflows };
}
