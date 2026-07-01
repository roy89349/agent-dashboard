"use client";
import { Filter, X } from "lucide-react";
import type { SkillFacets, SkillFilter } from "@/lib/skills-view";

function Sel({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/50">
      <span className="hidden sm:inline">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="max-w-[8rem] bg-transparent text-xs font-medium text-white outline-none capitalize">
        {children}
      </select>
    </label>
  );
}

export function SkillsFilter({
  facets, filter, onFilter,
}: {
  facets: SkillFacets;
  filter: SkillFilter;
  onFilter: (f: SkillFilter) => void;
}) {
  const set = (p: Partial<SkillFilter>) => onFilter({ ...filter, ...p });
  const active = !!(filter.category || filter.risk || filter.role || (filter.status && filter.status !== "enabled"));
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Filter className="size-3.5 shrink-0 text-white/30" />
      {facets.categories.length > 0 && (
        <Sel label="Category" value={filter.category ?? ""} onChange={(v) => set({ category: v || null })}>
          <option value="" className="bg-[#0d1322]">All categories</option>
          {facets.categories.map((c) => <option key={c} value={c} className="bg-[#0d1322]">{c}</option>)}
        </Sel>
      )}
      {facets.risks.length > 0 && (
        <Sel label="Risk" value={filter.risk ?? ""} onChange={(v) => set({ risk: v || null })}>
          <option value="" className="bg-[#0d1322]">All risk</option>
          {facets.risks.map((r) => <option key={r} value={r} className="bg-[#0d1322]">{r}</option>)}
        </Sel>
      )}
      {facets.roles.length > 0 && (
        <Sel label="Role" value={filter.role ?? ""} onChange={(v) => set({ role: v || null })}>
          <option value="" className="bg-[#0d1322]">All roles</option>
          {facets.roles.map((r) => <option key={r} value={r} className="bg-[#0d1322]">{r}</option>)}
        </Sel>
      )}
      <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-black/20 p-0.5 text-xs">
        {(["enabled", "archived", "all"] as const).map((s) => (
          <button key={s} onClick={() => set({ status: s })} className={`rounded-md px-2 py-1.5 capitalize transition-colors ${(filter.status ?? "enabled") === s ? "bg-white/10 text-white ring-1 ring-white/15" : "text-white/50 hover:bg-white/5 hover:text-white/80"}`}>{s}</button>
        ))}
      </div>
      {active && (
        <button onClick={() => onFilter({})} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-white/50 transition-colors hover:bg-white/5 hover:text-white/80">
          <X className="size-3.5" /> Clear
        </button>
      )}
    </div>
  );
}
