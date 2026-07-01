"use client";
// Shows the assigned agent's relevant memory (rules · warnings · preferences) in future-task context — so the
// safety/instruction rules the user set are VISIBLE where the work happens, not hidden.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Brain } from "lucide-react";
import type { MemoryItem } from "@/lib/agent-memory";

export function AgentMemoryHints({ agentId }: { agentId: string }) {
  const [items, setItems] = useState<MemoryItem[]>([]);
  useEffect(() => {
    fetch(`/api/agents/${agentId}/memory`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
      .then((j) => setItems(((j?.memory ?? []) as MemoryItem[]).filter((m) => m.enabled && (m.type === "rule" || m.type === "warning" || m.type === "preference"))))
      .catch(() => {});
  }, [agentId]);
  if (items.length === 0) return null;
  return (
    <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/[0.04] p-3">
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-indigo-200"><Brain className="size-3.5" /> Agent memory — applies to this task <Link href={`/agents/${agentId}`} className="ml-auto text-[10px] text-white/40 hover:text-white/70">edit</Link></p>
      <ul className="space-y-0.5">{items.slice(0, 6).map((m) => (
        <li key={m.id} className={`text-[11px] ${m.type === "warning" ? "text-red-300/80" : "text-white/65"}`}>• <span className="text-white/35">[{m.type}]</span> {m.title}</li>
      ))}</ul>
    </div>
  );
}
