"use client";
// Audit Log: a filterable, searchable, exportable table of every important action — who/what did what, why, with
// which approval, via which channel, at what risk. Values are redacted at write time; this is read-only.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ShieldCheck, Search, Download, X, RefreshCw, ExternalLink, EyeOff } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/badge";
import type { AuditEvent } from "@/lib/audit";

const ACTOR_TYPES = ["user", "agent", "system", "phone", "api"];
const STATUSES = ["allowed", "denied", "pending_approval", "approved", "rejected", "failed"];
const SOURCES = ["dashboard", "phone", "telegram", "whatsapp", "worker", "supervisor", "api"];
const RISKS = ["low", "medium", "high", "critical"];
const RISK_BADGE: Record<string, Tone> = { low: "emerald", medium: "amber", high: "rose", critical: "red" };
const STATUS_BADGE: Record<string, Tone> = { allowed: "emerald", approved: "emerald", denied: "red", rejected: "red", failed: "red", pending_approval: "amber" };

type Filters = { q: string; actor_type: string; action: string; risk_level: string; status: string; source: string; agent_id: string; from: string; to: string };
const EMPTY: Filters = { q: "", actor_type: "", action: "", risk_level: "", status: "", source: "", agent_id: "", from: "", to: "" };

export function AuditView() {
  const [f, setF] = useState<Filters>(EMPTY);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<AuditEvent | null>(null);
  const [loading, setLoading] = useState(false);
  const LIMIT = 50;

  const qs = useCallback((extra: Record<string, string | number> = {}) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) {
      if (!v) continue;
      if (k === "from" || k === "to") {
        // the picked date is LOCAL; turn it into the right UTC instant for the day's start/end boundary
        const d = new Date(v + (k === "from" ? "T00:00:00" : "T23:59:59.999"));
        if (!isNaN(d.getTime())) p.set(k, d.toISOString());
      } else p.set(k, v);
    }
    for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
    return p.toString();
  }, [f]);

  const load = useCallback(async (off: number) => {
    setLoading(true);
    const r = await fetch(`/api/audit?${qs({ limit: LIMIT, offset: off })}`, { cache: "no-store" });
    setLoading(false);
    if (r.ok) { const j = await r.json(); setEvents(off === 0 ? j.events : (prev) => [...prev, ...j.events]); setTotal(j.total); setOffset(off); }
  }, [qs]);
  useEffect(() => { const t = setTimeout(() => load(0), 250); return () => clearTimeout(t); }, [load]);

  const active = Object.values(f).some(Boolean);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5 pb-24 sm:px-6 md:pb-5">
      <div className="mb-4 flex items-center gap-3">
        <div className="glass-card grid size-9 shrink-0 place-items-center text-emerald-300"><ShieldCheck className="size-[18px]" /></div>
        <div className="min-w-0 flex-1"><h2 className="text-base font-semibold tracking-tight text-white">Audit Log</h2><p className="text-xs text-white/40">{total.toLocaleString()} events · append-only · redacted</p></div>
        <a href={`/api/audit/export?format=json&${qs()}`} className="glass-card glass-hover inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-white/60 hover:text-white/90"><Download className="size-3.5" /> JSON</a>
        <a href={`/api/audit/export?format=csv&${qs()}`} className="glass-card glass-hover inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-white/60 hover:text-white/90"><Download className="size-3.5" /> CSV</a>
      </div>

      {/* filters */}
      <div className="glass-card mb-3 flex flex-wrap items-center gap-1.5 p-2">
        <div className="relative min-w-40 flex-1">
          <Search className="pointer-events-none absolute left-2 top-2 size-3.5 text-white/30" />
          <input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Search action, actor, summary…" className="h-8 w-full rounded-lg border border-white/10 bg-white/5 pl-7 pr-2 text-xs text-white placeholder:text-white/30 outline-none transition-colors focus:border-emerald-500/40" />
        </div>
        <Sel v={f.actor_type} set={(v) => setF({ ...f, actor_type: v })} opts={ACTOR_TYPES} all="actor" />
        <Sel v={f.status} set={(v) => setF({ ...f, status: v })} opts={STATUSES} all="status" />
        <Sel v={f.risk_level} set={(v) => setF({ ...f, risk_level: v })} opts={RISKS} all="risk" />
        <Sel v={f.source} set={(v) => setF({ ...f, source: v })} opts={SOURCES} all="source" />
        <input value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} placeholder="action (e.g. workflow.)" className="h-8 w-32 rounded-lg border border-white/10 bg-white/5 px-2 text-xs text-white placeholder:text-white/30 outline-none transition-colors focus:border-emerald-500/40" />
        <input value={f.agent_id} onChange={(e) => setF({ ...f, agent_id: e.target.value })} placeholder="agent id" className="h-8 w-24 rounded-lg border border-white/10 bg-white/5 px-2 text-xs text-white placeholder:text-white/30 outline-none transition-colors focus:border-emerald-500/40" />
        <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className="h-8 rounded-lg border border-white/10 bg-white/5 px-2 text-xs text-white outline-none transition-colors focus:border-emerald-500/40" title="from" />
        <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className="h-8 rounded-lg border border-white/10 bg-white/5 px-2 text-xs text-white outline-none transition-colors focus:border-emerald-500/40" title="to" />
        {active && <button onClick={() => setF(EMPTY)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-white/40 transition-colors hover:bg-white/5 hover:text-white/70"><X className="size-3.5" /> clear</button>}
        <button onClick={() => load(0)} className="rounded-lg border border-white/10 p-1.5 text-white/40 transition-colors hover:bg-white/5 hover:text-white/70"><RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} /></button>
      </div>

      {/* table */}
      <div className="glass overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="bg-white/[0.03] text-[10px] uppercase tracking-wider text-white/40">
              <tr><th className="px-3 py-2 font-semibold">Time</th><th className="px-3 py-2 font-semibold">Actor</th><th className="px-3 py-2 font-semibold">Action</th><th className="hidden px-3 py-2 font-semibold sm:table-cell">Target</th><th className="px-3 py-2 font-semibold">Risk</th><th className="px-3 py-2 font-semibold">Status</th><th className="hidden px-3 py-2 font-semibold md:table-cell">Source</th></tr>
            </thead>
            <tbody>
              {events.length === 0 ? <tr><td colSpan={7} className="px-3 py-8 text-center text-white/30">No events.</td></tr> : events.map((e) => (
                <tr key={e.id} onClick={() => setSelected(e)} className="cursor-pointer border-t border-white/5 transition-colors hover:bg-white/[0.04]">
                  <td className="whitespace-nowrap px-3 py-2 text-white/50">{new Date(e.created_at).toLocaleString()}</td>
                  <td className="px-3 py-2"><span className="text-white/75">{e.actor_label ?? e.actor_id ?? "—"}</span> <span className="text-[10px] text-white/30">{e.actor_type}</span></td>
                  <td className="px-3 py-2 font-medium text-white/85">{e.action}</td>
                  <td className="hidden px-3 py-2 text-white/50 sm:table-cell">{e.target_type ? `${e.target_type}${e.target_id ? `:${e.target_id}` : ""}` : "—"}</td>
                  <td className="px-3 py-2">{e.risk_level ? <Badge tone={RISK_BADGE[e.risk_level] ?? "slate"}>{e.risk_level}</Badge> : <span className="text-white/30">—</span>}</td>
                  <td className="px-3 py-2">{e.status ? <Badge tone={STATUS_BADGE[e.status] ?? "slate"}>{e.status}</Badge> : <span className="text-white/30">—</span>}</td>
                  <td className="hidden px-3 py-2 md:table-cell">{e.source ? <Badge tone="slate">{e.source}</Badge> : <span className="text-white/30">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {events.length < total && <button onClick={() => load(offset + LIMIT)} className="glass-card glass-hover mx-auto mt-3 block px-4 py-1.5 text-xs font-medium text-white/60 hover:text-white/90">Load more ({events.length}/{total})</button>}

      {selected && <Drawer event={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function Sel({ v, set, opts, all }: { v: string; set: (v: string) => void; opts: string[]; all: string }) {
  return <select value={v} onChange={(e) => set(e.target.value)} className="h-8 rounded-lg border border-white/10 bg-white/5 px-1.5 text-xs text-white outline-none transition-colors focus:border-emerald-500/40"><option value="" className="bg-[#0d1322]">{all}</option>{opts.map((o) => <option key={o} value={o} className="bg-[#0d1322]">{o}</option>)}</select>;
}

function Drawer({ event: e, onClose }: { event: AuditEvent; onClose: () => void }) {
  const links: { label: string; href: string }[] = [];
  if (e.related_approval_id) links.push({ label: `Approval ${e.related_approval_id.slice(0, 8)}`, href: "/approvals" });
  if (e.related_work_item_id) links.push({ label: "Work item", href: "/work-items" });
  if (e.related_workflow_id) links.push({ label: "Workflow", href: "/workflows" });
  const agentId = e.target_type === "agent" ? e.target_id : e.actor_type === "agent" ? e.actor_id : null;
  if (agentId) links.push({ label: `Agent ${agentId}`, href: `/agents/${agentId}` });
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <aside className="glass-overlay fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col overflow-y-auto border-y-0 border-r-0 p-4">
        <div className="mb-3 flex items-center gap-2"><span className="text-sm font-semibold text-white">{e.action}</span><button onClick={onClose} className="ml-auto rounded-lg p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white/80"><X className="size-4" /></button></div>
        <dl className="space-y-1.5 text-xs">
          <Row k="Time" v={new Date(e.created_at).toLocaleString()} />
          <Row k="Actor" v={`${e.actor_label ?? e.actor_id ?? "—"} (${e.actor_type ?? "?"})`} />
          <Row k="Target" v={e.target_type ? `${e.target_type}${e.target_id ? `:${e.target_id}` : ""}` : "—"} />
          <Row k="Risk" v={e.risk_level ? <Badge tone={RISK_BADGE[e.risk_level] ?? "slate"}>{e.risk_level}</Badge> : "—"} />
          <Row k="Status" v={e.status ? <Badge tone={STATUS_BADGE[e.status] ?? "slate"}>{e.status}</Badge> : "—"} />
          <Row k="Source" v={e.source ? <Badge tone="slate">{e.source}</Badge> : "—"} />
          {(e.related_pr != null) && <Row k="PR" v={`#${e.related_pr}`} />}
          {(e.related_issue != null) && <Row k="Issue" v={`#${e.related_issue}`} />}
        </dl>
        {links.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">{links.map((l, i) => <Link key={i} href={l.href} className="glass-card glass-hover inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-emerald-300">{l.label} <ExternalLink className="size-3" /></Link>)}</div>
        )}
        {e.redacted_summary && <Block title="Summary" body={e.redacted_summary} />}
        {e.old_value_json && <Block title="Old value" body={e.old_value_json} redacted />}
        {e.new_value_json && <Block title="New value" body={e.new_value_json} redacted />}
        {e.details_json && e.details_json !== e.redacted_summary && <Block title="Details" body={e.details_json} redacted />}
        <p className="mt-3 text-[10px] text-white/25">id: {e.id}</p>
      </aside>
    </>
  );
}
function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex items-center gap-2"><dt className="w-20 shrink-0 text-white/35">{k}</dt><dd className="text-white/75">{v}</dd></div>;
}
function Block({ title, body, redacted }: { title: string; body: string; redacted?: boolean }) {
  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center gap-1.5">
        <p className="text-[10px] uppercase tracking-wider text-white/35">{title}</p>
        {redacted && <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-1.5 py-px text-[9px] uppercase tracking-wider text-white/40"><EyeOff className="size-2.5" /> redacted</span>}
      </div>
      <pre className="glass-inset max-h-40 overflow-auto whitespace-pre-wrap p-2 text-[11px] text-white/60">{body}</pre>
    </div>
  );
}
