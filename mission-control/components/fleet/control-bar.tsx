"use client";
import { Play, Pause, Square, Minus, Plus, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { useFleet } from "./use-fleet";

const PAUSE_LABEL: Record<string, string> = {
  paused: "Paused",
  stopped: "Stopped",
  breaker: "Circuit breaker",
  daycap: "Daily cap reached",
  budget: "Budget cap reached",
};

export function ControlBar() {
  const { status, desired, busy, patch, command } = useFleet();
  const confirm = useConfirm();
  // Knob settings: show the supervisor-EFFECTIVE values when the fleet is running (clamped),
  // otherwise the CONFIGURED state (fleet.json) — this way +/- stays visible even when the fleet is offline.
  const k =
    status?.knobs ??
    (desired
      ? {
          max_workers: desired.max_workers,
          max_pr_per_day: desired.max_pr_per_day,
          fail_break: desired.fail_break,
          router: desired.router,
          review: desired.review,
          effort: desired.effort,
          depth: desired.depth,
        }
      : null);
  const mode = status?.mode ?? desired?.mode ?? "running";
  const online = status?.online ?? false;

  return (
    <section className="glass p-4">
      {/* stats hero */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2.5">
          <span
            className={`grid size-8 place-items-center rounded-lg ${
              online ? "bg-emerald-500/15 glow-ok" : "bg-red-500/10 glow-danger"
            }`}
          >
            <span className={`size-2.5 rounded-full ${online ? "bg-emerald-400 animate-pulse" : "bg-red-500"}`} />
          </span>
          <span className="text-sm font-semibold">Fleet {online ? "online" : "offline"}</span>
          {status?.pause_reason && (
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300">
              {PAUSE_LABEL[status.pause_reason] ?? status.pause_reason}
            </span>
          )}
        </div>
        <Stat label="Active" value={`${status?.slots.length ?? 0}/${k?.max_workers ?? "—"}`} />
        <Stat label="PRs today" value={status?.prs_today ?? "—"} />
        <Stat label="Attempts" value={status?.attempts_today ?? "—"} />
        <Stat
          label="Breaker"
          value={status ? `${status.breaker.consecutive_fails}/${k?.fail_break ?? "—"}` : "—"}
          danger={status?.breaker.tripped}
        />

        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant={mode === "running" ? "accent" : "secondary"} disabled={busy}
            onClick={() => patch({ mode: "running" }, true)}>
            <Play className="size-3.5" /> Start
          </Button>
          <Button size="sm" variant={mode === "paused" ? "default" : "secondary"} disabled={busy}
            onClick={() => patch({ mode: "paused" })}>
            <Pause className="size-3.5" /> Pause
          </Button>
          <Button size="sm" variant={mode === "stopped" ? "destructive" : "secondary"} disabled={busy}
            onClick={async () => {
              if (await confirm({ title: "Stop the fleet?", body: "Running workers will be aborted. Tasks remain resumable.", tone: "danger", confirmLabel: "Stop fleet" }))
                patch({ mode: "stopped" }, true);
            }}>
            <Square className="size-3.5" /> Stop
          </Button>
        </div>
      </div>

      {/* buttons */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
        <Stepper label="Workers" value={k?.max_workers ?? null} busy={busy}
          onDelta={(d) => patch({ max_workers: Math.max(1, (k?.max_workers ?? 1) + d) }, true)} />
        <Stepper label="PR/day" value={k?.max_pr_per_day ?? null} busy={busy}
          onDelta={(d) => patch({ max_pr_per_day: Math.max(0, (k?.max_pr_per_day ?? 0) + d) }, true)} />
        <Stepper label="Breaker" value={k?.fail_break ?? null} busy={busy}
          onDelta={(d) => patch({ fail_break: Math.max(1, (k?.fail_break ?? 1) + d) }, true)} />
        <Select label="Model" value={k?.router ?? "auto"} options={["auto", "sonnet", "opus"]} busy={busy}
          onChange={async (v) => {
            if (v === "opus" && !(await confirm({ title: "Force Opus globally?", body: "Opus on every task can get expensive.", confirmLabel: "Use Opus" }))) return;
            patch({ router: v }, true);
          }} />
        <Select label="Effort" value={k?.effort ?? "medium"} options={["low", "medium", "high", "xhigh", "max"]} busy={busy}
          onChange={async (v) => {
            if ((v === "xhigh" || v === "max") && !(await confirm({ title: "High reasoning effort?", body: "Higher effort costs more tokens per task.", confirmLabel: "Continue" }))) return;
            patch({ effort: v }, true);
          }} />
        <Select label="Depth" value={k?.depth ?? "solo"} options={["solo", "orchestrate"]} busy={busy}
          onChange={async (v) => {
            if (v === "orchestrate" && !(await confirm({ title: "Orchestrate mode?", body: "Fans each agent out into sub-agents — deeper, but more tokens.", confirmLabel: "Orchestrate" }))) return;
            patch({ depth: v }, true);
          }} />
        <Select label="Review" value={k?.review ?? "on"} options={["on", "off"]} busy={busy}
          onChange={(v) => patch({ review: v })} />
        {status?.breaker?.tripped && (
          <Button size="sm" variant="outline" onClick={() => command("breaker-reset")}>
            <Zap className="size-3.5" /> Reset breaker
          </Button>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value, danger }: { label: string; value: string | number; danger?: boolean }) {
  return (
    <div className="leading-tight">
      <p className={`text-base font-semibold tabular-nums ${danger ? "text-red-400" : ""}`}>{value}</p>
      <p className="text-[11px] text-white/40">{label}</p>
    </div>
  );
}

function Stepper({ label, value, busy, onDelta }: { label: string; value: number | null; busy: boolean; onDelta: (d: number) => void }) {
  return (
    <div className="glass-card flex items-center gap-1 px-2 py-1">
      <span className="text-xs text-white/50">{label}</span>
      <button className="text-white/60 hover:text-white disabled:opacity-30" disabled={busy} onClick={() => onDelta(-1)} aria-label={`${label} down`}>
        <Minus className="size-3.5" />
      </button>
      <span className="min-w-[1.5ch] text-center text-sm font-semibold tabular-nums">{value ?? "—"}</span>
      <button className="text-white/60 hover:text-white disabled:opacity-30" disabled={busy} onClick={() => onDelta(1)} aria-label={`${label} up`}>
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}

function Select({ label, value, options, busy, onChange }: { label: string; value: string; options: string[]; busy: boolean; onChange: (v: string) => void }) {
  return (
    <label className="glass-card flex items-center gap-1.5 px-2 py-1 text-xs text-white/50">
      {label}
      <select className="bg-transparent text-sm font-semibold text-white outline-none" value={value} disabled={busy} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o} className="bg-[#0d1322] text-white">{o}</option>
        ))}
      </select>
    </label>
  );
}
