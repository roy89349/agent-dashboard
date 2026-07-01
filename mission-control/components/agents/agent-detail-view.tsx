"use client";
// Agent detail: overview · performance · memory · feedback · recent tasks. Memory is fully VISIBLE + editable
// (add / edit / disable / archive) — no black box. Feedback here mints memory too.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Brain, Trophy, MessageSquarePlus, ListChecks, Star, AlertTriangle, Ban, Trash2, Power } from "lucide-react";
import { AgentAvatar, RoleChip } from "@/components/fleet/agent-meta";
import { FeedbackButton, FEEDBACK_ACTIONS } from "./feedback-button";
import type { MemoryItem, MemoryType, FeedbackItem } from "@/lib/agent-memory";
import type { AgentPerf } from "@/lib/agent-performance";
import type { Agent } from "@/lib/types";

type Detail = { agent: Agent; team: { id: string; name: string } | null; performance: AgentPerf | null; memory: Record<MemoryType, MemoryItem[]>; feedback: FeedbackItem[]; recent: AgentPerf["last_10"] };
const MEMORY_TYPES: MemoryType[] = ["preference", "rule", "lesson", "warning", "strength", "weakness", "feedback"];
const TYPE_TONE: Record<string, string> = { rule: "text-indigo-300", warning: "text-red-300", strength: "text-emerald-300", weakness: "text-amber-300", preference: "text-teal-300", lesson: "text-white/60", feedback: "text-white/50" };
const TABS = ["overview", "performance", "memory", "feedback", "recent"] as const;
type Tab = (typeof TABS)[number];

export function AgentDetailView({ agentId }: { agentId: string }) {
  const [d, setD] = useState<Detail | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/agents/${agentId}`, { cache: "no-store" });
    if (r.ok) setD(await r.json()); else setNotFound(true);
  }, [agentId]);
  useEffect(() => { load(); }, [load]);

  if (notFound) return <div className="grid min-h-[50vh] place-items-center text-sm text-white/40">Agent not found.</div>;
  if (!d) return <div className="grid min-h-[50vh] place-items-center text-sm text-white/40">Loading…</div>;
  const p = d.performance;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-5 pb-24 sm:px-6 md:pb-5">
      <Link href="/agents" className="mb-3 inline-flex items-center gap-1 text-xs text-white/45 hover:text-white/80"><ArrowLeft className="size-3.5" /> Agents</Link>
      <div className="mb-4 flex items-center gap-3">
        <AgentAvatar name={d.agent.name} role={d.agent.role} className="size-10 text-sm" />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-white">{d.agent.name}</h2>
          <div className="flex items-center gap-1.5"><RoleChip role={d.agent.role} />{d.team && <span className="text-[11px] text-white/40">· {d.team.name}</span>}{!d.agent.enabled && <span className="rounded bg-white/10 px-1 text-[10px] text-white/40">disabled</span>}</div>
        </div>
        <FeedbackButton agentId={agentId} onDone={load} label="Give feedback" />
      </div>

      <div className="glass-inset mb-4 inline-flex max-w-full flex-wrap gap-1 rounded-xl p-1">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`min-h-9 rounded-lg px-3.5 text-xs font-medium capitalize transition-colors ${
              tab === t ? "bg-white/10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]" : "text-white/50 hover:bg-white/5 hover:text-white/80"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "overview" && <Overview d={d} />}
      {tab === "performance" && <Performance p={p} />}
      {tab === "memory" && <MemoryTab agentId={agentId} onChanged={load} />}
      {tab === "feedback" && <FeedbackTab feedback={d.feedback} />}
      {tab === "recent" && <Recent recent={d.recent} />}
    </div>
  );
}

function Overview({ d }: { d: Detail }) {
  const all = MEMORY_TYPES.flatMap((t) => d.memory[t]).filter((m) => m.enabled);
  const group = (t: MemoryType, icon: React.ReactNode) => d.memory[t].length > 0 && (
    <div key={t} className="glass-card p-3"><p className={`flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider ${TYPE_TONE[t]}`}>{icon} {t}</p>
      <ul className="mt-1 space-y-0.5">{d.memory[t].slice(0, 5).map((m) => <li key={m.id} className={`text-xs ${m.enabled ? "text-white/70" : "text-white/30 line-through"}`}>• {m.title}</li>)}</ul></div>
  );
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Success" value={d.performance ? `${d.performance.success_rate.value}%` : "—"} />
        <Stat label="Tasks done" value={d.performance?.tasks_done ?? 0} />
        <Stat label="Memory rules" value={all.length} />
        <Stat label="Feedback" value={d.feedback.length} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {group("strength", <Star className="size-3" />)}
        {group("weakness", <AlertTriangle className="size-3" />)}
        {group("rule", <ListChecks className="size-3" />)}
        {group("warning", <Ban className="size-3" />)}
        {group("preference", <Brain className="size-3" />)}
        {group("lesson", <Brain className="size-3" />)}
      </div>
      {all.length === 0 && <p className="text-sm text-white/35">No memory yet — give feedback or add memory to train this agent.</p>}
    </div>
  );
}

function Performance({ p }: { p: AgentPerf | null }) {
  if (!p) return <p className="text-sm text-white/40">No performance data.</p>;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Success" value={p.tasks_done + p.tasks_failed === 0 ? "—" : `${p.success_rate.value}%`} />
        <Stat label="Failure" value={`${p.failure_rate.value}%`} />
        <Stat label="Avg duration" value={`${p.avg_duration.value}${p.avg_duration.unit}`} />
        <Stat label="Done / failed" value={`${p.tasks_done} / ${p.tasks_failed}`} />
      </div>
      {p.best_collaborators.length > 0 && <p className="text-xs text-white/55">Works most with: {p.best_collaborators.map((c) => `${c.name} (${c.count})`).join(", ")}</p>}
      {p.top_skills.length > 0 && <p className="text-xs text-white/55">Skills: {p.top_skills.map((s) => s.name).join(", ")}</p>}
      {p.common_blockers.length > 0 && <div><p className="text-xs text-white/45">Common blockers:</p><ul className="pl-4 text-xs text-white/50">{p.common_blockers.map((b, i) => <li key={i} className="list-disc">{b.text} {b.count > 1 && <span className="text-white/30">×{b.count}</span>}</li>)}</ul></div>}
    </div>
  );
}

function MemoryTab({ agentId, onChanged }: { agentId: string; onChanged: () => void }) {
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [nt, setNt] = useState({ type: "rule" as MemoryType, title: "", content: "" });

  const load = useCallback(async () => {
    const r = await fetch(`/api/agents/${agentId}/memory${showArchived ? "?all=1" : ""}`, { cache: "no-store" });
    if (r.ok) setItems(((await r.json()).memory ?? []) as MemoryItem[]);
  }, [agentId, showArchived]);
  useEffect(() => { load(); }, [load]);
  const refresh = () => { load(); onChanged(); };

  async function add() {
    if (!nt.title.trim()) return toast.error("Title required");
    const r = await fetch(`/api/agents/${agentId}/memory`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(nt) });
    if (r.ok) { toast.success("Memory added"); setNt({ type: "rule", title: "", content: "" }); refresh(); } else toast.error("Failed");
  }
  async function patch(id: string, body: Record<string, unknown>) { const r = await fetch(`/api/agent-memory/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); if (r.ok) refresh(); }
  async function archive(id: string) { const r = await fetch(`/api/agent-memory/${id}`, { method: "DELETE" }); if (r.ok) { toast.success("Archived"); refresh(); } }

  return (
    <div className="space-y-3">
      <div className="glass-inset flex flex-wrap items-end gap-2 p-3">
        <select value={nt.type} onChange={(e) => setNt({ ...nt, type: e.target.value as MemoryType })} className="h-9 rounded-lg border border-white/10 bg-white/5 px-2 text-sm text-white outline-none capitalize">{MEMORY_TYPES.map((t) => <option key={t} value={t} className="bg-[#0d1322] capitalize">{t}</option>)}</select>
        <input value={nt.title} onChange={(e) => setNt({ ...nt, title: e.target.value })} placeholder="Memory (e.g. Never use library X)" className="h-9 min-w-40 flex-1 rounded-lg border border-white/10 bg-white/5 px-2.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-emerald-500/40" />
        <button onClick={add} className="h-11 rounded-lg bg-emerald-500 px-3.5 text-sm font-semibold text-black transition-colors hover:bg-emerald-400">Add</button>
      </div>
      <label className="flex items-center gap-1.5 text-xs text-white/50"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> show archived</label>
      {items.length === 0 ? <p className="text-sm text-white/35">No memory yet.</p> : (
        <ul className="space-y-1.5">
          {items.map((m) => (
            <li key={m.id} className={`glass-card flex items-start gap-2 p-2.5 ${m.archived ? "opacity-50" : m.enabled ? "" : "opacity-70"}`}>
              <span className={`mt-0.5 rounded px-1 text-[9px] uppercase ${TYPE_TONE[m.type]} border border-current/30`}>{m.type}</span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm ${m.enabled && !m.archived ? "text-white/85" : "text-white/40 line-through"}`}>{m.title}{m.archived && <span className="ml-1 text-[10px] text-white/30">archived</span>}</p>
                {m.content && <p className="text-[11px] text-white/45">{m.content}</p>}
                <p className="text-[10px] text-white/25">{m.source_type ?? "manual"}{m.source_ref ? ` · ${m.source_ref}` : ""}</p>
              </div>
              {m.archived ? (
                <button onClick={() => patch(m.id, { archived: false, enabled: true })} title="Restore" className="rounded px-1.5 py-1 text-[11px] text-emerald-300/80 hover:bg-white/10">Restore</button>
              ) : (
                <>
                  <button onClick={() => patch(m.id, { enabled: !m.enabled })} title={m.enabled ? "Disable" : "Enable"} className={`rounded p-1 ${m.enabled ? "text-emerald-400/70" : "text-white/30"} hover:bg-white/10`}><Power className="size-3.5" /></button>
                  <button onClick={() => archive(m.id)} title="Archive" className="rounded p-1 text-white/30 hover:bg-white/10 hover:text-rose-300"><Trash2 className="size-3.5" /></button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FeedbackTab({ feedback }: { feedback: FeedbackItem[] }) {
  const labelOf = (t: string) => FEEDBACK_ACTIONS.find((a) => a.type === t)?.label ?? t;
  return feedback.length === 0 ? <p className="text-sm text-white/35">No feedback yet — use the Give feedback button (it becomes memory).</p> : (
    <ul className="space-y-1.5">
      {feedback.map((f) => (
        <li key={f.id} className="glass-card flex items-center gap-2 p-2.5 text-xs">
          <span className={`inline-flex size-5 shrink-0 items-center justify-center rounded-full ${(f.rating ?? 0) > 0 ? "bg-emerald-500/20 text-emerald-300" : (f.rating ?? 0) < 0 ? "bg-red-500/20 text-red-300" : "bg-white/10 text-white/50"}`}>{(f.rating ?? 0) > 0 ? "+" : (f.rating ?? 0) < 0 ? "−" : "•"}</span>
          <span className="min-w-0 flex-1 truncate text-white/75">{labelOf(f.feedback_type)}{f.comment ? ` — ${f.comment}` : ""}</span>
          <span className="shrink-0 text-[10px] text-white/30">{new Date(f.created_at).toLocaleDateString()}</span>
        </li>
      ))}
    </ul>
  );
}

function Recent({ recent }: { recent: AgentPerf["last_10"] }) {
  return recent.length === 0 ? <p className="text-sm text-white/35">No recent tasks.</p> : (
    <ul className="space-y-1">
      {recent.map((t) => (
        <li key={t.work_item_id} className="glass-card flex items-center gap-2 px-3 py-2 text-xs">
          <span className={`size-2 rounded-full ${t.state === "done" ? "bg-emerald-400" : t.state === "failed" ? "bg-red-500" : t.state === "blocked" ? "bg-amber-400" : "bg-white/30"}`} />
          <span className="min-w-0 flex-1 truncate text-white/75">{t.title}</span>
          <span className="shrink-0 capitalize text-white/35">{t.state}</span>
        </li>
      ))}
    </ul>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="glass-card p-2.5"><p className="text-[10px] uppercase tracking-wider text-white/40">{label}</p><p className="mt-0.5 text-lg font-semibold tabular-nums text-white">{value}</p></div>;
}
