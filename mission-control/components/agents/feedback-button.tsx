"use client";
// Reusable feedback control: give an agent feedback on a task / PR / decision / workflow step / summary. Each
// action mints a VISIBLE memory item (the loop). Drop it anywhere with the agent + the relevant source id.
import { useState } from "react";
import { toast } from "sonner";
import { MessageSquarePlus, Check } from "lucide-react";

// mirror of lib/agent-memory FEEDBACK_ACTIONS (client can't import the server value)
export const FEEDBACK_ACTIONS: { type: string; label: string }[] = [
  { type: "do_more", label: "Do this more" },
  { type: "never", label: "Never do this again" },
  { type: "ask_less", label: "Ask me less often" },
  { type: "ask_always", label: "Always ask me for this" },
  { type: "always_tests", label: "Always run tests first" },
  { type: "smaller_prs", label: "Make smaller PRs" },
  { type: "explain_deps", label: "No new dependency without explanation" },
  { type: "ui_style", label: "Use this UI style more" },
  { type: "defer_manager", label: "Let the Manager decide this" },
];

export function FeedbackButton({
  agentId, workItemId, workflowId, decisionId, pr, label = "Feedback", onDone,
}: {
  agentId: string;
  workItemId?: string | null;
  workflowId?: string | null;
  decisionId?: string | null;
  pr?: number | null;
  label?: string;
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(feedback_type: string) {
    if (!agentId) return toast.error("no agent to give feedback to");
    setBusy(true);
    const r = await fetch(`/api/agents/${agentId}/feedback`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ feedback_type, comment: comment.trim() || undefined, work_item_id: workItemId ?? undefined, workflow_id: workflowId ?? undefined, decision_id: decisionId ?? undefined, pr: pr ?? undefined }),
    });
    setBusy(false);
    if (r.ok) { toast.success("Feedback saved → memory updated"); setOpen(false); setComment(""); onDone?.(); }
    else toast.error((await r.json().catch(() => ({}))).error ?? "Could not save");
  }

  return (
    <div className="relative inline-block">
      <button onClick={() => setOpen((o) => !o)} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-white/10 px-2.5 text-[11px] text-white/55 transition-colors hover:bg-white/5 hover:text-white/80" title="Give this agent feedback → memory">
        <MessageSquarePlus className="size-3.5" /> {label}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="glass-overlay absolute right-0 z-50 mt-1 w-64 rounded-xl p-2 mc-fade-in">
            <p className="px-1 pb-1 text-[10px] uppercase tracking-wider text-white/35">Train this agent</p>
            <div className="space-y-0.5">
              {FEEDBACK_ACTIONS.map((a) => (
                <button key={a.type} disabled={busy} onClick={() => send(a.type)} className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs text-white/75 hover:bg-white/10 disabled:opacity-50">
                  <Check className="size-3 shrink-0 text-emerald-400/60" /> {a.label}
                </button>
              ))}
            </div>
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="optional note (context for the memory)" className="mt-1.5 w-full resize-none rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-[11px] text-white placeholder:text-white/25 outline-none focus:border-emerald-500/40" />
          </div>
        </>
      )}
    </div>
  );
}
