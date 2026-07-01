"use client";
// The visual pipeline: an ordered vertical timeline of steps with per-step status, role, required skills,
// approval state, output and retries. The CURRENT running/review step exposes the state-machine actions.
import { useState } from "react";
import { CheckCircle2, XCircle, Ban, SkipForward, ShieldCheck, Send } from "lucide-react";
import { RoleChip } from "@/components/fleet/agent-meta";
import { StepStatusBadge } from "./workflow-badges";
import type { WorkflowStep, WorkflowStepStatus } from "@/lib/workflows";

const DOT: Record<WorkflowStepStatus, string> = {
  queued: "border-white/25 bg-white/5", running: "border-emerald-400 bg-emerald-500/30 animate-pulse",
  blocked: "border-red-400 bg-red-500/30", waiting_user: "border-amber-400 bg-amber-500/30",
  review: "border-indigo-400 bg-indigo-500/30", failed: "border-red-400 bg-red-500/40",
  done: "border-emerald-400 bg-emerald-500/40", skipped: "border-white/20 bg-white/5",
};

// glass node surface per step status — blocked / waiting-on-you / failed states stand out with quiet glows
const NODE: Partial<Record<WorkflowStepStatus, string>> = {
  waiting_user: "glow-warn border-amber-400/40 bg-amber-500/[0.05]",
  blocked: "glow-warn border-amber-400/40 bg-amber-500/[0.05]",
  failed: "glow-danger border-red-500/40 bg-red-500/[0.05]",
};

export function WorkflowStepper({
  steps, currentStepId, terminal, agentName, onOp, busy,
}: {
  steps: WorkflowStep[];
  currentStepId: string | null;
  terminal: boolean;
  agentName: (id?: string | null) => string | null;
  onOp: (op: string, stepId: string, extra?: Record<string, unknown>) => void;
  busy: boolean;
}) {
  return (
    <ol className="relative space-y-1">
      {steps.map((s, i) => {
        const isCurrent = s.id === currentStepId;
        const last = i === steps.length - 1;
        return (
          <li key={s.id} className="relative flex gap-3 pb-3">
            {!last && <span aria-hidden className="absolute left-[11px] top-6 h-full w-px bg-gradient-to-b from-white/15 to-white/5" />}
            <span className={`z-10 mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border ${DOT[s.status] ?? DOT.queued}`}>
              <span className="text-[10px] font-semibold tabular-nums text-white/70">{i + 1}</span>
            </span>
            <div className={`min-w-0 flex-1 rounded-xl border px-3 py-2.5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] backdrop-blur-[10px] ${NODE[s.status] ?? (isCurrent ? "border-emerald-400/40 bg-emerald-500/[0.05]" : "border-white/10 bg-white/[0.03]")}`}>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-white/90">{s.name}</p>
                <StepStatusBadge status={s.status} />
                {s.approval_required && <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-px text-[10px] text-amber-300"><ShieldCheck className="size-3" /> approval gate</span>}
                {s.max_attempts > 1 && <span className="text-[10px] text-white/40 tabular-nums">try {s.attempt_count}/{s.max_attempts}</span>}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-white/50">
                {(s.assigned_agent_id || s.assigned_role) && (
                  <span className="inline-flex items-center gap-1">{agentName(s.assigned_agent_id) ?? ""}<RoleChip role={s.assigned_role} /></span>
                )}
                {s.required_skills.length > 0 && s.required_skills.map((sk) => (
                  <span key={sk} className="rounded bg-white/5 px-1.5 text-[10px] text-white/45">{sk}</span>
                ))}
              </div>
              {s.output_expected && s.status !== "done" && <p className="mt-1 text-[11px] italic text-white/35">expects: {s.output_expected}</p>}
              {s.output != null && <Output output={s.output} />}

              {isCurrent && !terminal && (s.status === "running" || s.status === "review") && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <CompleteButton onDone={(out) => onOp("complete", s.id, { output: out })} busy={busy} />
                  <Act icon={XCircle} label="Fail" tone="rose" busy={busy} onClick={() => onOp("fail", s.id, { reason: "failed via dashboard" })} />
                  <Act icon={Ban} label="Block" tone="amber" busy={busy} onClick={() => onOp("block", s.id, { reason: "blocked via dashboard" })} />
                  <Act icon={SkipForward} label="Skip" tone="slate" busy={busy} onClick={() => onOp("skip", s.id)} />
                  {!s.approval_required && <Act icon={ShieldCheck} label="Require approval" tone="slate" busy={busy} onClick={() => onOp("request_approval", s.id)} />}
                </div>
              )}
              {isCurrent && s.status === "waiting_user" && (
                <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-amber-300">
                  <ShieldCheck className="size-3" /> Awaiting your approval in the Decision Inbox.
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Output({ output }: { output: Record<string, unknown> | string }) {
  const text = typeof output === "string" ? output : JSON.stringify(output, null, 2);
  return <pre className="glass-inset mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg p-2 text-[11px] text-white/60">{text}</pre>;
}

const TONE: Record<string, string> = {
  rose: "border-rose-500/30 text-rose-300 hover:bg-rose-500/10",
  amber: "border-amber-500/30 text-amber-300 hover:bg-amber-500/10",
  slate: "border-white/10 text-white/60 hover:bg-white/5",
};
function Act({ icon: Icon, label, tone, onClick, busy }: { icon: React.ComponentType<{ className?: string }>; label: string; tone: string; onClick: () => void; busy: boolean }) {
  return (
    <button disabled={busy} onClick={onClick} className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs disabled:opacity-50 ${TONE[tone] ?? TONE.slate}`}>
      <Icon className="size-3.5" /> {label}
    </button>
  );
}

function CompleteButton({ onDone, busy }: { onDone: (out?: string) => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [out, setOut] = useState("");
  if (!open)
    return (
      <button disabled={busy} onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2 py-1 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-50">
        <CheckCircle2 className="size-3.5" /> Complete
      </button>
    );
  return (
    <div className="flex w-full items-center gap-1.5">
      <input autoFocus value={out} onChange={(e) => setOut(e.target.value)} placeholder="output / note (optional)" className="h-8 flex-1 rounded-lg border border-white/10 bg-white/5 px-2 text-xs text-white outline-none focus:border-emerald-500/40" />
      <button disabled={busy} onClick={() => { onDone(out.trim() ? out.trim() : undefined); setOpen(false); setOut(""); }} className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-2 py-1.5 text-xs font-semibold text-black hover:bg-emerald-400 disabled:opacity-50"><Send className="size-3.5" /></button>
    </div>
  );
}
