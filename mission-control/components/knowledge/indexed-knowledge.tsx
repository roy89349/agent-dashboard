"use client";
// The "project brain": the DB-indexed knowledge — search, filters (type/team/tag/agent), a detail drawer with
// the allowed-agents/team selector + safe-to-use flag, add a manual note or reindex the vault. Works even without
// a vault (team instructions + manual items); shows setup instructions when VAULT_DIR is missing.
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { BookOpen, Search, Plus, RefreshCw, ShieldAlert, ShieldCheck, Archive, Tag, Users } from "lucide-react";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import type { KnowledgeItem, KnowledgeType } from "@/lib/knowledge-index";
import type { Agent, Team } from "@/lib/types";

const TYPES: KnowledgeType[] = ["markdown", "docs", "project_rules", "coding_standards", "product_vision", "business_goals", "api_docs", "decision", "customer_requirements", "architecture", "security_rules", "team_instruction", "note"];
const label = (t: string) => t.replace(/_/g, " ");

export function IndexedKnowledge() {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [vaultOk, setVaultOk] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState("");
  const [ftype, setFtype] = useState("all");
  const [fteam, setFteam] = useState("all");
  const [ftag, setFtag] = useState("all");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (query = "") => {
    const p = new URLSearchParams();
    if (query.trim()) p.set("q", query.trim());
    const r = await fetch(`/api/knowledge/items?${p}`, { cache: "no-store" });
    if (r.ok) { const j = await r.json(); setItems(j.items ?? []); setVaultOk(!!j.vault_configured); }
  }, []);

  useEffect(() => {
    Promise.all([
      load(),
      fetch("/api/agents", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => setAgents(j?.agents ?? [])).catch(() => {}),
      fetch("/api/teams", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => setTeams(j?.teams ?? [])).catch(() => {}),
    ]).finally(() => setLoaded(true));
  }, [load]);

  useEffect(() => { const t = setTimeout(() => load(q), 250); return () => clearTimeout(t); }, [q, load]);

  const allTags = useMemo(() => Array.from(new Set(items.flatMap((i) => i.tags))).sort(), [items]);
  const shown = useMemo(() => items.filter((i) =>
    (ftype === "all" || i.type === ftype) && (fteam === "all" || i.team_id === fteam) && (ftag === "all" || i.tags.includes(ftag)),
  ), [items, ftype, fteam, ftag]);

  async function reindex() {
    setBusy(true);
    const r = await fetch("/api/knowledge/items", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "folder" }) });
    setBusy(false);
    const j = await r.json().catch(() => ({}));
    if (r.ok) { toast.success(`Indexed ${j.indexed ?? 0} · skipped ${j.skipped ?? 0} (secrets never indexed)`); load(q); }
    else toast.error(j.error ?? "Reindex failed");
  }

  const teamName = (id?: string | null) => (id ? teams.find((t) => t.id === id)?.name ?? id : null);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-4 pb-24 sm:px-6 md:pb-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="glass-card flex min-w-0 flex-1 items-center gap-2.5 px-3.5 transition-colors focus-within:border-emerald-500/40">
          <Search className="size-[18px] shrink-0 text-white/40" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the project brain…" className="h-11 w-full bg-transparent text-sm text-white outline-none placeholder:text-white/30" />
        </div>
        <button onClick={reindex} disabled={busy || !vaultOk} title={vaultOk ? "Index the vault folder" : "VAULT_DIR not configured"} className="glass-card glass-hover inline-flex h-11 items-center gap-1.5 px-3 text-xs text-white/60 hover:text-white/90 disabled:opacity-40"><RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} /> <span className="hidden sm:inline">Reindex</span></button>
        <button onClick={() => setAdding(true)} className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-emerald-500 px-4 text-sm font-semibold text-black shadow-[0_0_18px_rgba(16,185,129,0.18)] hover:bg-emerald-400"><Plus className="size-4" /> Add</button>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        <Sel value={ftype} onChange={setFtype} opts={TYPES.map((t) => ({ v: t, l: label(t) }))} allLabel="All types" />
        {teams.length > 0 && <Sel value={fteam} onChange={setFteam} opts={teams.map((t) => ({ v: t.id, l: t.name }))} allLabel="All teams" />}
        {allTags.length > 0 && <Sel value={ftag} onChange={setFtag} opts={allTags.map((t) => ({ v: t, l: t }))} allLabel="All tags" />}
        {!vaultOk && <span className="inline-flex items-center gap-1 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-2 py-1 text-[11px] text-amber-300 backdrop-blur-md">VAULT_DIR not set — file indexing off (manual items + instructions still work)</span>}
      </div>

      {!loaded ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <div key={i} className="glass-card h-20 animate-pulse" />)}</div>
      ) : shown.length === 0 ? (
        <EmptyState icon={BookOpen} title={items.length === 0 ? "The project brain is empty" : "Nothing matches"} hint={items.length === 0 ? "Add a note, or set VAULT_DIR and Reindex to pull in your docs. Secret files (.env, keys, credentials) are never indexed." : "Adjust the filters."} />
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {shown.map((i) => (
            <article key={i.id} onClick={() => setSel(i.id)} className={`glass-card glass-hover cursor-pointer p-3 ${sel === i.id ? "glow-ok" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 text-sm font-medium leading-snug text-white/90">{i.title}</p>
                {i.safe_to_use ? <ShieldCheck className="size-4 shrink-0 text-emerald-400/70" /> : <span title="secret/sensitive content detected — flagged unsafe"><ShieldAlert className="size-4 shrink-0 text-amber-400" /></span>}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge tone={i.type === "team_instruction" ? "teal" : "slate"}>{label(i.type)}</Badge>
                {i.team_id && <span className="text-[10px] text-white/40">{teamName(i.team_id)}</span>}
                {i.allowed_agents.length > 0 && <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-300/70"><Users className="size-2.5" /> restricted</span>}
                {i.tags.slice(0, 3).map((t) => <span key={t} className="rounded-md border border-white/[0.07] bg-white/[0.05] px-1.5 py-px text-[10px] text-white/45">{t}</span>)}
              </div>
              {i.summary && <p className="mt-1 line-clamp-2 text-[11px] text-white/45">{i.summary}</p>}
            </article>
          ))}
        </div>
      )}

      <KnowledgeDrawer id={sel} open={sel != null} onClose={() => setSel(null)} agents={agents} teams={teams} onChanged={() => load(q)} />
      <AddDialog open={adding} onOpenChange={setAdding} teams={teams} onAdded={() => load(q)} />
    </div>
  );
}

function Sel({ value, onChange, opts, allLabel }: { value: string; onChange: (v: string) => void; opts: { v: string; l: string }[]; allLabel: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="h-8 rounded-lg border border-white/10 bg-white/5 px-2 text-xs text-white outline-none capitalize">
      <option value="all" className="bg-[#0d1322]">{allLabel}</option>
      {opts.map((o) => <option key={o.v} value={o.v} className="bg-[#0d1322] capitalize">{o.l}</option>)}
    </select>
  );
}

function KnowledgeDrawer({ id, open, onClose, agents, teams, onChanged }: { id: string | null; open: boolean; onClose: () => void; agents: Agent[]; teams: Team[]; onChanged: () => void }) {
  const [item, setItem] = useState<KnowledgeItem | null>(null);
  const [allowed, setAllowed] = useState("");
  const [team, setTeam] = useState("");
  const [type, setType] = useState<KnowledgeType>("note");
  const [tags, setTags] = useState("");

  useEffect(() => {
    if (!open || !id) return;
    fetch(`/api/knowledge/items/${id}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => {
      const it: KnowledgeItem | null = j?.item ?? null;
      setItem(it);
      if (it) { setAllowed(it.allowed_agents.join(", ")); setTeam(it.team_id ?? ""); setType(it.type); setTags(it.tags.join(", ")); }
    }).catch(() => {});
  }, [open, id]);

  async function saveMeta() {
    if (!item) return;
    const r = await fetch(`/api/knowledge/items/${item.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ type, team_id: team || null, allowed_agents: allowed.split(",").map((s) => s.trim()).filter(Boolean), tags: tags.split(",").map((s) => s.trim()).filter(Boolean) }) });
    if (r.ok) { toast.success("Saved"); setItem((await r.json()).item); onChanged(); } else toast.error("Save failed");
  }
  async function archive() {
    if (!item) return;
    const r = await fetch(`/api/knowledge/items/${item.id}`, { method: "DELETE" });
    if (r.ok) { toast.success("Archived"); onChanged(); onClose(); } else toast.error("Failed");
  }

  const inp = "h-9 w-full rounded-lg border border-white/10 bg-white/5 px-2.5 text-sm text-white outline-none focus:border-emerald-500/40";
  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      {open && (
        <DrawerContent title="Knowledge item">
          {!item ? <p className="p-5 text-sm text-white/50">Loading…</p> : (
            <div className="space-y-4 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={item.type === "team_instruction" ? "teal" : "slate"}>{label(item.type)}</Badge>
                {item.safe_to_use ? <Badge tone="emerald">safe to use</Badge> : <Badge tone="amber">flagged unsafe</Badge>}
              </div>
              <p className="text-[15px] font-medium text-white">{item.title}</p>
              {item.summary && <p className="text-sm text-white/60">{item.summary}</p>}
              {(item.source_path || item.source_url) && <p className="text-[11px] text-white/35">source: {item.source_path ?? item.source_url}</p>}
              {item.content_preview && <pre className="glass-inset max-h-56 overflow-auto whitespace-pre-wrap rounded-lg p-2.5 text-[11px] text-white/60">{item.content_preview}</pre>}

              <div className="glass-inset space-y-2.5 rounded-xl p-3">
                <p className="text-xs font-medium text-white/50">Metadata &amp; access</p>
                <label className="block text-xs text-white/50">Type
                  <select value={type} onChange={(e) => setType(e.target.value as KnowledgeType)} className={`mt-1 ${inp} capitalize`}>{TYPES.map((t) => <option key={t} value={t} className="bg-[#0d1322] capitalize">{label(t)}</option>)}</select>
                </label>
                <label className="block text-xs text-white/50">Team
                  <select value={team} onChange={(e) => setTeam(e.target.value)} className={`mt-1 ${inp}`}><option value="" className="bg-[#0d1322]">all teams</option>{teams.map((t) => <option key={t.id} value={t.id} className="bg-[#0d1322]">{t.name}</option>)}</select>
                </label>
                <label className="block text-xs text-white/50"><Tag className="mr-1 inline size-3" />Tags (comma-separated)<input value={tags} onChange={(e) => setTags(e.target.value)} className={`mt-1 ${inp}`} /></label>
                <label className="block text-xs text-white/50"><Users className="mr-1 inline size-3" />Allowed agents / roles (comma-separated; empty = everyone)
                  <input value={allowed} onChange={(e) => setAllowed(e.target.value)} placeholder={agents.slice(0, 3).map((a) => a.role).join(", ")} className={`mt-1 ${inp}`} />
                </label>
                <div className="flex gap-1.5">
                  <button onClick={saveMeta} className="h-11 flex-1 rounded-lg bg-emerald-500 text-sm font-semibold text-black shadow-[0_0_18px_rgba(16,185,129,0.15)] hover:bg-emerald-400">Save</button>
                  <button onClick={archive} className="inline-flex h-11 items-center gap-1 rounded-lg border border-red-500/30 px-3 text-xs text-red-300 hover:bg-red-500/10"><Archive className="size-3.5" /> Archive</button>
                </div>
              </div>
            </div>
          )}
        </DrawerContent>
      )}
    </Drawer>
  );
}

function AddDialog({ open, onOpenChange, teams, onAdded }: { open: boolean; onOpenChange: (o: boolean) => void; teams: Team[]; onAdded: () => void }) {
  const [f, setF] = useState({ title: "", type: "note" as KnowledgeType, content: "", tags: "", team_id: "" });
  async function add() {
    if (!f.title.trim()) return toast.error("Title required");
    const r = await fetch("/api/knowledge/items", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "manual", title: f.title, type: f.type, content: f.content, tags: f.tags.split(",").map((s) => s.trim()).filter(Boolean), team_id: f.team_id || null }) });
    if (r.ok) { toast.success("Added"); onOpenChange(false); setF({ title: "", type: "note", content: "", tags: "", team_id: "" }); onAdded(); }
    else toast.error((await r.json().catch(() => ({}))).error ?? "Failed");
  }
  const inp = "w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/30 outline-none focus:border-emerald-500/40";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add knowledge</DialogTitle></DialogHeader>
        <div className="space-y-2.5">
          <input autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Title" className={`h-10 ${inp}`} />
          <div className="grid grid-cols-2 gap-2">
            <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as KnowledgeType })} className={`h-9 ${inp} capitalize`}>{TYPES.map((t) => <option key={t} value={t} className="bg-[#0d1322] capitalize">{label(t)}</option>)}</select>
            <select value={f.team_id} onChange={(e) => setF({ ...f, team_id: e.target.value })} className={`h-9 ${inp}`}><option value="" className="bg-[#0d1322]">all teams</option>{teams.map((t) => <option key={t.id} value={t.id} className="bg-[#0d1322]">{t.name}</option>)}</select>
          </div>
          <textarea value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} rows={4} placeholder="Content (redacted + secret-scrubbed before storing)" className={`resize-none ${inp} py-2`} />
          <input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} placeholder="tags, comma-separated" className={`h-9 ${inp}`} />
          <button onClick={add} className="h-11 w-full rounded-xl bg-emerald-500 text-sm font-semibold text-black shadow-[0_0_18px_rgba(16,185,129,0.18)] hover:bg-emerald-400">Add to the project brain</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
