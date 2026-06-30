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

type PhoneCfg = {
  provider: string;
  implemented: boolean;
  configured: boolean;
  setupError: string | null;
  webhookUrl: string;
  publicUrlSet: boolean;
  allowedChatSet: boolean;
  lastCommand: { ts: string; text: string } | null;
  lastError: { ts: string; error: string } | null;
};

function PhoneSection() {
  const [p, setP] = useState<PhoneCfg | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string>("");

  const load = () => {
    fetch("/api/integrations/phone", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then(setP).catch(() => {});
    fetch("/api/approvals?status=pending", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setP && setPending(d?.approvals?.length ?? 0))
      .catch(() => {});
  };
  useEffect(load, []);

  const sendTest = async () => {
    setTesting(true);
    setTestMsg("");
    try {
      const r = await fetch("/api/integrations/phone", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      setTestMsg(r.ok ? "Sent — check your phone." : `Failed: ${j.error ?? r.status}`);
    } finally {
      setTesting(false);
      load();
    }
  };

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <h2 className="mb-1 text-sm font-semibold">Phone command interface</h2>
      <p className="mb-3 text-xs text-white/40">
        Control the fleet from one chat app. Set the env vars + webhook (see{" "}
        <code className="text-white/60">docs/phone-command-interface.md</code>). The dashboard stays the source of truth.
      </p>
      {!p ? (
        <p className="text-sm text-white/30">Loading…</p>
      ) : (
        <div>
          <Row label="Provider" value={p.provider} />
          <Row label="Status" value={p.configured ? "configured ✓" : "not configured"} warn={!p.configured} />
          {p.setupError && <Row label="Setup" value={p.setupError} warn />}
          <Row label="Allowed chat id" value={p.allowedChatSet ? "set" : "not set"} warn={!p.allowedChatSet} />
          <Row label="Webhook URL" value={<span className="break-all">{p.webhookUrl}</span>} warn={!p.publicUrlSet} />
          <Row label="Pending approvals" value={pending ?? "—"} warn={(pending ?? 0) > 0} />
          {p.lastCommand && <Row label="Last command" value={`${p.lastCommand.text} · ${p.lastCommand.ts.slice(11, 19)}`} />}
          {p.lastError && <Row label="Last error" value={p.lastError.error} warn />}
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={sendTest}
              disabled={!p.configured || testing}
              className="rounded-lg border border-white/15 bg-white/[0.04] px-3 py-1.5 text-sm text-white/80 hover:bg-white/[0.08] disabled:opacity-40"
            >
              {testing ? "Sending…" : "Send test message"}
            </button>
            {testMsg && <span className="text-xs text-white/50">{testMsg}</span>}
          </div>
        </div>
      )}
    </section>
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

      <PhoneSection />
    </div>
  );
}
