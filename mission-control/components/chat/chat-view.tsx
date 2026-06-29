"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, Send, MessagesSquare, Bot, User, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Msg = { role: "user" | "assistant"; content: string; pending?: boolean };
type Conv = { id: string; title: string | null; updated_at: string; kind?: string; issue?: number | null };

export function ChatView() {
  const [convs, setConvs] = useState<Conv[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadConvs = useCallback(async () => {
    const r = await fetch("/api/chats", { cache: "no-store" });
    if (r.ok) setConvs((await r.json()).conversations ?? []);
  }, []);

  const loadMessages = useCallback(async (id: string) => {
    const r = await fetch(`/api/chats/${id}`, { cache: "no-store" });
    if (r.ok) {
      const j = await r.json();
      setMessages((j.messages ?? []).map((m: Msg) => ({ role: m.role, content: m.content })));
    }
  }, []);

  useEffect(() => {
    loadConvs();
    // auto-open a conversation passed as ?c=<id> (e.g. from the "Discuss" button)
    const c = new URLSearchParams(window.location.search).get("c");
    if (c) selectConv(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadConvs]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function selectConv(id: string) {
    setActiveId(id);
    await loadMessages(id);
  }

  async function newConv(): Promise<string | null> {
    const r = await fetch("/api/chats", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    if (!r.ok) {
      toast.error("Could not create conversation");
      return null;
    }
    const { id } = await r.json();
    setActiveId(id);
    setMessages([]);
    loadConvs();
    return id;
  }

  async function send() {
    const content = input.trim();
    if (!content || streaming) return;
    let id = activeId;
    if (!id) {
      id = await newConv();
      if (!id) return;
    }
    setInput("");
    setMessages((m) => [...m, { role: "user", content }, { role: "assistant", content: "", pending: true }]);
    setStreaming(true);
    try {
      const res = await fetch(`/api/chats/${id}/message`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok || !res.body) throw new Error("stream failed");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          let obj: { type: string; text?: string; error?: string };
          try {
            obj = JSON.parse(line.slice(6));
          } catch {
            continue;
          }
          if (obj.type === "text") {
            acc += obj.text ?? "";
            setMessages((m) => {
              const copy = [...m];
              copy[copy.length - 1] = { role: "assistant", content: acc, pending: true };
              return copy;
            });
          } else if (obj.type === "error") {
            toast.error(obj.error ?? "Error");
          }
        }
      }
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { role: "assistant", content: acc || "(no response)" };
        return copy;
      });
      loadConvs();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error while streaming");
      setMessages((m) => m.filter((x) => !x.pending));
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="flex h-[calc(100dvh-3.5rem)]">
      {/* conversation list */}
      <div className="hidden w-64 shrink-0 flex-col border-r border-white/10 p-2 sm:flex">
        <Button variant="secondary" size="sm" className="mb-2 w-full" onClick={() => newConv()}>
          <Plus className="size-4" /> New conversation
        </Button>
        <div className="flex-1 space-y-0.5 overflow-y-auto">
          {convs.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-white/30">No conversations yet</p>
          ) : (
            convs.map((c) => (
              <button
                key={c.id}
                onClick={() => selectConv(c.id)}
                className={`flex w-full items-center gap-2 truncate rounded-lg px-2.5 py-2 text-left text-sm ${
                  c.id === activeId ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5"
                }`}
              >
                <MessagesSquare className="size-3.5 shrink-0 text-white/30" />
                <span className="truncate">{c.title ?? "New conversation"}</span>
                {c.kind === "task" && c.issue != null && (
                  <span className="ml-auto shrink-0 rounded bg-indigo-500/20 px-1 text-[10px] text-indigo-300">
                    #{c.issue}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* thread */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <div className="grid h-full place-items-center text-center">
              <div>
                <Bot className="mx-auto size-8 text-indigo-400/60" />
                <p className="mt-3 text-sm text-white/50">Orchestrator chat</p>
                <p className="mx-auto mt-1 max-w-sm text-xs text-white/30">
                  Ask about the fleet, have tasks planned, or consult the codebase + your Obsidian vault. Conversations are saved.
                </p>
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={`flex gap-3 ${m.role === "user" ? "justify-end" : ""}`}>
                {m.role === "assistant" && (
                  <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-indigo-500/20 text-indigo-300">
                    <Bot className="size-4" />
                  </div>
                )}
                <div
                  className={`max-w-[75%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm ${
                    m.role === "user" ? "bg-emerald-500/15 text-white" : "bg-white/[0.04] text-white/90"
                  }`}
                >
                  {m.content || (m.pending ? <Loader2 className="size-4 animate-spin text-white/40" /> : "")}
                </div>
                {m.role === "user" && (
                  <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-emerald-500/20 text-emerald-300">
                    <User className="size-4" />
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <div className="border-t border-white/10 p-3">
          <div className="flex items-end gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Ask the orchestrator something…  (Enter = send, Shift+Enter = new line)"
              rows={1}
              className="max-h-40 min-h-[2.25rem] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-white outline-none placeholder:text-white/30"
            />
            <Button size="icon" variant="accent" disabled={streaming || !input.trim()} onClick={send}>
              {streaming ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
