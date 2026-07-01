"use client";
import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Column as Col } from "./column";
import { FilterBar } from "./fleet/filter-bar";
import { cardMeta, matches, facets, groupKey, type FilterState } from "@/lib/agent-view";
import type { BoardCard, Column } from "@/lib/types";

const COLUMNS: { key: Column; label: string }[] = [
  { key: "backlog", label: "Backlog" },
  { key: "building", label: "Building" },
  { key: "review", label: "Review" },
  { key: "done", label: "Done" },
];

const GROUP_OPTIONS = [
  { key: "status", label: "Status" },
  { key: "role", label: "Role" },
  { key: "team", label: "Team" },
];

export function Board({ initial }: { initial: BoardCard[] }) {
  const [cards, setCards] = useState<BoardCard[]>(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [filters, setFilters] = useState<FilterState>({});
  const [group, setGroup] = useState("status");

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

  const fac = useMemo(() => facets(cards.map(cardMeta)), [cards]);
  const filtered = useMemo(() => cards.filter((c) => matches(cardMeta(c), filters)), [cards, filters]);

  // Default view = Status → the original 4 columns (layout unchanged). Role/Team regroup dynamically.
  const groups = useMemo(() => {
    if (group === "status") {
      return COLUMNS.map((c) => ({ key: c.key, label: c.label, cards: filtered.filter((x) => x.column === c.key) }));
    }
    const dim = group as "role" | "team";
    const m = new Map<string, { label: string; cards: BoardCard[] }>();
    for (const c of filtered) {
      const g = groupKey(cardMeta(c), dim);
      if (!m.has(g.key)) m.set(g.key, { label: g.label, cards: [] });
      m.get(g.key)!.cards.push(c);
    }
    return [...m.entries()]
      .sort((a, b) => (a[0] === "_none" ? 1 : b[0] === "_none" ? -1 : a[1].label.localeCompare(b[1].label)))
      .map(([key, v]) => ({ key, label: v.label, cards: v.cards }));
  }, [filtered, group]);

  return (
    <>
      <div className="glass flex flex-wrap items-center gap-2 px-3 py-2">
        <FilterBar
          facets={fac}
          filters={filters}
          onFilter={setFilters}
          group={group}
          onGroup={setGroup}
          groupOptions={GROUP_OPTIONS}
        />
        <button
          onClick={refresh}
          className="glass-card glass-hover inline-flex items-center gap-1.5 px-2.5 py-1 text-xs text-white/60 hover:text-white"
        >
          <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>
      <div className={`grid gap-3 pt-3 ${group === "status" ? "grid-cols-1 md:grid-cols-2 xl:grid-cols-4" : "grid-cols-1 md:grid-cols-2 xl:grid-cols-3"}`}>
        {groups.map((g) => (
          <Col key={g.key} title={g.label} cards={g.cards} onMerged={refresh} />
        ))}
      </div>
    </>
  );
}
