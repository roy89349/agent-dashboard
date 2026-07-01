"use client";
// Context Inspector — "what would the agent receive and why". Compiles a real ContextPackage via
// the server (no invented data) and shows every candidate block: included or explicitly excluded,
// with tokens (estimates), relevance and the reason for the decision.
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Loader2, SearchCode, XCircle } from "lucide-react";
import { SectionLabel } from "@/components/ui/glass";
import { Button } from "@/components/ui/button";
import { Badge, type Tone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { useFacets } from "@/components/analytics/parts";
import type { ContextPackage } from "@/lib/token-optimization/types";
import { TokenTag, fmt } from "./parts";

const RISKS = ["low", "medium", "high", "critical"] as const;
const FALLBACK_TONE: Record<ContextPackage["fallback"], Tone> = { ok: "emerald", summarize_first: "amber", needs_approval: "red" };
const FALLBACK_LABEL: Record<ContextPackage["fallback"], string> = { ok: "fits budget", summarize_first: "summarize first", needs_approval: "needs approval" };

const inputCls =
  "min-h-11 w-full rounded-lg border border-white/10 bg-white/[0.05] px-2.5 text-sm text-white outline-none backdrop-blur-md placeholder:text-white/25 focus:border-emerald-500/40";

export function ContextInspector() {
  const { agents } = useFacets();
  const [goal, setGoal] = useState("");
  const [agentId, setAgentId] = useState("");
  const [role, setRole] = useState("");
  const [risk, setRisk] = useState<(typeof RISKS)[number]>("low");
  const [logTail, setLogTail] = useState("");
  const [diff, setDiff] = useState("");
  const [pkg, setPkg] = useState<ContextPackage | null>(null);
  const [busy, setBusy] = useState(false);

  async function compile() {
    if (!goal.trim()) {
      toast.error("A goal is required");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/token-optimization/context-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          goal,
          agent_id: agentId || undefined,
          role: role || undefined,
          risk,
          raw_log_tail: logTail || undefined,
          raw_diff: diff || undefined,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) toast.error(j.error ?? "Compile failed");
      else setPkg(j.package);
    } catch {
      toast.error("Compile failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="glass p-4">
        <SectionLabel className="mb-1">Compile a context package</SectionLabel>
        <p className="mb-3 text-xs text-white/40">Preview exactly what an agent would receive for a task — every block, every exclusion, every reason. All token counts are estimates.</p>
        <div className="space-y-3">
          <label className="block text-xs text-white/50">
            Goal <span className="text-red-300">*</span>
            <textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={2} placeholder="e.g. Fix the failing login redirect on slipbase issue #42" className={`${inputCls} mt-1 py-2`} />
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="block text-xs text-white/50">
              Agent (optional)
              <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className={`${inputCls} mt-1`}>
                <option value="" className="bg-[#0d1322]">— none —</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id} className="bg-[#0d1322]">{a.name}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-white/50">
              Role (optional)
              <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. builder" className={`${inputCls} mt-1`} />
            </label>
            <label className="block text-xs text-white/50">
              Risk
              <select value={risk} onChange={(e) => setRisk(e.target.value as (typeof RISKS)[number])} className={`${inputCls} mt-1`}>
                {RISKS.map((r) => (
                  <option key={r} value={r} className="bg-[#0d1322]">{r}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-xs text-white/50">
              Raw log tail (optional — will be compressed)
              <textarea value={logTail} onChange={(e) => setLogTail(e.target.value)} rows={4} placeholder="Paste a log tail…" className={`${inputCls} mt-1 py-2 font-mono text-xs`} />
            </label>
            <label className="block text-xs text-white/50">
              Raw diff (optional — will be compressed)
              <textarea value={diff} onChange={(e) => setDiff(e.target.value)} rows={4} placeholder="Paste a diff…" className={`${inputCls} mt-1 py-2 font-mono text-xs`} />
            </label>
          </div>
          <Button onClick={compile} disabled={busy} variant="accent" className="min-h-11 w-full sm:w-auto">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <SearchCode className="size-4" />} Compile preview
          </Button>
        </div>
      </section>

      {!pkg && !busy && (
        <EmptyState icon={SearchCode} title="No preview yet" hint="Enter a goal and compile to see exactly which context blocks would be sent and why." tone="indigo" />
      )}

      {pkg && <PackageView pkg={pkg} />}
    </div>
  );
}

function PackageView({ pkg }: { pkg: ContextPackage }) {
  const included = pkg.blocks.filter((b) => b.included);
  const excluded = pkg.blocks.filter((b) => !b.included);
  return (
    <section className="glass p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SectionLabel>Compiled package</SectionLabel>
        <Badge tone="indigo">mode: {pkg.mode}</Badge>
        <Badge tone="slate">budget {fmt(pkg.token_budget)} tok</Badge>
        <Badge tone={pkg.estimated_tokens > pkg.token_budget ? "red" : "emerald"}>
          {fmt(pkg.estimated_tokens)} tok <TokenTag source="estimate" />
        </Badge>
        <Badge tone={FALLBACK_TONE[pkg.fallback]}>{FALLBACK_LABEL[pkg.fallback]}</Badge>
      </div>

      {pkg.needs_raw_context && (
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3 text-xs text-amber-200/90 glow-warn">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span><b>Needs raw context.</b> A low-confidence compression happened on important material — the agent may need to request the raw source.</span>
        </div>
      )}

      <SectionLabel className="mb-1.5">Included blocks ({included.length})</SectionLabel>
      <div className="mb-4 space-y-1.5">
        {included.length === 0 && <p className="text-xs text-white/30">No blocks fit the budget.</p>}
        {included.map((b, i) => <BlockRow key={`${b.kind}-${i}`} b={b} />)}
      </div>

      <SectionLabel className="mb-1.5">Excluded blocks ({excluded.length})</SectionLabel>
      <div className="space-y-1.5">
        {excluded.length === 0 && <p className="text-xs text-white/30">Nothing was excluded.</p>}
        {excluded.map((b, i) => <BlockRow key={`${b.kind}-${i}`} b={b} />)}
      </div>

      {pkg.explicit_exclusions.length > 0 && (
        <>
          <SectionLabel className="mb-1.5 mt-4">Explicit exclusions</SectionLabel>
          <div className="space-y-1.5">
            {pkg.explicit_exclusions.map((x, i) => (
              <div key={i} className="glass-inset flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                <XCircle className="size-3.5 shrink-0 text-red-300/70" />
                <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-white/50">{x.kind}</span>
                <span className="min-w-0 flex-1 truncate text-white/70">{x.title}</span>
                <span className="tabular-nums text-white/35">{fmt(x.tokens)} tok</span>
                <span className="w-full text-white/40 sm:w-auto">{x.reason}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function BlockRow({ b }: { b: (ContextPackage["blocks"])[number] }) {
  return (
    <div className="glass-card flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
      {b.included ? <CheckCircle2 className="size-4 shrink-0 text-emerald-300" /> : <XCircle className="size-4 shrink-0 text-red-300/70" />}
      <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-white/50">{b.kind}</span>
      <span className="min-w-0 flex-1 truncate font-medium text-white/80" title={b.title}>{b.title}</span>
      {b.compressed && <Badge tone="indigo">compressed</Badge>}
      {b.cache_hit && <Badge tone="teal">cache hit</Badge>}
      <span className="shrink-0 tabular-nums text-white/45">{fmt(b.tokens)} tok</span>
      <TokenTag source="estimate" />
      <span className="shrink-0 tabular-nums text-white/35">rel {b.relevance.toFixed(2)}</span>
      <span className="w-full text-white/40">{b.reason}</span>
    </div>
  );
}
