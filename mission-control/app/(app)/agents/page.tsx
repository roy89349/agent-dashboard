"use client";
// Read-only view of the agent registry (the team the fleet routes work to). Editing/CRUD is a later
// step; this makes the roster visible + gives the mobile nav a real "Agents" destination.
import { useEffect, useState } from "react";
import { Users, Bot, ShieldCheck, Wrench, Tag, Eye, RefreshCw, Gauge } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";

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
      <div className="mb-4 flex items-center gap-3">
        <div className="grid size-9 place-items-center rounded-xl border border-white/10 bg-white/5 text-emerald-300">
          <Users className="size-[18px]" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-white">Agents</h2>
          <p className="text-xs text-white/40">
            {loading ? "Loading the roster…" : `${enabled}/${list.length} enabled · config-driven team`}
          </p>
        </div>
        <button
          onClick={load}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/50 hover:bg-white/5"
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {loading && !agents ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-44 animate-pulse rounded-2xl border border-white/10 bg-white/[0.03]" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState icon={Users} title="No agents configured" hint="Seed control/agents.json from deploy/agents.default.json on the server." />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((a) => (
            <article
              key={a.id}
              className={`flex flex-col rounded-2xl border p-4 ${
                a.enabled ? "border-white/10 bg-white/[0.03]" : "border-white/5 bg-white/[0.015] opacity-60"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`size-2 shrink-0 rounded-full ${a.enabled ? "bg-emerald-400" : "bg-white/25"}`} />
                <span className="truncate font-semibold capitalize text-white">{a.role}</span>
                {a.blocking && (
                  <Badge tone="rose" className="ml-auto">
                    <ShieldCheck className="size-3" /> blocking
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 truncate text-xs text-white/40">{a.name}</p>

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
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
