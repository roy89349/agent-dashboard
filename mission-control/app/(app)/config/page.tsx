"use client";
import { useEffect, useState } from "react";
import { ControlBar } from "@/components/fleet/control-bar";

type Cfg = {
  projectName: string | null;
  projectDesc: string | null;
  repo: string | null;
  fleetDir: string | null;
  hasVault: boolean;
  githubTokenSet: boolean;
  allowGlobalOpus: boolean;
  hardMaxWorkers: number;
  hardMaxPrPerDay: number;
  maxAttemptsPerDay: number;
};

function Row({ label, value, warn }: { label: string; value: React.ReactNode; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/5 py-2 last:border-0">
      <span className="text-sm text-white/50">{label}</span>
      <span className={`text-sm tabular-nums ${warn ? "text-amber-400" : "text-white/90"}`}>{value}</span>
    </div>
  );
}

export default function ConfigPage() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  useEffect(() => {
    fetch("/api/config", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setCfg)
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-4 p-4">
      <ControlBar />

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <h2 className="mb-1 text-sm font-semibold">Install configuration</h2>
        <p className="mb-3 text-xs text-white/40">
          Read-only. Change these in <code className="text-white/60">config.local.env</code> /{" "}
          <code className="text-white/60">mission-control/.env.local</code> (or rerun <code className="text-white/60">./setup.sh</code>).
        </p>
        {!cfg ? (
          <p className="text-sm text-white/30">Loading…</p>
        ) : (
          <div>
            <Row label="Project" value={cfg.projectName ?? "—"} />
            {cfg.projectDesc && <Row label="Stack / context" value={cfg.projectDesc} />}
            <Row label="GitHub repo" value={cfg.repo ?? "not set"} warn={!cfg.repo} />
            <Row label="Fleet directory" value={cfg.fleetDir ?? "—"} />
            <Row label="GitHub token (board)" value={cfg.githubTokenSet ? "set" : "not set"} warn={!cfg.githubTokenSet} />
            <Row label="Knowledge vault" value={cfg.hasVault ? "configured" : "none"} />
            <Row label="Force opus allowed" value={cfg.allowGlobalOpus ? "yes" : "no"} />
            <Row label="Ceiling · max workers" value={cfg.hardMaxWorkers} />
            <Row label="Ceiling · PRs/day" value={cfg.hardMaxPrPerDay} />
            <Row label="Ceiling · build attempts/day" value={cfg.maxAttemptsPerDay} />
          </div>
        )}
      </section>
    </div>
  );
}
