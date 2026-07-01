"use client";
// Updates: the Communication Agent's one-voice feed. Daily-grouped summaries (6 sections, each line linking to
// its source), urgent questions surfaced separately, an "Ask the team" box, generate controls, and per-team
// communicator config. Real choices live in the Decision Inbox — here we only reference them.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Megaphone, RefreshCw, Send, Sparkles, Users, AlertTriangle, ChevronRight, Smartphone } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, SectionLabel } from "@/components/ui/glass";
import { useCommunication } from "./use-communication";
import type { Summary, SourceRef, SummaryType, AskResult } from "@/lib/communication";

const TYPES: { v: SummaryType; label: string }[] = [
  { v: "live", label: "Live update" }, { v: "hourly", label: "Hourly" }, { v: "daily_standup", label: "Daily standup" }, { v: "end_of_day", label: "End of day" },
];
// summary-type chip on each card: emerald=live, indigo=standup/info, teal=end-of-day, amber=urgent
const TYPE_CHIP: Record<string, { label: string; tone: Tone }> = {
  live: { label: "live", tone: "emerald" },
  hourly: { label: "hourly", tone: "slate" },
  daily_standup: { label: "standup", tone: "indigo" },
  end_of_day: { label: "end of day", tone: "teal" },
  urgent_question: { label: "urgent", tone: "amber" },
};
const SECTIONS: { key: keyof Summary["sections"]; label: string; tone: string }[] = [
  { key: "done", label: "✅ Done", tone: "text-emerald-300" },
  { key: "running", label: "🔄 Running", tone: "text-indigo-300" },
  { key: "blocked", label: "⛔ Blocked", tone: "text-red-300" },
  { key: "usage", label: "📊 Usage", tone: "text-white/60" },
  { key: "decisions", label: "🤔 Waiting on you", tone: "text-amber-300" },
  { key: "advice", label: "💡 Advice", tone: "text-teal-300" },
];

export function UpdatesView() {
  const C = useCommunication();
  const [type, setType] = useState<SummaryType>("live");
  const [notify, setNotify] = useState(false);
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<AskResult | null>(null);
  const [repo, setRepo] = useState<string | null>(null);

  useEffect(() => { fetch("/api/config", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((c) => setRepo(c?.repo ?? null)).catch(() => {}); }, []);

  const urgent = useMemo(() => C.summaries.filter((s) => s.type === "urgent_question"), [C.summaries]);
  const feed = useMemo(() => C.summaries.filter((s) => s.type !== "urgent_question"), [C.summaries]);
  const byDay = useMemo(() => {
    const m = new Map<string, Summary[]>();
    for (const s of feed) { const d = new Date(s.created_at).toLocaleDateString(); if (!m.has(d)) m.set(d, []); m.get(d)!.push(s); }
    return Array.from(m.entries());
  }, [feed]);

  async function gen() {
    setBusy(true);
    const s = await C.generate(type, notify);
    setBusy(false);
    if (s) toast.success(`${TYPES.find((t) => t.v === type)?.label} generated${notify ? " + sent to phone" : ""}`); else toast.error("Could not generate");
  }
  async function doAsk() {
    if (!question.trim()) return;
    setBusy(true);
    setAnswer(await C.ask(question.trim()));
    setBusy(false);
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-5 pb-24 sm:px-6 md:pb-5">
      <PageHeader
        className="mb-5"
        title={
          <span className="inline-flex items-center gap-2.5">
            <span className="glass-card grid size-9 place-items-center rounded-xl text-emerald-300"><Megaphone className="size-[18px]" /></span>
            Updates
          </span>
        }
        subtitle={C.loaded ? "One voice from the whole team — summaries, not ten chats" : "Loading…"}
        actions={
          <Button variant="outline" size="sm" className="h-10" onClick={() => C.load()}>
            <RefreshCw className="size-3.5" /> <span className="hidden sm:inline">Refresh</span>
          </Button>
        }
      />

      {/* generate + ask */}
      <div className="glass mb-4 space-y-2.5 p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <select value={type} onChange={(e) => setType(e.target.value as SummaryType)} className="h-11 rounded-lg border border-white/10 bg-white/5 px-2 text-sm text-white outline-none focus:border-emerald-500/40">
            {TYPES.map((t) => <option key={t.v} value={t.v} className="bg-[#0d1322]">{t.label}</option>)}
          </select>
          <label className="inline-flex items-center gap-1.5 text-xs text-white/60"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> send to phone</label>
          <Button variant="accent" size="sm" className="h-11 px-3.5" onClick={gen} disabled={busy}><Sparkles className="size-4" /> Generate</Button>
        </div>
        <div className="flex items-center gap-2">
          <Input value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doAsk()} placeholder="Ask the team… e.g. what's blocked on payments?" className="h-11 flex-1" />
          <Button variant="outline" size="sm" className="h-11 px-3.5" onClick={doAsk} disabled={busy || !question.trim()}><Send className="size-4" /> Ask</Button>
        </div>
        {answer && (
          <div className="glass-inset p-3">
            <p className="text-sm text-white/80">{answer.answer}</p>
            <div className="mt-1.5 space-y-1">{answer.refs.map((r, i) => <RefLine key={i} r={r} repo={repo} />)}</div>
          </div>
        )}
      </div>

      {/* communicators */}
      {C.communicators.length > 0 && (
        <div className="glass-card mb-4 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-white/50"><Users className="size-3.5" /> Communication agent per team</p>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {C.communicators.map((c) => (
              <div key={c.team_id} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate text-white/70">{c.team_name}</span>
                <select value={c.communicator_agent_id ?? ""} onChange={(e) => C.setCommunicator(c.team_id, e.target.value || null)} className="h-8 rounded-lg border border-white/10 bg-white/5 px-1.5 text-xs text-white outline-none">
                  <option value="" className="bg-[#0d1322]">team lead (default)</option>
                  {C.agents.map((a) => <option key={a.id} value={a.id} className="bg-[#0d1322]">{a.name}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* urgent questions */}
      {urgent.length > 0 && (
        <section className="mb-4">
          <SectionLabel className="mb-2 flex items-center gap-1.5 text-amber-300"><AlertTriangle className="size-3.5" /> Urgent</SectionLabel>
          <div className="space-y-2">{urgent.map((s) => <SummaryCard key={s.id} s={s} repo={repo} />)}</div>
        </section>
      )}

      {!C.loaded ? (
        <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="glass-card h-40 animate-pulse" />)}</div>
      ) : feed.length === 0 ? (
        <EmptyState icon={Megaphone} title="No updates yet" hint="Generate a live update or a daily standup — the Communication Agent summarises the whole floor." />
      ) : (
        <div className="space-y-5">
          {byDay.map(([day, items]) => (
            <section key={day}>
              <div className="mb-2 flex items-center gap-2"><SectionLabel>{day}</SectionLabel><span className="h-px flex-1 bg-white/10" /></div>
              <div className="space-y-2">{items.map((s) => <SummaryCard key={s.id} s={s} repo={repo} />)}</div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ s, repo }: { s: Summary; repo: string | null }) {
  const [open, setOpen] = useState(false);
  const total = SECTIONS.reduce((n, sec) => n + s.sections[sec.key].length, 0);
  const chip = TYPE_CHIP[s.type];
  const isUrgent = s.type === "urgent_question";
  return (
    <article className={`glass-card glass-hover p-3.5 ${isUrgent ? "glow-warn border-amber-500/25" : ""}`}>
      <button onClick={() => setOpen(!open)} className="flex min-h-11 w-full items-center gap-2 text-left">
        <span className="min-w-0 flex-1">
          <span className="mr-1.5 inline-flex flex-wrap items-center gap-1.5 align-middle">
            {chip && <Badge tone={chip.tone}>{chip.label}</Badge>}
            {s.delivered_phone && <Badge tone="slate" className="gap-1"><Smartphone className="size-3" /> phone</Badge>}
          </span>
          <span className="text-sm font-medium text-white/90">{s.title}</span>{" "}
          <span className="text-[11px] text-white/35">· {new Date(s.created_at).toLocaleTimeString()}</span>
        </span>
        <span className="text-[11px] text-white/30">{total} items</span>
        <ChevronRight className={`size-3.5 text-white/25 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      <div className={`glass-inset mt-2 grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 ${open ? "" : "hidden"}`}>
        {SECTIONS.map((sec) => {
          const refs = s.sections[sec.key];
          if (refs.length === 0) return null;
          return (
            <div key={sec.key}>
              <p className={`text-[11px] font-semibold uppercase tracking-wider ${sec.tone}`}>{sec.label}</p>
              <ul className="mt-0.5 space-y-1">{refs.map((r, i) => <li key={i}><RefLine r={r} repo={repo} /></li>)}</ul>
            </div>
          );
        })}
      </div>
      {!open && <p className="mt-1 truncate text-[11px] text-white/40">{s.sections.advice[0]?.text ?? s.sections.running[0]?.text ?? "tap to expand"}</p>}
    </article>
  );
}

function RefLine({ r, repo }: { r: SourceRef; repo: string | null }) {
  const gh = (n: number, kind: "issues" | "pull") => (repo ? `https://github.com/${repo}/${kind}/${n}` : null);
  const links: { href: string; label: string; ext?: boolean }[] = [];
  if (r.work_item_id) links.push({ href: "/work-items", label: "task" });
  if (r.workflow_id) links.push({ href: "/workflows", label: "workflow" });
  if (r.approval_id) links.push({ href: "/approvals", label: "decision" });
  if (r.knowledge_id) links.push({ href: "/kennis", label: "knowledge" });
  if (r.issue != null && gh(r.issue, "issues")) links.push({ href: gh(r.issue, "issues")!, label: `#${r.issue}`, ext: true });
  if (r.pr != null && gh(r.pr, "pull")) links.push({ href: gh(r.pr, "pull")!, label: `PR #${r.pr}`, ext: true });
  return (
    <span className="flex flex-wrap items-baseline gap-x-1.5 text-[12px] text-white/70">
      <span className="min-w-0">{r.text}</span>
      {links.map((l) => (
        l.ext
          ? <a key={l.label} href={l.href} target="_blank" rel="noreferrer" className="text-[10px] text-emerald-300/80 hover:text-emerald-200">{l.label}↗</a>
          : <Link key={l.label} href={l.href} className="text-[10px] text-white/35 hover:text-white/70">{l.label}</Link>
      ))}
    </span>
  );
}
