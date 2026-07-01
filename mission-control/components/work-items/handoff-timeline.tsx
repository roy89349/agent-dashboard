"use client";
// The handoff trail: a human-readable, grouped timeline of the structured inter-agent messages on a work
// item ("Frontend handed off to QA", "Security flagged a blocker", "Manager asked Roy for a decision").
import Link from "next/link";
import { ArrowRightLeft, Eye, HelpCircle, CheckCircle2, Ban, Megaphone, FileText, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AgentAvatar } from "@/components/fleet/agent-meta";
import type { AgentMessage, AgentMessageType } from "@/lib/agent-messages";

const TYPE: Record<AgentMessageType, { icon: typeof Eye; verb: string; tone: "indigo" | "amber" | "red" | "emerald" | "teal" | "slate" }> = {
  handoff: { icon: ArrowRightLeft, verb: "handed off to", tone: "indigo" },
  review_request: { icon: Eye, verb: "requested a review from", tone: "indigo" },
  question: { icon: HelpCircle, verb: "asked", tone: "amber" },
  result: { icon: CheckCircle2, verb: "returned a result to", tone: "emerald" },
  blocker: { icon: Ban, verb: "flagged a blocker for", tone: "red" },
  instruction: { icon: Megaphone, verb: "instructed", tone: "slate" },
  summary: { icon: FileText, verb: "summarised for", tone: "slate" },
};

export function HandoffTimeline({
  messages,
  agentName,
}: {
  messages: AgentMessage[];
  agentName: (id?: string | null) => string | null;
}) {
  if (messages.length === 0)
    return <p className="py-4 text-center text-xs text-white/35">No handoffs yet — the trail appears as agents collaborate.</p>;

  return (
    <ol className="space-y-3">
      {messages.map((m, idx) => {
        const t = TYPE[m.type] ?? TYPE.summary;
        const Icon = t.icon;
        const from = agentName(m.from_agent_id) ?? "An agent";
        const to = agentName(m.to_agent_id) ?? (m.to_role ? m.to_role : "the team");
        const note = typeof m.payload?.note === "string" ? m.payload.note : typeof m.payload?.message === "string" ? (m.payload.message as string) : null;
        return (
          <li key={m.id} className="relative flex gap-2.5">
            {idx < messages.length - 1 && (
              <span aria-hidden className="absolute -bottom-3 left-[13px] top-8 w-px bg-white/10" />
            )}
            <div className={`z-10 mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border ${badgeCls(t.tone)}`}>
              <Icon className="size-3.5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-white/85">
                <span className="font-medium text-white">{from}</span> {t.verb}{" "}
                <span className="inline-flex items-center gap-1 font-medium text-white">
                  {m.to_agent_id && <AgentAvatar name={to} role={agentName(m.to_agent_id) ? undefined : m.to_role} className="size-4 text-[8px]" />}
                  {to}
                </span>
              </p>
              {note && <p className="mt-0.5 text-xs text-white/50">“{note}”</p>}
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-white/35">
                <span>{new Date(m.created_at).toLocaleString()}</span>
                <Badge tone={m.status === "done" ? "emerald" : m.status === "rejected" ? "red" : m.status === "in_progress" ? "indigo" : "slate"}>{m.status}</Badge>
                {m.requires_human && m.approval_id && (
                  <Link href="/approvals" className="inline-flex items-center gap-1 text-amber-300 hover:text-amber-200">
                    <ExternalLink className="size-3" /> decision needed
                  </Link>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function badgeCls(tone: "indigo" | "amber" | "red" | "emerald" | "teal" | "slate"): string {
  const m: Record<string, string> = {
    indigo: "border-indigo-500/30 bg-indigo-500/15 text-indigo-300",
    amber: "border-amber-500/30 bg-amber-500/15 text-amber-300",
    red: "border-red-500/30 bg-red-500/15 text-red-300",
    emerald: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300",
    teal: "border-teal-500/30 bg-teal-500/15 text-teal-200",
    slate: "border-white/10 bg-white/5 text-white/55",
  };
  return m[tone] ?? m.slate;
}
