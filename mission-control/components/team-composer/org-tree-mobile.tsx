"use client";
// Mobile fallback for the canvas: a vertical, depth-indented, tappable tree (lead on top). Non-reports_to
// connections are summarised as inline chips so the org structure stays legible without free-draw.
import { computeLayout } from "@/lib/team-layout";
import { AgentCard } from "./agent-card";
import { EDGE_STYLE } from "./edges";
import type { Team, Agent } from "@/lib/types";

export function OrgTreeMobile({
  team,
  agentById,
  selectedAgent,
  onSelectAgent,
}: {
  team: Team;
  agentById: (id: string) => Agent | null;
  selectedAgent: string | null;
  onSelectAgent: (id: string) => void;
}) {
  const pos = computeLayout(team);
  const ordered = [...team.members].sort((a, b) => (pos.get(a)?.depth ?? 0) - (pos.get(b)?.depth ?? 0));
  const outEdges = (id: string) => team.edges.filter((e) => e.from === id && e.kind !== "reports_to");

  if (team.members.length === 0)
    return <p className="py-12 text-center text-sm text-white/40">Empty team — add agents or build a recommended team.</p>;

  return (
    <div className="space-y-2.5 p-3">
      {ordered.map((id) => {
        const depth = pos.get(id)?.depth ?? 0;
        const outs = outEdges(id);
        return (
          <div key={id} style={{ paddingLeft: Math.min(depth, 4) * 16 }}>
            <div className="relative">
              {depth > 0 && <span className="absolute -left-2 top-0 h-full w-px bg-white/10" />}
              <AgentCard agent={agentById(id)} ghostId={id} isLead={team.lead === id} selected={selectedAgent === id} onClick={() => onSelectAgent(id)} />
              {outs.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1 pl-1">
                  {outs.map((e, i) => (
                    <span key={i} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-white/45">
                      {EDGE_STYLE[e.kind].label} → {agentById(e.to)?.name ?? e.to}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
