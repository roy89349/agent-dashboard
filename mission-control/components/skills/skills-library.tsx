"use client";
// Skill Library root: browse/filter capability "lego-blocks", create/edit/archive them, and link them to
// agents (with risk/role/approval warnings). Config-driven; a skill is a capability, not a permission.
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Boxes, Plus, RefreshCw } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { SkillCard } from "./skill-card";
import { SkillsFilter } from "./skills-filter";
import { SkillDetail } from "./skill-detail";
import { useSkills } from "./use-skills";
import { skillMatches, skillFacets, type SkillFilter } from "@/lib/skills-view";

export function SkillsLibrary() {
  const S = useSkills();
  const [filter, setFilter] = useState<SkillFilter>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const facets = useMemo(() => skillFacets(S.skills), [S.skills]);
  const shown = useMemo(() => S.skills.filter((s) => skillMatches(s, filter)), [S.skills, filter]);
  const selected = S.skills.find((s) => s.id === selectedId) ?? null;
  const linkedCount = (id: string) => S.agents.filter((a) => a.skill_ids.includes(id)).length;
  const activeCount = S.skills.filter((s) => !s.archived && s.enabled).length;

  async function newSkill() {
    let base = "skill", id = base, n = 2;
    while (S.skills.some((s) => s.id === id)) id = `${base}-${n++}`;
    const r = await S.saveSkill({ upsert: { id, name: "New skill", risk_level: "low", category: "general" } });
    if (r.ok) setSelectedId(id);
    else toast.error(r.error ?? "Could not create skill");
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5 pb-24 sm:px-6 md:pb-5">
      <div className="mb-4 flex items-center gap-3">
        <div className="grid size-9 place-items-center rounded-xl border border-white/10 bg-white/5 text-emerald-300">
          <Boxes className="size-[18px]" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-white">Skill Library</h2>
          <p className="text-xs text-white/40">{S.loaded ? `${activeCount} active · ${S.skills.length} total — capabilities, not permissions` : "Loading…"}</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={() => { S.loadSkills(); S.loadAgents(); }} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/50 hover:bg-white/5">
            <RefreshCw className="size-3.5" /> <span className="hidden sm:inline">Refresh</span>
          </button>
          <button onClick={newSkill} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-500 px-3 text-sm font-semibold text-black hover:bg-emerald-400">
            <Plus className="size-4" /> New skill
          </button>
        </div>
      </div>

      <div className="mb-4"><SkillsFilter facets={facets} filter={filter} onFilter={setFilter} /></div>

      {!S.loaded ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-36 animate-pulse rounded-2xl border border-white/10 bg-white/[0.03]" />)}
        </div>
      ) : shown.length === 0 ? (
        <EmptyState icon={Boxes} title={S.skills.length === 0 ? "No skills yet" : "No skills match this filter"} hint={S.skills.length === 0 ? "Add capability blocks for your agents." : "Adjust the filters above."} action={
          S.skills.length === 0 ? <button onClick={newSkill} className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-semibold text-black hover:bg-emerald-400"><Plus className="size-4" /> New skill</button> : undefined
        } />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((s) => <SkillCard key={s.id} skill={s} linkedCount={linkedCount(s.id)} selected={selectedId === s.id} onClick={() => setSelectedId(s.id)} />)}
        </div>
      )}

      <SkillDetail open={!!selected} onClose={() => setSelectedId(null)} skill={selected} agents={S.agents} saveSkill={S.saveSkill} saveAgent={S.saveAgent} />
    </div>
  );
}
