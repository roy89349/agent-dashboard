"use client";
import { Inbox } from "lucide-react";
import { TaskCard } from "./task-card";
import type { BoardCard } from "@/lib/types";

// Functional column accents: neutral backlog, indigo building/review (in-progress/AI), emerald done.
const TONE: Record<string, { dot: string; counter: string }> = {
  Backlog: { dot: "bg-white/30", counter: "bg-white/10 text-white/60" },
  Building: { dot: "bg-indigo-400", counter: "bg-indigo-500/15 text-indigo-300" },
  Review: { dot: "bg-amber-400", counter: "bg-amber-500/15 text-amber-300" },
  Done: { dot: "bg-emerald-400", counter: "bg-emerald-500/15 text-emerald-300" },
};

export function Column({
  title,
  cards,
  onMerged,
}: {
  title: string;
  cards: BoardCard[];
  onMerged: () => void;
}) {
  const tone = TONE[title] ?? TONE.Backlog;
  return (
    <section className="glass-inset flex min-h-[120px] flex-col p-2">
      <div className="mb-2 flex items-center justify-between px-1.5 pt-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white/80">
          <span className={`size-1.5 rounded-full ${tone.dot}`} />
          {title}
        </h2>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${tone.counter}`}>
          {cards.length}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {cards.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 px-1 py-8 text-center">
            <Inbox className="size-4 text-white/15" />
            <p className="text-xs text-white/25">Nothing here</p>
          </div>
        ) : (
          cards.map((c) => <TaskCard key={c.issue} card={c} onMerged={onMerged} />)
        )}
      </div>
    </section>
  );
}
