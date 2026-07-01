"use client";
// The War Room: one live control-room screen — fleet health, every agent's activity by status, and a
// smart-grouped event timeline with filters + click-through context. Polls ONE endpoint (useWarRoom); all
// filtering is client-side over that snapshot. No shell-out, no per-row network.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Radio, Users, GitBranch, Inbox, Ban, GitPullRequest, ShieldAlert, Activity, Layers, ClipboardList,
  Smartphone, Bug, Zap, Clock, ChevronRight, Gauge, AlertTriangle,
} from "lucide-react";
import { AgentAvatar, RoleChip } from "@/components/fleet/agent-meta";
import type { WarRoomSnapshot, AgentActivity, WarEvent, AgentLiveStatus, EventSeverity } from "@/lib/war-room";
import { useWarRoom } from "./use-war-room";

const STATUS_META: Record<AgentLiveStatus, { label: string; dot: string; text: string }> = {
  working: { label: "Working", dot: "bg-indigo-400", text: "text-indigo-300" },
  blocked: { label: "Blocked", dot: "bg-red-500", text: "text-red-300" },
  waiting_review: { label: "Waiting review", dot: "bg-teal-400", text: "text-teal-300" },
  waiting_user: { label: "Waiting on you", dot: "bg-amber-400", text: "text-amber-300" },
  failed: { label: "Failed", dot: "bg-rose-500", text: "text-rose-300" },
  done: { label: "Done", dot: "bg-emerald-400", text: "text-emerald-300" },
  sleeping: { label: "Sleeping", dot: "bg-white/25", text: "text-white/40" },
};
const STATUS_ORDER: AgentLiveStatus[] = ["working", "waiting_user", "blocked", "waiting_review", "failed", "done", "sleeping"];
const SEV_DOT: Record<EventSeverity, string> = { danger: "bg-red-500", warn: "bg-amber-400", success: "bg-emerald-400", info: "bg-white/30" };
const CAT_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  task: Bug, work_item: Layers, plan: ClipboardList, decision: Inbox, workflow: GitBranch, phone: Smartphone, fleet: Radio, security: ShieldAlert, system: Activity,
};

function rel(ts: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(ts)) / 1000);
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const ALL = "all";
type Filters = { team: string; agent: string; role: string; workflow: string; severity: string; status: string };

export function WarRoomView() {
  const { snap, error } = useWarRoom();
  const [f, setF] = useState<Filters>({ team: ALL, agent: ALL, role: ALL, workflow: ALL, severity: ALL, status: ALL });
  const [repo, setRepo] = useState<string | null>(null);
  const [openEvent, setOpenEvent] = useState<string | null>(null);

  useEffect(() => { fetch("/api/config", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((c) => setRepo(c?.repo ?? null)).catch(() => {}); }, []);

  const agents = useMemo(() => (snap?.agents ?? []).filter((a) =>
    (f.team === ALL || a.team === f.team) && (f.agent === ALL || a.id === f.agent) && (f.role === ALL || a.role === f.role) && (f.status === ALL || a.status === f.status),
  ), [snap, f]);

  const events = useMemo(() => (snap?.events ?? []).filter((e) =>
    (f.severity === ALL || e.severity === f.severity) && (f.workflow === ALL || e.workflow_id === f.workflow) &&
    (f.role === ALL || e.role === f.role) && (f.agent === ALL || e.agent_id === f.agent) && (f.team === ALL || e.team === f.team),
  ), [snap, f]);

  const agentsByStatus = useMemo(() => {
    const by = new Map<AgentLiveStatus, AgentActivity[]>();
    for (const a of agents) { if (!by.has(a.status)) by.set(a.status, []); by.get(a.status)!.push(a); }
    return STATUS_ORDER.filter((s) => by.has(s)).map((s) => ({ status: s, items: by.get(s)! }));
  }, [agents]);

  if (!snap) return <div className="grid min-h-[60vh] place-items-center text-sm text-white/40">{error ? "War Room unreachable." : "Loading the floor…"}</div>;
  const h = snap.health;

  const sel = (v: string, on: (v: string) => void, opts: { v: string; label: string }[], allLabel: string) => (
    <select value={v} onChange={(e) => on(e.target.value)} className="h-8 rounded-lg border border-white/10 bg-white/5 px-2 text-xs text-white outline-none">
      <option value={ALL} className="bg-[#0d1322]">{allLabel}</option>
      {opts.map((o) => <option key={o.v} value={o.v} className="bg-[#0d1322]">{o.label}</option>)}
    </select>
  );

  return (
    <div className="mx-auto w-full max-w-7xl px-3 py-4 pb-24 sm:px-5 md:pb-5">
      {/* ── fleet health strip ── */}
      <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
        <Tile icon={Radio} label="Fleet" value={h.mode} tone={h.online ? "emerald" : h.mode === "stopped" ? "rose" : "amber"} sub={h.online ? "online" : "offline"} />
        <Tile icon={Zap} label="Workers" value={`${h.workers.active}${h.workers.max ? `/${h.workers.max}` : ""}`} tone="slate" />
        <Tile icon={Users} label="Agents" value={`${h.agents.active}/${h.agents.total}`} tone="slate" sub="active" />
        <Tile icon={GitBranch} label="Workflows" value={h.workflows_running} tone={h.workflows_running ? "indigo" : "slate"} />
        <Tile icon={Inbox} label="Decisions" value={h.open_decisions} tone={h.open_decisions ? "amber" : "slate"} />
        <Tile icon={Ban} label="Blockers" value={h.blockers} tone={h.blockers ? "rose" : "slate"} />
        <Tile icon={GitPullRequest} label="PRs ready" value={h.prs_ready} tone={h.prs_ready ? "emerald" : "slate"} />
        <Tile icon={ShieldAlert} label="Breaker" value={h.breaker.tripped ? "tripped" : "ok"} tone={h.breaker.tripped ? "rose" : "emerald"} sub={h.breaker.fails ? `${h.breaker.fails} fails` : undefined} />
        <Tile icon={Gauge} label="Budget" value={h.budget_warning ?? "ok"} tone={h.budget_warning ? "amber" : "slate"} />
      </div>

      {/* ── filters ── */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {sel(f.status, (v) => setF({ ...f, status: v }), STATUS_ORDER.map((s) => ({ v: s, label: STATUS_META[s].label })), "All status")}
        {sel(f.team, (v) => setF({ ...f, team: v }), (snap.facets.teams ?? []).map((t) => ({ v: t, label: t })), "All teams")}
        {sel(f.agent, (v) => setF({ ...f, agent: v }), snap.facets.agents.map((a) => ({ v: a.id, label: a.name })), "All agents")}
        {sel(f.role, (v) => setF({ ...f, role: v }), snap.facets.roles.map((r) => ({ v: r, label: r })), "All roles")}
        {sel(f.workflow, (v) => setF({ ...f, workflow: v }), snap.facets.workflows.map((w) => ({ v: w.id, label: w.title })), "All workflows")}
        {sel(f.severity, (v) => setF({ ...f, severity: v }), snap.facets.severities.map((s) => ({ v: s, label: s })), "All severity")}
        <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-white/30"><span className="size-1.5 animate-pulse rounded-full bg-emerald-400" /> live · updated {rel(snap.generated_at)} ago</span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        {/* ── agent overview ── */}
        <section>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {STATUS_ORDER.filter((s) => (snap.buckets[s] ?? 0) > 0).map((s) => (
              <button key={s} onClick={() => setF({ ...f, status: f.status === s ? ALL : s })} className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${f.status === s ? "border-white/30 bg-white/10 text-white" : "border-white/10 text-white/60 hover:bg-white/5"}`}>
                <span className={`size-2 rounded-full ${STATUS_META[s].dot}`} /> {STATUS_META[s].label} <span className="tabular-nums text-white/40">{snap.buckets[s]}</span>
              </button>
            ))}
          </div>
          {agents.length === 0 ? (
            <p className="rounded-xl border border-white/10 bg-white/[0.02] p-6 text-center text-sm text-white/40">No agents match this filter.</p>
          ) : (
            <div className="space-y-4">
              {agentsByStatus.map((g) => (
                <div key={g.status}>
                  <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/40"><span className={`size-2 rounded-full ${STATUS_META[g.status].dot}`} /> {STATUS_META[g.status].label} <span className="text-white/25">{g.items.length}</span></p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {g.items.map((a) => <AgentCard key={a.id} a={a} />)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── timeline ── */}
        <section>
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/40"><Activity className="size-3.5" /> Timeline <span className="text-white/25">{events.length}</span></p>
          {events.length === 0 ? (
            <p className="rounded-xl border border-white/10 bg-white/[0.02] p-6 text-center text-sm text-white/40">No events match this filter.</p>
          ) : (
            <ol className="space-y-0.5">
              {events.map((e) => <EventRow key={e.id} e={e} repo={repo} open={openEvent === e.id} onToggle={() => setOpenEvent(openEvent === e.id ? null : e.id)} />)}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}

const TILE_TONE: Record<string, string> = {
  emerald: "border-emerald-500/25 text-emerald-300", indigo: "border-indigo-500/25 text-indigo-300",
  amber: "border-amber-500/25 text-amber-300", rose: "border-rose-500/25 text-rose-300", slate: "border-white/10 text-white/70",
};
function Tile({ icon: Icon, label, value, tone, sub }: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode; tone: string; sub?: string }) {
  return (
    <div className={`rounded-xl border bg-white/[0.02] px-2.5 py-2 ${TILE_TONE[tone] ?? TILE_TONE.slate}`}>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-white/40"><Icon className="size-3" /> {label}</div>
      <div className="mt-0.5 truncate text-sm font-semibold capitalize tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-white/30">{sub}</div>}
    </div>
  );
}

function AgentCard({ a }: { a: AgentActivity }) {
  const m = STATUS_META[a.status];
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
      <div className="flex items-center gap-2">
        <AgentAvatar name={a.name} role={a.role} className="size-6 text-[10px]" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white/90">{a.name}</p>
          <div className="flex items-center gap-1"><RoleChip role={a.role} />{a.team && <span className="text-[10px] text-white/30">· {a.team}</span>}</div>
        </div>
        <span className={`inline-flex items-center gap-1 text-[10px] ${m.text}`}><span className={`size-2 rounded-full ${m.dot}`} />{a.waiting_approval && <AlertTriangle className="size-3 text-amber-300" />}</span>
      </div>
      {a.task && <p className="mt-1.5 truncate text-[11px] text-white/60">{a.task}</p>}
      <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10px] text-white/35">
        {a.phase && <span className="capitalize">{String(a.phase).replace(/_/g, " ")}</span>}
        {a.workflow_step && <span className="inline-flex items-center gap-0.5"><GitBranch className="size-2.5" /> {a.workflow_step}</span>}
        {a.busy_since && a.status !== "sleeping" && <span className="inline-flex items-center gap-0.5"><Clock className="size-2.5" /> {rel(a.busy_since)}</span>}
        {a.budget && <span>{a.budget}</span>}
      </div>
      {a.last_event && <p className="mt-1 truncate text-[10px] text-white/30">↳ {a.last_event.title} · {rel(a.last_event.ts)} ago</p>}
    </div>
  );
}

function EventRow({ e, repo, open, onToggle }: { e: WarEvent; repo: string | null; open: boolean; onToggle: () => void }) {
  const Icon = CAT_ICON[e.category] ?? Activity;
  const gh = (n: number, kind: "issues" | "pull") => (repo ? `https://github.com/${repo}/${kind}/${n}` : null);
  const links: { href: string; label: string; external?: boolean }[] = [];
  if (e.work_item_id) links.push({ href: "/work-items", label: "Work item" });
  if (e.workflow_id) links.push({ href: "/workflows", label: "Workflow" });
  if (e.approval_id) links.push({ href: "/approvals", label: "Decision" });
  if (e.issue != null && gh(e.issue, "issues")) links.push({ href: gh(e.issue, "issues")!, label: `Issue #${e.issue}`, external: true });
  if (e.pr != null && gh(e.pr, "pull")) links.push({ href: gh(e.pr, "pull")!, label: `PR #${e.pr}`, external: true });
  if (e.agent_id) links.push({ href: "/agents", label: "Agent" });
  return (
    <li className={`rounded-lg ${open ? "bg-white/[0.04]" : "hover:bg-white/[0.02]"}`}>
      <button onClick={onToggle} className="flex w-full items-center gap-2 px-2 py-1.5 text-left">
        <span className={`size-2 shrink-0 rounded-full ${SEV_DOT[e.severity]}`} />
        <Icon className="size-3.5 shrink-0 text-white/35" />
        <span className="min-w-0 flex-1 truncate text-[12px] text-white/80">{e.title}{e.count > 1 && <span className="ml-1 rounded bg-white/10 px-1 text-[10px] text-white/50">×{e.count}</span>}</span>
        {e.role && <span className="hidden shrink-0 text-[10px] text-white/30 sm:inline">{e.role}</span>}
        <span className="shrink-0 text-[10px] tabular-nums text-white/30">{rel(e.ts)}</span>
        <ChevronRight className={`size-3 shrink-0 text-white/25 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="flex flex-wrap items-center gap-1.5 px-8 pb-2">
          {links.length === 0 ? <span className="text-[10px] text-white/30">no linked context</span> : links.map((l) => (
            l.external
              ? <a key={l.label} href={l.href} target="_blank" rel="noreferrer" className="rounded-md border border-white/10 px-2 py-0.5 text-[10px] text-emerald-300 hover:bg-white/5">{l.label} ↗</a>
              : <Link key={l.label} href={l.href} className="rounded-md border border-white/10 px-2 py-0.5 text-[10px] text-white/70 hover:bg-white/5">{l.label}</Link>
          ))}
          {e.actor && <span className="text-[10px] text-white/25">by {e.actor}</span>}
        </div>
      )}
    </li>
  );
}
