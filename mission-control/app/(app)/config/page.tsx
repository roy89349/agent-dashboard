"use client";
import { useEffect, useState } from "react";
import { ControlBar } from "@/components/fleet/control-bar";
import { GlassPanel, SectionLabel } from "@/components/ui/glass";
import { Badge } from "@/components/ui/badge";

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

// One read-only config value: label + mono value, amber chip when missing/unset.
function Item({ label, value, warn }: { label: string; value: React.ReactNode; warn?: boolean }) {
  return (
    <div className="glass-card min-w-0 px-3.5 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-white/40">{label}</p>
      <div className="mt-1 break-all font-mono text-[13px] leading-snug text-white/90">
        {warn ? <Badge tone="amber">{value}</Badge> : value}
      </div>
    </div>
  );
}

function Group({ id, title, hint, children }: { id?: string; title: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20">
      <SectionLabel className="mb-2">{title}</SectionLabel>
      {hint && <p className="mb-2 text-xs text-white/40">{hint}</p>}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
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
      .then((d) => setPending(d?.approvals?.length ?? 0))
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
    <Group
      id="phone"
      title="Phone"
      hint={
        <>
          Control the fleet from one chat app. Set the env vars + webhook (see{" "}
          <code className="text-white/60">docs/phone-command-interface.md</code>). The dashboard stays the source of truth.
        </>
      }
    >
      {!p ? (
        <p className="text-sm text-white/30">Loading…</p>
      ) : (
        <>
          <Item label="Provider" value={p.provider} />
          <Item label="Status" value={p.configured ? "configured ✓" : "not configured"} warn={!p.configured} />
          {p.setupError && <Item label="Setup" value={p.setupError} warn />}
          <Item label="Allowed chat id" value={p.allowedChatSet ? "set" : "not set"} warn={!p.allowedChatSet} />
          <Item label="Webhook URL" value={p.webhookUrl} warn={!p.publicUrlSet} />
          <Item label="Pending approvals" value={pending ?? "—"} warn={(pending ?? 0) > 0} />
          {p.lastCommand && <Item label="Last command" value={`${p.lastCommand.text} · ${p.lastCommand.ts.slice(11, 19)}`} />}
          {p.lastError && <Item label="Last error" value={p.lastError.error} warn />}
          <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-3">
            <button
              onClick={sendTest}
              disabled={!p.configured || testing}
              className="glass-card glass-hover px-3 py-1.5 text-sm font-medium text-white/80 disabled:pointer-events-none disabled:opacity-40"
            >
              {testing ? "Sending…" : "Send test message"}
            </button>
            {testMsg && <span className="text-xs text-white/50">{testMsg}</span>}
          </div>
        </>
      )}
    </Group>
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

      <GlassPanel className="space-y-6 p-4 sm:p-5">
        <div>
          <h2 className="text-sm font-semibold text-white">Install configuration</h2>
          <p className="mt-1 text-xs text-white/40">
            Read-only. Change these in <code className="text-white/60">config.local.env</code> /{" "}
            <code className="text-white/60">mission-control/.env.local</code> (or rerun <code className="text-white/60">./setup.sh</code>).
          </p>
        </div>

        {!cfg ? (
          <p className="text-sm text-white/30">Loading…</p>
        ) : (
          <>
            <Group title="Fleet">
              <Item label="Project" value={cfg.projectName ?? "not set"} warn={!cfg.projectName} />
              {cfg.projectDesc && <Item label="Stack / context" value={cfg.projectDesc} />}
              <Item label="Force opus allowed" value={cfg.allowGlobalOpus ? "yes" : "no"} />
            </Group>

            <Group title="GitHub">
              <Item label="GitHub repo" value={cfg.repo ?? "not set"} warn={!cfg.repo} />
            </Group>

            <Group title="Sandbox">
              <Item label="Fleet directory" value={cfg.fleetDir ?? "not set"} warn={!cfg.fleetDir} />
            </Group>

            <Group title="Knowledge">
              <Item label="Knowledge vault" value={cfg.hasVault ? "configured" : "none"} warn={!cfg.hasVault} />
            </Group>

            <Group title="Limits">
              <Item label="Ceiling · max workers" value={cfg.hardMaxWorkers} />
              <Item label="Ceiling · PRs/day" value={cfg.hardMaxPrPerDay} />
              <Item label="Ceiling · build attempts/day" value={cfg.maxAttemptsPerDay} />
            </Group>

            <Group title="Security">
              <Item label="GitHub token (board)" value={cfg.githubTokenSet ? "set" : "not set"} warn={!cfg.githubTokenSet} />
            </Group>
          </>
        )}

        <PhoneSection />
      </GlassPanel>
    </div>
  );
}
