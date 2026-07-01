"use client";
// Read-only view of the agent registry (the team the fleet routes work to). Editing/CRUD is a later
// step; this makes the roster visible + gives the mobile nav a real "Agents" destination.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Users, Bot, ShieldCheck, Wrench, Tag, Eye, RefreshCw, Gauge } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/glass";
import { AgentAvatar } from "@/components/fleet/agent-meta";

type Agent = {
  id: string;
  name: string;
  role: string;
  skills: string[];
  enabled: boolean;
  model_default: string;
  effort_default: string;
  depth_default: string;
  allowed_tools: string[];
  review_of_roles: string[];
  blocking: boolean;
  label_scope: string[];
  max_concurrency: number;
  daily_token_budget: number | null;
};

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetch("/api/agents", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setAgents(j?.agents ?? []))
      .catch(() => setAgents([]))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const list = agents ?? [];
  const enabled = list.filter((a) => a.enabled).length;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6">
      <PageHeader
        className="mb-5"
        title={
          <span className="inline-flex items-center gap-2.5">
            <span className="glass-card grid size-9 place-items-center rounded-xl text-emerald-300"><Users className="size-[18px]" /></span>
            Agents
          </span>
        }
        subtitle={loading ? "Loading the roster…" : `${enabled}/${list.length} enabled · config-driven team — tap an agent for memory, performance and feedback`}
        actions={
          <Button variant="outline" size="sm" className="h-10" onClick={load}>
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        }
      />

      {loading && !agents ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="glass-card h-44 animate-pulse" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState icon={Users} title="No agents configured" hint="Seed control/agents.json from deploy/agents.default.json on the server." />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((a) => (
            <Link
              key={a.id}
              href={`/agents/${a.id}`}
              className={`glass-card glass-hover flex flex-col p-4 ${a.enabled ? "" : "opacity-60"}`}
            >
              <div className="flex items-center gap-2.5">
                <div className="relative shrink-0">
                  <AgentAvatar name={a.name} role={a.role} className="size-9 text-xs" />
                  <span className={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-[#0d1322] ${a.enabled ? "bg-emerald-400" : "bg-white/25"}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold capitalize text-white">{a.role}</p>
                  <p className="truncate text-xs text-white/40">{a.name}</p>
                </div>
                {a.blocking && (
                  <Badge tone="rose" className="ml-auto shrink-0">
                    <ShieldCheck className="size-3" /> blocking
                  </Badge>
                )}
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge tone="indigo">
                  <Bot className="size-3" /> {a.model_default}
                </Badge>
                <Badge tone="slate">
                  <Gauge className="size-3" /> {a.effort_default}
                </Badge>
                <Badge tone="slate">{a.depth_default}</Badge>
                {a.max_concurrency > 1 && <Badge tone="slate">×{a.max_concurrency}</Badge>}
              </div>

              {a.skills.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {a.skills.slice(0, 6).map((s) => (
                    <span key={s} className="rounded bg-white/5 px-1.5 py-0.5 text-[11px] text-white/55">{s}</span>
                  ))}
                  {a.skills.length > 6 && <span className="text-[11px] text-white/30">+{a.skills.length - 6}</span>}
                </div>
              )}

              <div className="mt-auto space-y-1 pt-3 text-[11px] text-white/45">
                {a.review_of_roles.length > 0 && (
                  <p className="flex items-center gap-1.5">
                    <Eye className="size-3 shrink-0" /> reviews {a.review_of_roles.join(", ")}
                  </p>
                )}
                {a.label_scope.length > 0 && (
                  <p className="flex items-center gap-1.5">
                    <Tag className="size-3 shrink-0" /> {a.label_scope.join(", ")}
                  </p>
                )}
                {a.allowed_tools.length > 0 && (
                  <p className="flex items-center gap-1.5">
                    <Wrench className="size-3 shrink-0" /> {a.allowed_tools.length} tools
                  </p>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
