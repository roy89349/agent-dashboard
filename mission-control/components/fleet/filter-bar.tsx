"use client";
// Shared filter + group-by bar for the board and worker views. Presentational + controlled: the parent
// owns the filter state and grouping. Only renders a dropdown for a dimension that actually has values,
// so it stays uncluttered when there's no agent/role/team metadata yet.
import { Filter, X, Group } from "lucide-react";
import type { Facets, FilterState } from "@/lib/agent-view";
import { isFiltered } from "@/lib/agent-view";

function Sel({
  label, value, onChange, children,
}: {
  label: string; value: string; onChange: (v: string) => void; children: React.ReactNode;
}) {
  return (
    <label className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/50">
      <span className="hidden sm:inline">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-[7.5rem] bg-transparent text-xs font-medium text-white outline-none"
      >
        {children}
      </select>
    </label>
  );
}

export function FilterBar({
  facets,
  filters,
  onFilter,
  group,
  onGroup,
  groupOptions,
}: {
  facets: Facets;
  filters: FilterState;
  onFilter: (f: FilterState) => void;
  group: string;
  onGroup: (g: string) => void;
  groupOptions: { key: string; label: string }[];
}) {
  const set = (patch: Partial<FilterState>) => onFilter({ ...filters, ...patch });
  const active = isFiltered(filters);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Filter className="size-3.5 shrink-0 text-white/30" />

      {facets.roles.length > 0 && (
        <Sel label="Role" value={filters.role ?? ""} onChange={(v) => set({ role: v || null })}>
          <option value="" className="bg-[#0d1322]">All roles</option>
          {facets.roles.map((r) => (
            <option key={r} value={r} className="bg-[#0d1322] capitalize">{r}</option>
          ))}
        </Sel>
      )}
      {facets.agents.length > 0 && (
        <Sel label="Agent" value={filters.agentId ?? ""} onChange={(v) => set({ agentId: v || null })}>
          <option value="" className="bg-[#0d1322]">All agents</option>
          {facets.agents.map((a) => (
            <option key={a.id} value={a.id} className="bg-[#0d1322]">{a.name}</option>
          ))}
        </Sel>
      )}
      {facets.teams.length > 0 && (
        <Sel label="Team" value={filters.teamId ?? ""} onChange={(v) => set({ teamId: v || null })}>
          <option value="" className="bg-[#0d1322]">All teams</option>
          {facets.teams.map((t) => (
            <option key={t.id} value={t.id} className="bg-[#0d1322]">{t.name}</option>
          ))}
        </Sel>
      )}
      {facets.statuses.length > 0 && (
        <Sel label="Status" value={filters.status ?? ""} onChange={(v) => set({ status: v || null })}>
          <option value="" className="bg-[#0d1322]">All statuses</option>
          {facets.statuses.map((s) => (
            <option key={s} value={s} className="bg-[#0d1322] capitalize">{s}</option>
          ))}
        </Sel>
      )}

      {active && (
        <button
          onClick={() => onFilter({})}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-white/50 hover:bg-white/5 hover:text-white/80"
        >
          <X className="size-3.5" /> Clear
        </button>
      )}

      {groupOptions.length > 1 && (
        <div className="ml-auto flex items-center gap-1 rounded-lg border border-white/10 bg-black/20 p-0.5 text-xs">
          <Group className="ml-1 size-3.5 text-white/30" />
          {groupOptions.map((g) => (
            <button
              key={g.key}
              onClick={() => onGroup(g.key)}
              className={`rounded-md px-2 py-1 capitalize transition-colors ${
                group === g.key ? "bg-white/10 text-white" : "text-white/50 hover:text-white/80"
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
