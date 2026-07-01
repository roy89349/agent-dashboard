"use client";
// Structured Conversations hub: one clear model instead of a chat-per-agent sprawl. Tabs — Team Chat (prominent,
// Claude-backed) · Tasks · Decisions (linked to the Decision Inbox) · Agent Logs (read-only timeline) · Daily
// Summaries. Search across threads. From a chat you can create a task/decision, assign, or send to the Manager.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { MessagesSquare, ListChecks, Inbox, ScrollText, CalendarDays, Search, Plus, Send, Loader2, Bot, User, Wrench, ArrowLeft, ExternalLink } from "lucide-react";
import type { Thread, StructMessage, ConversationGroup } from "@/lib/conversations";

type Grouped = Record<ConversationGroup, Thread[]>;
type Tab = "team" | "task" | "decision" | "agent" | "summary";
const TABS: { id: Tab; label: string; icon: typeof MessagesSquare; hint: string }[] = [
  { id: "team", label: "Team Chat", icon: MessagesSquare, hint: "Communication / Manager" },
  { id: "task", label: "Tasks", icon: ListChecks, hint: "per work item / workflow" },
  { id: "decision", label: "Decisions", icon: Inbox, hint: "linked to Decision Inbox" },
  { id: "agent", label: "Agent Logs", icon: ScrollText, hint: "technical timeline" },
  { id: "summary", label: "Summaries", icon: CalendarDays, hint: "standup · end-of-day" },
];

export function ConversationsView() {
  const [tab, setTab] = useState<Tab>("team");
  const [grouped, setGrouped] = useState<Grouped | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Thread[] | null>(null);

  const loadGrouped = useCallback(async () => {
    const r = await fetch("/api/conversations", { cache: "no-store" });
    if (r.ok) setGrouped((await r.json()).grouped);
  }, []);
  useEffect(() => { loadGrouped(); }, [loadGrouped]);

  useEffect(() => {
    if (!q.trim()) { setResults(null); return; }
    const id = setTimeout(async () => {
      const r = await fetch(`/api/conversations?q=${encodeURIComponent(q.trim())}`, { cache: "no-store" });
      if (r.ok) setResults((await r.json()).results ?? []);
    }, 250);
    return () => clearTimeout(id);
  }, [q]);

  const threads = grouped?.[tab] ?? [];

  return (
    <div className="mx-auto flex h-[calc(100dvh-3.5rem)] w-full max-w-6xl flex-col px-3 py-4 sm:px-6">
      <div className="mb-3 flex items-center gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/5 text-emerald-300"><MessagesSquare className="size-[18px]" /></div>
        <div className="min-w-0 flex-1"><h2 className="text-base font-semibold text-white">Conversations</h2><p className="truncate text-xs text-white/40">One structure — no chat-per-agent chaos</p></div>
        <div className="relative w-40 sm:w-64">
          <Search className="pointer-events-none absolute left-2 top-2 size-3.5 text-white/30" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="h-8 w-full rounded-lg border border-white/10 bg-white/5 pl-7 pr-2 text-xs text-white placeholder:text-white/30 outline-none focus:border-emerald-500/40" />
        </div>
      </div>

      {/* tabs — Team most prominent */}
      <div className="mb-3 flex gap-1 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => { setTab(t.id); setActive(null); setQ(""); }} className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${tab === t.id ? "bg-white/10 text-white" : "text-white/50 hover:bg-white/5"} ${t.id === "team" ? "ring-1 ring-emerald-500/20" : ""}`}>
            <t.icon className="size-3.5" /> {t.label}
            {grouped && t.id !== "agent" && t.id !== "summary" && grouped[t.id]?.length > 0 && <span className="rounded-full bg-white/10 px-1.5 text-[10px] text-white/50">{grouped[t.id].length}</span>}
          </button>
        ))}
      </div>

      {results ? (
        <SearchResults results={results} onOpen={(t) => { setTab(t.group as Tab); setActive(t.id); setQ(""); }} />
      ) : tab === "agent" ? (
        <AgentLogs />
      ) : tab === "summary" ? (
        <Summaries />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <ThreadList threads={threads} active={active} tab={tab} onSelect={setActive} onCreated={(id) => { loadGrouped(); setActive(id); }} />
          <div className={`${active ? "flex" : "hidden md:flex"} min-h-0 flex-col rounded-2xl border border-white/10 bg-white/[0.02]`}>
            {active ? (
              tab === "decision" ? <CommentPane key={active} threadId={active} onBack={() => setActive(null)} />
                : <ChatPane key={active} threadId={active} onBack={() => setActive(null)} onChanged={loadGrouped} />
            ) : <div className="grid flex-1 place-items-center text-sm text-white/30">Select a conversation</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function ThreadList({ threads, active, tab, onSelect, onCreated }: { threads: Thread[]; active: string | null; tab: Tab; onSelect: (id: string) => void; onCreated: (id: string) => void }) {
  async function create() {
    const kind = tab === "task" ? "task" : "team";
    const r = await fetch("/api/conversations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, title: tab === "team" ? "Team Chat" : "New task thread" }) });
    if (r.ok) onCreated((await r.json()).thread.id); else toast.error("Could not create");
  }
  return (
    <div className={`${active ? "hidden md:flex" : "flex"} min-h-0 flex-col rounded-2xl border border-white/10 bg-white/[0.02]`}>
      {tab !== "decision" && (
        <button onClick={create} className="m-2 inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/10 py-1.5 text-xs text-white/60 hover:bg-white/5"><Plus className="size-3.5" /> New {tab === "team" ? "chat" : "thread"}</button>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {threads.length === 0 ? <p className="p-3 text-xs text-white/30">No conversations yet.</p> : threads.map((t) => (
          <button key={t.id} onClick={() => onSelect(t.id)} className={`mb-1 w-full rounded-lg border px-2.5 py-2 text-left ${active === t.id ? "border-emerald-500/40 bg-emerald-500/[0.06]" : "border-transparent hover:bg-white/5"}`}>
            <p className="truncate text-sm text-white/85">{t.title ?? "(untitled)"}</p>
            <p className="truncate text-[11px] text-white/35">{t.last_type ? `[${t.last_type}] ` : ""}{t.last_message ?? "no messages"}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Team/Task chat — reuses the existing Claude streaming endpoints (/api/chats/[id]) ──
type Msg = { role: string; content: string; pending?: boolean };
function ChatPane({ threadId, onBack, onChanged }: { threadId: string; onBack: () => void; onChanged: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/chats/${threadId}`, { cache: "no-store" });
    if (r.ok) setMsgs(((await r.json()).messages ?? []).map((m: Msg) => ({ role: m.role, content: m.content })));
  }, [threadId]);
  useEffect(() => { load(); return () => abort.current?.abort(); }, [load]);
  useEffect(() => { scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: "smooth" }); }, [msgs]);

  async function send() {
    const content = input.trim();
    if (!content || streaming) return;
    setInput(""); setStreaming(true);
    setMsgs((m) => [...m, { role: "user", content }, { role: "assistant", content: "", pending: true }]);
    try {
      const ac = new AbortController(); abort.current = ac;
      const r = await fetch(`/api/chats/${threadId}/message`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content }), signal: ac.signal });
      if (!r.ok || !r.body) throw new Error("stream failed");
      const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "", acc = "";
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n"); buf = parts.pop() ?? "";
        for (const p of parts) {
          if (!p.startsWith("data:")) continue;
          const evt = JSON.parse(p.slice(5).trim());
          if (evt.type === "text") { acc += evt.text; setMsgs((m) => { const c = [...m]; c[c.length - 1] = { role: "assistant", content: acc, pending: true }; return c; }); }
          else if (evt.type === "done") { setMsgs((m) => { const c = [...m]; c[c.length - 1] = { role: "assistant", content: acc || "(no output)" }; return c; }); }
          else if (evt.type === "error") { toast.error(evt.error ?? "error"); }
        }
      }
    } catch { toast.error("Chat failed"); setMsgs((m) => m.filter((x) => !x.pending)); }
    finally { setStreaming(false); onChanged(); }
  }

  return (
    <>
      <div className="flex items-center gap-2 border-b border-white/10 p-2">
        <button onClick={onBack} className="rounded p-1 text-white/40 hover:bg-white/10 md:hidden"><ArrowLeft className="size-4" /></button>
        <ActionBar threadId={threadId} />
      </div>
      <div ref={scroll} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {msgs.length === 0 && <p className="pt-6 text-center text-xs text-white/30">Talk to the Communication / Manager agent.</p>}
        {msgs.map((m, i) => (
          <div key={i} className={`flex gap-2 ${m.role === "user" ? "justify-end" : ""}`}>
            {m.role !== "user" && <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-white/5 text-emerald-300">{m.role === "tool" ? <Wrench className="size-3" /> : <Bot className="size-3.5" />}</span>}
            <div className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${m.role === "user" ? "bg-emerald-500/15 text-white" : "bg-white/[0.04] text-white/85"}`}>{m.content || (m.pending && <Loader2 className="size-3.5 animate-spin" />)}</div>
            {m.role === "user" && <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-white/5 text-white/60"><User className="size-3.5" /></span>}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 border-t border-white/10 p-2">
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Message…" className="h-9 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/30 outline-none focus:border-emerald-500/40" />
        <button onClick={send} disabled={streaming || !input.trim()} className="grid size-9 place-items-center rounded-lg bg-emerald-500 text-black hover:bg-emerald-400 disabled:opacity-40">{streaming ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}</button>
      </div>
    </>
  );
}

// ── the from-chat actions ──
function ActionBar({ threadId }: { threadId: string }) {
  const [open, setOpen] = useState<null | "create_task" | "create_decision" | "assign" | "send_to_manager">(null);
  const [text, setText] = useState("");
  const [role, setRole] = useState("backend");
  async function submit() {
    if (!text.trim()) return;
    const body: Record<string, unknown> = { action: open };
    if (open === "create_task") body.title = text;
    else if (open === "create_decision") body.question = text;
    else if (open === "assign") { body.title = text; body.to_role = role; }
    else if (open === "send_to_manager") body.note = text;
    const r = await fetch(`/api/conversations/${threadId}/action`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) { toast.success("Done"); setOpen(null); setText(""); } else toast.error((await r.json().catch(() => ({}))).error ?? "Failed");
  }
  const btn = "inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[11px] text-white/55 hover:bg-white/5";
  return (
    <div className="flex flex-1 flex-wrap items-center gap-1.5">
      <button className={btn} onClick={() => setOpen("create_task")}>+ Task</button>
      <button className={btn} onClick={() => setOpen("create_decision")}>+ Decision</button>
      <button className={btn} onClick={() => setOpen("assign")}>Assign</button>
      <button className={btn} onClick={() => setOpen("send_to_manager")}>→ Manager</button>
      {open && (
        <div className="mt-1 flex w-full items-center gap-1.5">
          <input autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder={open === "create_decision" ? "Question for the decision…" : open === "send_to_manager" ? "Note for the Manager…" : "Title…"} className="h-8 flex-1 rounded-lg border border-white/10 bg-white/5 px-2 text-xs text-white outline-none focus:border-emerald-500/40" />
          {open === "assign" && <select value={role} onChange={(e) => setRole(e.target.value)} className="h-8 rounded-lg border border-white/10 bg-white/5 px-1 text-xs text-white outline-none">{["backend", "frontend", "qa", "security", "devops", "data", "designer", "documentation"].map((r) => <option key={r} value={r} className="bg-[#0d1322]">{r}</option>)}</select>}
          <button onClick={submit} className="h-8 rounded-lg bg-emerald-500 px-2.5 text-xs font-semibold text-black hover:bg-emerald-400">Go</button>
          <button onClick={() => setOpen(null)} className="h-8 rounded-lg px-2 text-xs text-white/40 hover:bg-white/5">✕</button>
        </div>
      )}
    </div>
  );
}

// ── Decision thread — comments (non-Claude) + link back to the Decision Inbox ──
function CommentPane({ threadId, onBack }: { threadId: string; onBack: () => void }) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [msgs, setMsgs] = useState<StructMessage[]>([]);
  const [input, setInput] = useState("");
  const load = useCallback(async () => {
    const r = await fetch(`/api/conversations/${threadId}`, { cache: "no-store" });
    if (r.ok) { const j = await r.json(); setThread(j.thread); setMsgs(j.messages ?? []); }
  }, [threadId]);
  useEffect(() => { load(); }, [load]);
  async function send() {
    if (!input.trim()) return;
    const r = await fetch(`/api/conversations/${threadId}/message`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: input.trim(), type: "decision" }) });
    if (r.ok) { setInput(""); load(); } else toast.error("Failed");
  }
  return (
    <>
      <div className="flex items-center gap-2 border-b border-white/10 p-2">
        <button onClick={onBack} className="rounded p-1 text-white/40 hover:bg-white/10 md:hidden"><ArrowLeft className="size-4" /></button>
        <p className="min-w-0 flex-1 truncate text-sm text-white/80">{thread?.title ?? "Decision"}</p>
        {thread?.approval_id && <Link href="/approvals" className="inline-flex items-center gap-1 text-[11px] text-emerald-300 hover:underline">Decision Inbox <ExternalLink className="size-3" /></Link>}
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {msgs.length === 0 ? <p className="pt-6 text-center text-xs text-white/30">Discuss this decision. It stays linked to the Decision Inbox.</p> : msgs.map((m) => (
          <div key={m.id} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/80"><span className="mr-1 text-[10px] uppercase text-white/30">{m.type ?? m.role}</span>{m.content}</div>
        ))}
      </div>
      <div className="flex items-center gap-2 border-t border-white/10 p-2">
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Add a comment…" className="h-9 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white outline-none focus:border-emerald-500/40" />
        <button onClick={send} disabled={!input.trim()} className="grid size-9 place-items-center rounded-lg bg-emerald-500 text-black hover:bg-emerald-400 disabled:opacity-40"><Send className="size-4" /></button>
      </div>
    </>
  );
}

// ── Agent Logs (read-only timeline from agent_messages) ──
type Log = { id: string; from_agent_id: string | null; to_agent_id: string | null; to_role: string | null; type: string; status: string; payload: Record<string, unknown> | null; created_at: string; work_item_id: string | null };
function AgentLogs() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [agent, setAgent] = useState("");
  useEffect(() => { fetch(`/api/conversations/logs${agent ? `?agent_id=${agent}` : ""}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => setLogs(j?.logs ?? [])).catch(() => {}); }, [agent]);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-white/10 bg-white/[0.02] p-3">
      <div className="mb-2 flex items-center gap-2"><ScrollText className="size-4 text-white/40" /><span className="text-xs text-white/50">Technical timeline (read-only) · less prominent by design</span>
        <input value={agent} onChange={(e) => setAgent(e.target.value)} placeholder="filter agent id" className="ml-auto h-7 w-36 rounded-lg border border-white/10 bg-white/5 px-2 text-xs text-white outline-none" /></div>
      {logs.length === 0 ? <p className="text-xs text-white/30">No logs.</p> : (
        <ul className="space-y-1">{logs.map((l) => (
          <li key={l.id} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-1.5 text-[11px]">
            <span className="rounded bg-white/5 px-1 uppercase text-white/40">{l.type}</span>
            <span className="text-white/60">{l.from_agent_id ?? "system"} → {l.to_agent_id ?? l.to_role ?? "—"}</span>
            <span className="truncate text-white/45">{String(l.payload?.note ?? "")}</span>
            <span className={`ml-auto shrink-0 ${l.status === "done" ? "text-emerald-300/70" : l.status === "rejected" ? "text-red-300/70" : "text-white/30"}`}>{l.status}</span>
          </li>
        ))}</ul>
      )}
    </div>
  );
}

// ── Daily Summaries (from communication_summaries) ──
type Summary = { id: string; type: string; title: string; sections: Record<string, { text: string }[]>; created_at: string };
function Summaries() {
  const [items, setItems] = useState<Summary[]>([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await fetch("/api/conversations/summaries", { cache: "no-store" }); if (r.ok) setItems((await r.json()).summaries ?? []); }, []);
  useEffect(() => { load(); }, [load]);
  async function gen(type: string) { setBusy(true); const r = await fetch("/api/conversations/summaries", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type }) }); setBusy(false); if (r.ok) { toast.success("Generated"); load(); } else toast.error("Failed"); }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-white/10 bg-white/[0.02] p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button disabled={busy} onClick={() => gen("daily_standup")} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/70 hover:bg-white/5 disabled:opacity-50">Generate standup</button>
        <button disabled={busy} onClick={() => gen("end_of_day")} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/70 hover:bg-white/5 disabled:opacity-50">End-of-day</button>
        {busy && <Loader2 className="size-4 animate-spin text-white/40" />}
      </div>
      {items.length === 0 ? <p className="text-xs text-white/30">No summaries yet — generate one above.</p> : (
        <div className="space-y-2">{items.map((s) => (
          <details key={s.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <summary className="cursor-pointer text-sm font-medium text-white/85">{s.title} <span className="text-[10px] uppercase text-white/35">{s.type}</span></summary>
            <div className="mt-2 space-y-1 text-[11px] text-white/60">
              {Object.entries(s.sections ?? {}).filter(([, v]) => v?.length).map(([k, v]) => (
                <div key={k}><span className="uppercase text-white/35">{k}:</span> {v.map((x) => x.text).join(" · ")}</div>
              ))}
            </div>
          </details>
        ))}</div>
      )}
    </div>
  );
}

function SearchResults({ results, onOpen }: { results: Thread[]; onOpen: (t: Thread) => void }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-white/10 bg-white/[0.02] p-2">
      {results.length === 0 ? <p className="p-3 text-xs text-white/30">No matches.</p> : results.map((t) => (
        <button key={t.id} onClick={() => onOpen(t)} className="mb-1 w-full rounded-lg px-3 py-2 text-left hover:bg-white/5">
          <p className="truncate text-sm text-white/85">{t.title ?? "(untitled)"} <span className="text-[10px] uppercase text-white/30">{t.group}</span></p>
          <p className="truncate text-[11px] text-white/40">{t.last_message ?? ""}</p>
        </button>
      ))}
    </div>
  );
}
