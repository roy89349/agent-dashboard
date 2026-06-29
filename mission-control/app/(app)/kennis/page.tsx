import { BookOpen } from "lucide-react";

export default function KennisPage() {
  return (
    <div className="p-4">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-14 text-center">
        <BookOpen className="mx-auto size-8 text-emerald-400/60" />
        <h2 className="mt-3 text-base font-semibold">Knowledge</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-white/40">
          Coming soon: your Obsidian/markdown vault as a knowledge base — search and browse here,
          and agents use relevant notes as context while building (and write learnings back).
        </p>
      </div>
    </div>
  );
}
