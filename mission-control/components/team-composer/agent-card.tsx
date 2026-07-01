"use client";
// One agent on the canvas / in a list. Shows identity + the full config the user cares about. A "ghost"
// (an id in the team but no longer in the registry) renders dimmed so the chart never silently drops it.
import { Bot, Gauge, ShieldCheck, Crown, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AgentAvatar, RoleChip } from "@/components/fleet/agent-meta";
import { AutonomyBadge } from "./autonomy-badge";
import type { Agent } from "@/lib/types";

export function AgentCard({
  agent,
  ghostId,
  isLead,
  selected,
  onClick,
  onToggleEnabled,
  compact,
}: {
  agent: Agent | null;
  ghostId?: string;
  isLead?: boolean;
  selected?: boolean;
  onClick?: () => void;
  onToggleEnabled?: (enabled: boolean) => void;
  compact?: boolean;
}) {
  if (!agent) {
    return (
      <div
        onClick={onClick}
        className={`rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-3 backdrop-blur-sm ${onClick ? "cursor-pointer" : ""}`}
      >
        <div className="flex items-center gap-2 text-white/40">
          <AlertTriangle className="size-4" />
          <span className="truncate text-sm">{ghostId} <span className="text-[11px]">(removed)</span></span>
        </div>
      </div>
    );
  }
  return (
    <div
      onClick={onClick}
      className={`glass-card p-3 ${
        selected ? "glow-ok border-emerald-400/60 bg-emerald-500/[0.07]" : "glass-hover"
      } ${!agent.enabled ? "opacity-55" : ""} ${onClick ? "cursor-pointer" : ""}`}
    >
      <div className="flex items-center gap-2">
        <AgentAvatar name={agent.name} role={agent.role} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 truncate text-sm font-semibold text-white">
            {isLead && <Crown className="size-3.5 shrink-0 text-amber-300" />}
            {agent.name}
          </p>
          <RoleChip role={agent.role} />
        </div>
        {onToggleEnabled && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleEnabled(!agent.enabled); }}
            title={agent.enabled ? "Enabled — click to disable" : "Disabled — click to enable"}
            className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${agent.enabled ? "bg-emerald-500" : "bg-white/15"}`}
          >
            <span className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${agent.enabled ? "left-[1.125rem]" : "left-0.5"}`} />
          </button>
        )}
      </div>

      {!compact && (
        <>
          <div className="mt-2.5 flex flex-wrap gap-1">
            <Badge tone="indigo"><Bot className="size-3" /> {agent.model_default}</Badge>
            <Badge tone="slate"><Gauge className="size-3" /> {agent.effort_default}</Badge>
            <Badge tone="slate">{agent.depth_default}</Badge>
            <AutonomyBadge level={agent.autonomy} />
            {agent.blocking && <Badge tone="rose"><ShieldCheck className="size-3" /> blocking</Badge>}
          </div>
          <div className="mt-2 flex items-center gap-3 text-[11px] text-white/40">
            {agent.max_concurrency > 1 && <span>×{agent.max_concurrency}</span>}
            <span>{agent.daily_token_budget == null ? "no budget cap" : `${agent.daily_token_budget.toLocaleString()} tok/day`}</span>
            {agent.skills.length > 0 && <span className="truncate">{agent.skills.slice(0, 3).join(" · ")}</span>}
          </div>
        </>
      )}
    </div>
  );
}
