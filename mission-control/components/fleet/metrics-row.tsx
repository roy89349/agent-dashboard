"use client";
// Dashboard metrics row — reuses the existing /api/war-room health payload (no new backend).
// Polls slowly (15 s) and pauses on a hidden tab; every tile links to its source screen.
import { useEffect, useState } from "react";
import { Users, Inbox, GitBranch, OctagonAlert, GitPullRequest, Gauge } from "lucide-react";
import { MetricCard } from "@/components/ui/glass";
import type { WarRoomHealth } from "@/lib/war-room";

export function MetricsRow() {
  const [health, setHealth] = useState<WarRoomHealth | null>(null);

  useEffect(() => {
    let alive = true;
    async function poll() {
      if (document.visibilityState === "hidden") return;
      try {
        const r = await fetch("/api/war-room", { cache: "no-store" });
        if (r.ok && alive) setHealth((await r.json()).health ?? null);
      } catch {
        /* offline — keep the last snapshot */
      }
    }
    poll();
    const id = setInterval(poll, 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const h = health;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      <MetricCard
        label="Active agents"
        value={h ? `${h.agents.active}/${h.agents.total}` : "—"}
        icon={Users}
        href="/agents"
      />
      <MetricCard
        label="Open decisions"
        value={h?.open_decisions ?? "—"}
        tone={h && h.open_decisions > 0 ? "warn" : "default"}
        icon={Inbox}
        href="/approvals"
      />
      <MetricCard
        label="Running workflows"
        value={h?.workflows_running ?? "—"}
        icon={GitBranch}
        href="/workflows"
      />
      <MetricCard
        label="Blockers"
        value={h?.blockers ?? "—"}
        tone={h && h.blockers > 0 ? "danger" : "default"}
        icon={OctagonAlert}
        href="/work-items"
      />
      <MetricCard
        label="PRs ready"
        value={h?.prs_ready ?? "—"}
        tone={h && h.prs_ready > 0 ? "ok" : "default"}
        icon={GitPullRequest}
        href="/war-room"
      />
      <MetricCard
        label="Budget"
        value={h?.budget_warning ? "warning" : "OK"}
        hint={h?.budget_warning ?? "no warnings"}
        tone={h?.budget_warning ? "warn" : "default"}
        icon={Gauge}
        href="/costs"
      />
    </div>
  );
}
