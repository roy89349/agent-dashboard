"use client";
import { useState } from "react";
import { toast } from "sonner";
import { ExternalLink, GitMerge, Bot, AlertTriangle, ArrowUp, RotateCcw, X, MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { AgentIdentity, RiskBadge, WaitingBadge } from "@/components/fleet/agent-meta";
import type { BoardCard, FleetState, ReviewVerdict } from "@/lib/types";

const STATE_LABEL: Record<FleetState, string> = {
  claimed: "Claimed",
  building: "Building…",
  security: "Security…",
  gating: "Green gate…",
  "pr-open": "PR open",
  reviewed: "Reviewed",
  failed: "Failed",
};

const VERDICT: Record<ReviewVerdict, { dot: string; label: string }> = {
  approve: { dot: "bg-emerald-400", label: "approved" },
  caution: { dot: "bg-amber-400", label: "caution" },
  reject: { dot: "bg-red-500", label: "rejected" },
  reviewed: { dot: "bg-white/40", label: "reviewed" },
};

const pill = "inline-flex items-center gap-1 rounded bg-white/5 px-1.5 py-0.5 text-white/55";

export function TaskCard({ card, onMerged }: { card: BoardCard; onMerged: () => void }) {
  const [merging, setMerging] = useState(false);
  const [acting, setActing] = useState(false);
  const confirm = useConfirm();
  const failed = card.state === "failed" || card.labels.includes("agent-failed");
  const rejected = card.reviewVerdict === "reject";

  // Task steering (prioritize/cancel/retry) — refreshes the board via onMerged.
  async function act(url: string, body: object, okMsg: string) {
    setActing(true);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    setActing(false);
    if (res.ok) {
      toast.success(okMsg);
      onMerged();
    } else {
      toast.error(j.error ?? "Failed");
    }
  }

  // Open a conversation about this task (seeded with its context), then jump to Conversations.
  async function discuss() {
    setActing(true);
    const res = await fetch("/api/chats", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "task", issue: card.issue, title: `#${card.issue} ${card.title}`.slice(0, 80) }),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.id) {
      window.location.assign(`/chats?c=${j.id}`);
    } else {
      setActing(false);
      toast.error(j.error ?? "Could not start chat");
    }
  }

  async function cancel() {
    if (await confirm({ title: `Cancel task #${card.issue}?`, body: card.title, tone: "danger", confirmLabel: "Cancel task" }))
      act("/api/tasks/cancel", { issue: card.issue }, `#${card.issue} cancelled`);
  }

  async function merge() {
    if (!card.prNumber) return;
    // Safety valve: a rejected PR requires explicit type-to-confirm (mobile too).
    if (rejected) {
      const ok = await confirm({
        title: "Merge a rejected PR?",
        body: "The reviewer REJECTED this PR. The verdict is a hint, not binding — but make sure you've looked.",
        challenge: "MERGE",
        confirmLabel: "Merge anyway",
        tone: "danger",
      });
      if (!ok) return;
    }
    setMerging(true);
    const res = await fetch("/api/merge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prNumber: card.prNumber,
        deleteBranch: true,
        confirm: rejected ? "MERGE" : true,
      }),
    });
    const j = await res.json().catch(() => ({}));
    setMerging(false);
    if (res.ok && j.merged) {
      toast.success(`#${card.issue} merged`);
      onMerged();
    } else {
      toast.error(j.message ?? "Merge failed");
    }
  }

  return (
    <article
      className={`rounded-xl border p-3 ${
        failed ? "border-red-500/40 bg-red-500/[0.06]" : "border-white/10 bg-white/[0.03]"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug text-white/90">{card.title}</p>
        <a
          href={card.issueUrl}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-white/40 hover:text-white"
          aria-label="Open on GitHub"
        >
          <ExternalLink className="size-4" />
        </a>
      </div>

      {/* who-does-what (renders nothing when unassigned) */}
      {(card.role || card.agentName) && (
        <div className="mt-2">
          <AgentIdentity role={card.role} agentName={card.agentName} teamId={card.teamId} teamName={card.teamName} />
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        <span className={pill}>#{card.issue}</span>
        {card.model && (
          <span className="inline-flex items-center gap-1 rounded bg-indigo-500/15 px-1.5 py-0.5 text-indigo-300">
            <Bot className="size-3" /> {card.model}
          </span>
        )}
        {card.state && <span className={pill}>{STATE_LABEL[card.state]}</span>}
        {card.reviewVerdict && (
          <span className={pill}>
            <span className={`size-2 rounded-full ${VERDICT[card.reviewVerdict].dot}`} />
            {VERDICT[card.reviewVerdict].label}
          </span>
        )}
        <RiskBadge level={card.riskLevel} />
        {card.awaitingApproval && <WaitingBadge />}
      </div>

      {failed && card.error && (
        <p className="mt-2 flex items-start gap-1 text-xs text-red-300">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" /> {card.error.slice(0, 240)}
        </p>
      )}

      <button
        onClick={discuss}
        disabled={acting}
        className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 disabled:opacity-50"
      >
        <MessagesSquare className="size-3.5" /> Discuss
      </button>

      {card.column === "backlog" && (
        <div className="mt-3 flex items-center gap-2">
          <Button variant="secondary" size="sm" className="h-9 flex-1" disabled={acting}
            onClick={() => act("/api/fleet/priority", { issue: card.issue, toFront: true }, `#${card.issue} moved to front`)}>
            <ArrowUp className="size-4" /> Prioritize
          </Button>
          <Button variant="outline" size="sm" className="h-9" disabled={acting} onClick={cancel}>
            <X className="size-4" /> Cancel
          </Button>
        </div>
      )}

      {failed && (
        <div className="mt-3">
          <Button variant="secondary" size="sm" className="h-9 w-full" disabled={acting}
            onClick={() => act("/api/tasks/requeue", { issue: card.issue }, `#${card.issue} requeued`)}>
            <RotateCcw className="size-4" /> Retry
          </Button>
        </div>
      )}

      {card.prNumber && (
        <div className="mt-3 space-y-1.5">
          {rejected && (
            <p className="text-[11px] text-red-300/90">
              Reviewer: rejected — merge requires confirmation. (Verdict = hint, not binding.)
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button
              variant={rejected ? "outline" : "accent"}
              size="sm"
              className="h-10 flex-1"
              disabled={merging}
              onClick={merge}
            >
              <GitMerge className="size-4" /> {merging ? "Merging…" : "Merge PR"}
            </Button>
            {card.prUrl && (
              <a href={card.prUrl} target="_blank" rel="noreferrer">
                <Button variant="outline" size="sm" className="h-10">
                  PR
                </Button>
              </a>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
