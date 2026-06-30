"use client";
import { Lock, Tag, Users, Archive, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { RiskBadge } from "./risk-badge";
import type { Skill } from "@/lib/types";

export function SkillCard({
  skill, linkedCount, selected, onClick,
}: {
  skill: Skill;
  linkedCount: number;
  selected?: boolean;
  onClick?: () => void;
}) {
  return (
    <article
      onClick={onClick}
      className={`flex cursor-pointer flex-col rounded-2xl border p-4 transition-colors ${
        selected ? "border-emerald-400/60 bg-emerald-500/[0.06]" : "border-white/10 bg-white/[0.03] hover:border-white/25"
      } ${skill.archived ? "opacity-55" : !skill.enabled ? "opacity-70" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-semibold text-white">{skill.name}</p>
        <RiskBadge risk={skill.risk_level} />
      </div>
      {skill.description && <p className="mt-1 line-clamp-2 text-xs text-white/45">{skill.description}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge tone="slate"><Tag className="size-3" /> {skill.category}</Badge>
        {skill.approval_required && <Badge tone="amber"><Lock className="size-3" /> approval</Badge>}
        {skill.archived && <Badge tone="slate"><Archive className="size-3" /> archived</Badge>}
        {!skill.enabled && !skill.archived && <Badge tone="slate">disabled</Badge>}
      </div>

      <div className="mt-auto flex items-center gap-3 pt-3 text-[11px] text-white/40">
        {linkedCount > 0 && <span className="inline-flex items-center gap-1"><Users className="size-3" /> {linkedCount}</span>}
        {skill.allowed_tools.length > 0 && <span className="inline-flex items-center gap-1"><Wrench className="size-3" /> {skill.allowed_tools.length} tools</span>}
        {skill.compatible_roles.length > 0
          ? <span className="truncate">{skill.compatible_roles.slice(0, 3).join(" · ")}</span>
          : <span className="text-white/30">all roles</span>}
      </div>
    </article>
  );
}
