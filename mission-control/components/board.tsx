"use client";
import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Column as Col } from "./column";
import type { BoardCard, Column } from "@/lib/types";

const COLUMNS: { key: Column; label: string }[] = [
  { key: "backlog", label: "Backlog" },
  { key: "building", label: "Building" },
  { key: "review", label: "Review" },
  { key: "done", label: "Done" },
];

export function Board({ initial }: { initial: BoardCard[] }) {
  const [cards, setCards] = useState<BoardCard[]>(initial);
  const [refreshing, setRefreshing] = useState(false);

  // Live layer via server-side poll (no direct anon-Supabase in the browser =
  // no telemetry leak). /api/board sits behind the mc_session cookie.
  async function refresh() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/board", { cache: "no-store" });
      if (res.ok) {
        const j = await res.json();
        if (Array.isArray(j.cards)) setCards(j.cards);
      }
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    const id = setInterval(refresh, 6000);
    return () => clearInterval(id);
  }, []);

  const byColumn = useMemo(() => {
    const m: Record<Column, BoardCard[]> = { backlog: [], building: [], review: [], done: [] };
    for (const c of cards) m[c.column].push(c);
    return m;
  }, [cards]);

  return (
    <>
      <div className="flex items-center justify-end px-3 pt-3">
        <button
          onClick={refresh}
          className="inline-flex items-center gap-1.5 rounded-md bg-white/5 px-2.5 py-1 text-xs text-white/60 hover:bg-white/10"
        >
          <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((c) => (
          <Col key={c.key} title={c.label} cards={byColumn[c.key]} onMerged={refresh} />
        ))}
      </div>
    </>
  );
}
