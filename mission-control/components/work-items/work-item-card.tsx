"use client";
import { GitPullRequest, Bug, Bot, GitBranch } from "lucide-react";
import { AgentAvatar, RoleChip } from "@/components/fleet/agent-meta";
import { RiskBadge } from "@/components/skills/risk-badge";
import { StateBadge, PriorityBadge, ModeBadge } from "./badges";
import type { WorkItem } from "@/lib/work-items";

export function WorkItemCard({
  item, agentName, selected, onClick,
}: {
  item: WorkItem;
  agentName: (id?: string | null) => string | null;
  selected?: boolean;
  onClick?: () => void;
}) {
  return (
    <article
      onClick={onClick}
      className={`glass-card glass-hover cursor-pointer p-4 ${selected ? "glow-ok" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-sm font-medium leading-snug text-white/90">{item.title}</p>
        <StateBadge state={item.state} />
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {item.mode === "plan_only" && <ModeBadge mode={item.mode} />}
        <PriorityBadge p={item.priority} />
        {item.risk_level !== "low" && <RiskBadge risk={item.risk_level} />}
        {(item.assigned_agent_id || item.assigned_role) && (
          <span className="inline-flex items-center gap-1">
            <AgentAvatar name={agentName(item.assigned_agent_id) ?? undefined} role={item.assigned_role} className="size-5 text-[9px]" />
            <RoleChip role={item.assigned_role} />
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/40">
        {item.issue && <span className="inline-flex items-center gap-1"><Bug className="size-3" /> #{item.issue}</span>}
        {item.pr && <span className="inline-flex items-center gap-1"><GitPullRequest className="size-3" /> PR #{item.pr}</span>}
        {item.parent_task_id && <span className="inline-flex items-center gap-1"><GitBranch className="size-3" /> subtask</span>}
        <span className="capitalize">{item.source_type.replace("_", " ")}</span>
      </div>
    </article>
  );
}
