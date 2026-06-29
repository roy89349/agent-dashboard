"use client";
import { TaskCard } from "./task-card";
import type { BoardCard } from "@/lib/types";

export function Column({
  title,
  cards,
  onMerged,
}: {
  title: string;
  cards: BoardCard[];
  onMerged: () => void;
}) {
  return (
    <section className="flex min-h-[120px] flex-col rounded-xl bg-white/5 p-2">
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold text-white/80">{title}</h2>
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/60">
          {cards.length}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {cards.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-white/30">Empty</p>
        ) : (
          cards.map((c) => <TaskCard key={c.issue} card={c} onMerged={onMerged} />)
        )}
      </div>
    </section>
  );
}
