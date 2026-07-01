"use client";
// Budget Policies — per-scope overrides of the mode defaults. Everything the form sends is
// re-validated and clamped server-side; MODE_DEFAULTS are shown as reference cards.
import { useState } from "react";
import { toast } from "sonner";
import { Plus, ShieldCheck, Trash2, Pencil } from "lucide-react";
import { SectionLabel, GlassCard } from "@/components/ui/glass";
import { Button } from "@/components/ui/button";
import { Badge, type Tone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { useConfirm } from "@/components/ui/confirm";
import type { BudgetPolicy, OptimizationMode } from "@/lib/token-optimization/types";
import { Skeleton, fmt } from "./parts";

export type ModeDefaults = Record<OptimizationMode, { max_context_tokens: number; max_run_tokens: number; max_retries: number; approval_threshold_tokens: number }> | null;

const SCOPES = ["agent", "team", "workflow", "task", "day", "model"] as const;
const MODES: OptimizationMode[] = ["economy", "balanced", "high_quality", "emergency"];
const MODE_TONE: Record<OptimizationMode, Tone> = { economy: "teal", balanced: "emerald", high_quality: "indigo", emergency: "red" };

type FormState = {
  scope: (typeof SCOPES)[number];
  scope_id: string;
  mode: OptimizationMode;
  max_context_tokens: string;
  max_run_tokens: string;
  max_day_tokens: string;
  max_retries: string;
  approval_threshold_tokens: string;
};
const EMPTY_FORM: FormState = { scope: "agent", scope_id: "*", mode: "balanced", max_context_tokens: "", max_run_tokens: "", max_day_tokens: "", max_retries: "", approval_threshold_tokens: "" };

const inputCls =
  "mt-1 min-h-11 w-full rounded-lg border border-white/10 bg-white/[0.05] px-2.5 text-sm text-white outline-none backdrop-blur-md placeholder:text-white/25 focus:border-emerald-500/40";

export function BudgetPolicies({
  policies,
  modeDefaults,
  loading,
  onChanged,
}: {
  policies: BudgetPolicy[] | null;
  modeDefaults: ModeDefaults;
  loading: boolean;
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  const [formOpen, setFormOpen] = useState(false);
  const [f, setF] = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  function edit(p: BudgetPolicy) {
    setF({
      scope: p.scope as FormState["scope"],
      scope_id: p.scope_id,
      mode: p.mode,
      max_context_tokens: p.max_context_tokens != null ? String(p.max_context_tokens) : "",
      max_run_tokens: p.max_run_tokens != null ? String(p.max_run_tokens) : "",
      max_day_tokens: p.max_day_tokens != null ? String(p.max_day_tokens) : "",
      max_retries: p.max_retries != null ? String(p.max_retries) : "",
      approval_threshold_tokens: p.approval_threshold_tokens != null ? String(p.approval_threshold_tokens) : "",
    });
    setFormOpen(true);
  }

  async function save() {
    if (!f.scope_id.trim()) {
      toast.error("Scope id is required ('*' = scope default)");
      return;
    }
    setBusy(true);
    try {
      const num = (v: string) => (v.trim() === "" ? undefined : Number(v));
      const r = await fetch("/api/token-optimization/policies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scope: f.scope,
          scope_id: f.scope_id.trim(),
          mode: f.mode,
          max_context_tokens: num(f.max_context_tokens),
          max_run_tokens: num(f.max_run_tokens),
          max_day_tokens: num(f.max_day_tokens),
          max_retries: num(f.max_retries),
          approval_threshold_tokens: num(f.approval_threshold_tokens),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) toast.error(j.error ?? "Save failed");
      else {
        toast.success("Policy saved");
        setFormOpen(false);
        setF(EMPTY_FORM);
        onChanged();
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: BudgetPolicy) {
    const ok = await confirm({
      title: "Delete budget policy?",
      body: `${p.scope}:${p.scope_id} falls back to the mode defaults after deletion.`,
      tone: "danger",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    const r = await fetch(`/api/token-optimization/policies?scope=${encodeURIComponent(p.scope)}&scope_id=${encodeURIComponent(p.scope_id)}`, { method: "DELETE" });
    if (r.ok) {
      toast.success("Policy deleted");
      onChanged();
    } else toast.error("Delete failed");
  }

  const numField = (k: keyof FormState, label: string, hint?: string) => (
    <label className="block text-xs text-white/50">
      {label}
      {hint && <span className="text-white/25"> · {hint}</span>}
      <input type="number" min={0} value={f[k]} placeholder="mode default" onChange={(e) => setF({ ...f, [k]: e.target.value })} className={inputCls} />
    </label>
  );

  return (
    <div className="space-y-4">
      <section className="glass p-4">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <SectionLabel>Budget policies</SectionLabel>
          <Button size="sm" className="min-h-11" onClick={() => { setF(EMPTY_FORM); setFormOpen(!formOpen); }}>
            <Plus className="size-4" /> {formOpen ? "Close" : "Add policy"}
          </Button>
        </div>

        {formOpen && (
          <div className="glass-inset mb-4 space-y-3 p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="block text-xs text-white/50">
                Scope
                <select value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value as FormState["scope"] })} className={inputCls}>
                  {SCOPES.map((s) => <option key={s} value={s} className="bg-[#0d1322]">{s}</option>)}
                </select>
              </label>
              <label className="block text-xs text-white/50">
                Scope id <span className="text-white/25">· &apos;*&apos; = scope default</span>
                <input value={f.scope_id} onChange={(e) => setF({ ...f, scope_id: e.target.value })} placeholder="agent id, workflow id, …" className={inputCls} />
              </label>
              <label className="block text-xs text-white/50">
                Mode
                <select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value as OptimizationMode })} className={inputCls}>
                  {MODES.map((m) => <option key={m} value={m} className="bg-[#0d1322]">{m}</option>)}
                </select>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {numField("max_context_tokens", "Max context", "tok")}
              {numField("max_run_tokens", "Max / run", "tok")}
              {numField("max_day_tokens", "Max / day", "tok")}
              {numField("max_retries", "Max retries")}
              {numField("approval_threshold_tokens", "Approval above", "tok")}
            </div>
            <p className="text-[11px] text-white/30">Empty fields fall back to the mode defaults below. Everything is validated and clamped server-side.</p>
            <Button onClick={save} disabled={busy} variant="accent" className="min-h-11 w-full sm:w-auto">Save policy</Button>
          </div>
        )}

        {loading && !policies ? (
          <Skeleton className="h-24" />
        ) : !policies || policies.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="No budget policies" hint="Every scope currently uses the global mode defaults. Add a policy to give an agent, team or workflow its own ceilings." tone="slate" />
        ) : (
          <div className="space-y-1.5">
            {policies.map((p) => (
              <div key={p.id} className="glass-card flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/50">{p.scope}</span>
                <span className="min-w-0 flex-1 truncate font-medium text-white/80" title={p.scope_id}>{p.scope_id}</span>
                <Badge tone={MODE_TONE[p.mode]}>{p.mode}</Badge>
                <span className="tabular-nums text-white/40">ctx {fmt(p.max_context_tokens)} · run {fmt(p.max_run_tokens)} · day {fmt(p.max_day_tokens)} · retries {fmt(p.max_retries)} · approval &gt; {fmt(p.approval_threshold_tokens)}</span>
                <span className="ml-auto flex shrink-0 gap-1">
                  <button onClick={() => edit(p)} aria-label={`Edit ${p.scope}:${p.scope_id}`} className="grid size-11 place-items-center rounded-lg text-white/40 hover:bg-white/10 hover:text-white"><Pencil className="size-4" /></button>
                  <button onClick={() => remove(p)} aria-label={`Delete ${p.scope}:${p.scope_id}`} className="grid size-11 place-items-center rounded-lg text-red-300/60 hover:bg-red-500/10 hover:text-red-300"><Trash2 className="size-4" /></button>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {modeDefaults && (
        <section className="glass p-4">
          <SectionLabel className="mb-2.5">Mode defaults (reference — server ceilings, estimate-space)</SectionLabel>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {MODES.map((m) => {
              const d = modeDefaults[m];
              return (
                <GlassCard key={m} className="p-3">
                  <Badge tone={MODE_TONE[m]}>{m}</Badge>
                  <dl className="mt-2 space-y-0.5 text-[11px] text-white/50">
                    <div className="flex justify-between gap-2"><dt>Max context</dt><dd className="tabular-nums text-white/75">{fmt(d.max_context_tokens)}</dd></div>
                    <div className="flex justify-between gap-2"><dt>Max / run</dt><dd className="tabular-nums text-white/75">{fmt(d.max_run_tokens)}</dd></div>
                    <div className="flex justify-between gap-2"><dt>Max retries</dt><dd className="tabular-nums text-white/75">{d.max_retries}</dd></div>
                    <div className="flex justify-between gap-2"><dt>Approval above</dt><dd className="tabular-nums text-white/75">{fmt(d.approval_threshold_tokens)}</dd></div>
                  </dl>
                </GlassCard>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
