"use client";
// Updates: the Communication Agent's one-voice feed. Daily-grouped summaries (6 sections, each line linking to
// its source), urgent questions surfaced separately, an "Ask the team" box, generate controls, and per-team
// communicator config. Real choices live in the Decision Inbox — here we only reference them.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Megaphone, RefreshCw, Send, Sparkles, Users, AlertTriangle, ChevronRight } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { useCommunication } from "./use-communication";
import type { Summary, SourceRef, SummaryType, AskResult } from "@/lib/communication";

const TYPES: { v: SummaryType; label: string }[] = [
  { v: "live", label: "Live update" }, { v: "hourly", label: "Hourly" }, { v: "daily_standup", label: "Daily standup" }, { v: "end_of_day", label: "End of day" },
];
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
      <div className="mb-4 flex items-center gap-3">
        <div className="grid size-9 place-items-center rounded-xl border border-white/10 bg-white/5 text-emerald-300"><Megaphone className="size-[18px]" /></div>
        <div>
          <h2 className="text-base font-semibold text-white">Updates</h2>
          <p className="text-xs text-white/40">{C.loaded ? "One voice from the whole team — summaries, not ten chats" : "Loading…"}</p>
        </div>
        <button onClick={() => C.load()} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/50 hover:bg-white/5"><RefreshCw className="size-3.5" /> <span className="hidden sm:inline">Refresh</span></button>
      </div>

      {/* generate + ask */}
      <div className="mb-4 space-y-2 rounded-2xl border border-white/10 bg-white/[0.02] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <select value={type} onChange={(e) => setType(e.target.value as SummaryType)} className="h-9 rounded-lg border border-white/10 bg-white/5 px-2 text-sm text-white outline-none">
            {TYPES.map((t) => <option key={t.v} value={t.v} className="bg-[#0d1322]">{t.label}</option>)}
          </select>
          <label className="inline-flex items-center gap-1.5 text-xs text-white/60"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> send to phone</label>
          <button onClick={gen} disabled={busy} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-500 px-3 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-50"><Sparkles className="size-4" /> Generate</button>
        </div>
        <div className="flex items-center gap-2">
          <input value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doAsk()} placeholder="Ask the team… e.g. what's blocked on payments?" className="h-9 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/30 outline-none focus:border-emerald-500/40" />
          <button onClick={doAsk} disabled={busy || !question.trim()} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/15 px-3 text-sm text-white/80 hover:bg-white/5 disabled:opacity-50"><Send className="size-4" /> Ask</button>
        </div>
        {answer && (
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <p className="text-sm text-white/80">{answer.answer}</p>
            <div className="mt-1.5 space-y-1">{answer.refs.map((r, i) => <RefLine key={i} r={r} repo={repo} />)}</div>
          </div>
        )}
      </div>

      {/* communicators */}
      {C.communicators.length > 0 && (
        <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.02] p-3">
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
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-300"><AlertTriangle className="size-3.5" /> Urgent</p>
          <div className="space-y-2">{urgent.map((s) => <SummaryCard key={s.id} s={s} repo={repo} />)}</div>
        </section>
      )}

      {!C.loaded ? (
        <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="h-40 animate-pulse rounded-2xl border border-white/10 bg-white/[0.03]" />)}</div>
      ) : feed.length === 0 ? (
        <EmptyState icon={Megaphone} title="No updates yet" hint="Generate a live update or a daily standup — the Communication Agent summarises the whole floor." />
      ) : (
        <div className="space-y-5">
          {byDay.map(([day, items]) => (
            <section key={day}>
              <div className="mb-2 flex items-center gap-2"><h3 className="text-xs font-semibold uppercase tracking-wider text-white/45">{day}</h3><span className="h-px flex-1 bg-white/10" /></div>
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
  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 text-left">
        <span className="min-w-0 flex-1"><span className="text-sm font-medium text-white/90">{s.title}</span> <span className="text-[11px] text-white/35">· {new Date(s.created_at).toLocaleTimeString()}{s.delivered_phone ? " · 📱" : ""}</span></span>
        <span className="text-[11px] text-white/30">{total} items</span>
        <ChevronRight className={`size-3.5 text-white/25 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      <div className={`mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 ${open ? "" : "hidden"}`}>
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
