"use client";
// The task detail view: work item details + assignment + state/priority/risk + linked issue/PR + parent/
// child + the handoff timeline, and a mini form to record a handoff/blocker/question (requires_human → a
// durable approval in the Decision Inbox). All mutations go through the session-gated, validated API.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { GitPullRequest, Bug, GitBranch, ExternalLink, Send } from "lucide-react";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/glass";
import { AgentAvatar, RoleChip } from "@/components/fleet/agent-meta";
import { RiskBadge } from "@/components/skills/risk-badge";
import { StateBadge, PriorityBadge, ModeBadge } from "./badges";
import { HandoffTimeline } from "./handoff-timeline";
import { PlanSection } from "./plan-section";
import { WorkflowLauncher } from "@/components/workflows/workflow-launcher";
import { AgentMemoryHints } from "@/components/agents/agent-memory-hints";
import { FeedbackButton } from "@/components/agents/feedback-button";
import type { WorkItem, WorkItemState, WorkItemMode } from "@/lib/work-items";
import type { AgentMessageType } from "@/lib/agent-messages";

// local (client-safe) copies — the value exports live in server modules (node:sqlite)
const WORK_ITEM_STATES: WorkItemState[] = ["queued", "running", "blocked", "waiting_user", "review", "failed", "done", "cancelled"];
const WORK_ITEM_MODES: WorkItemMode[] = ["plan_only", "build_after_approval", "autonomous_within_limits"];
const AGENT_MESSAGE_TYPES: AgentMessageType[] = ["handoff", "review_request", "question", "result", "blocker", "instruction", "summary"];
import type { WorkItemDetail as Detail } from "./use-work-items";
import type { Agent } from "@/lib/types";

const inputCls = "h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white outline-none focus:border-emerald-500/40";

export function WorkItemDetailDrawer({
  open, onClose, id, agents, agentName, teamName, repo, getDetail, patchItem, postMessage, submitPlan, onSelectItem,
}: {
  open: boolean;
  onClose: () => void;
  id: string | null;
  agents: Agent[];
  agentName: (id?: string | null) => string | null;
  teamName: (id?: string | null) => string | null;
  repo: string | null;
  getDetail: (id: string) => Promise<Detail | null>;
  patchItem: (id: string, patch: Partial<WorkItem>) => Promise<WorkItem | null>;
  postMessage: (input: Record<string, unknown>) => Promise<unknown>;
  submitPlan: (id: string, plan: Record<string, unknown>) => Promise<boolean>;
  onSelectItem: (id: string) => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);
  const [hoFrom, setHoFrom] = useState("");
  const [hoTo, setHoTo] = useState("");
  const [hoType, setHoType] = useState<AgentMessageType>("handoff");
  const [hoNote, setHoNote] = useState("");
  const [hoHuman, setHoHuman] = useState(false);

  const refresh = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setDetail(await getDetail(id));
    setLoading(false);
  }, [id, getDetail]);
  useEffect(() => { if (open && id) refresh(); }, [open, id, refresh]);

  const wi = detail?.workItem ?? null;
  const gh = (n: number, kind: "issues" | "pull") => (repo ? `https://github.com/${repo}/${kind}/${n}` : null);

  async function setState(state: WorkItemState) {
    if (!wi) return;
    const r = await patchItem(wi.id, { state });
    if (r) { toast.success(`State → ${state}`); refresh(); } else toast.error("Update failed");
  }
  async function sendHandoff() {
    if (!wi) return;
    if (!hoFrom && !hoTo && !hoNote) return toast.error("Add a from / to / note");
    const ok = await postMessage({
      from_agent_id: hoFrom || null, to_agent_id: hoTo && agents.some((a) => a.id === hoTo) ? hoTo : null,
      to_role: hoTo && !agents.some((a) => a.id === hoTo) ? hoTo : null,
      work_item_id: wi.id, type: hoType, payload: hoNote ? { note: hoNote } : null, requires_human: hoHuman,
    });
    if (ok) { toast.success(hoHuman ? "Posted — a decision was sent to your inbox" : "Handoff recorded"); setHoNote(""); setHoHuman(false); refresh(); }
    else toast.error("Could not post");
  }

  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      {open && (
        <DrawerContent title="Work item">
          {loading && !detail ? (
            <div className="space-y-3 p-5">{[0, 1, 2, 3].map((i) => <div key={i} className="h-5 animate-pulse rounded bg-white/5" />)}</div>
          ) : !wi ? (
            <p className="p-5 text-sm text-white/50">Not found.</p>
          ) : (
            <div className="space-y-4 p-4">
              {/* header */}
              <div className="flex flex-wrap items-center gap-2">
                <StateBadge state={wi.state} />
                <ModeBadge mode={wi.mode} />
                <PriorityBadge p={wi.priority} />
                {wi.risk_level !== "low" && <RiskBadge risk={wi.risk_level} />}
              </div>
              <p className="text-[15px] font-medium leading-snug text-white">{wi.title}</p>
              {wi.description && <p className="whitespace-pre-wrap text-sm text-white/60">{wi.description}</p>}

              {/* the assigned agent's memory (constraints/preferences) + a way to train it from the task */}
              {wi.assigned_agent_id && (
                <div className="space-y-2">
                  <AgentMemoryHints agentId={wi.assigned_agent_id} />
                  <div className="flex justify-end"><FeedbackButton agentId={wi.assigned_agent_id} workItemId={wi.id} label="Feedback to agent" /></div>
                </div>
              )}

              {/* assignment + meta */}
              <div className="glass-inset px-3.5">
                <Row label="Assigned">
                  {wi.assigned_agent_id || wi.assigned_role ? (
                    <span className="inline-flex items-center gap-1.5">
                      <AgentAvatar name={agentName(wi.assigned_agent_id) ?? undefined} role={wi.assigned_role} className="size-5 text-[9px]" />
                      {agentName(wi.assigned_agent_id) ?? ""} <RoleChip role={wi.assigned_role} />
                    </span>
                  ) : "unassigned"}
                </Row>
                {wi.team_id && <Row label="Team">{teamName(wi.team_id)}</Row>}
                <Row label="Source">{wi.source_type.replace("_", " ")}{wi.source_ref ? ` · ${wi.source_ref}` : ""}</Row>
                {wi.issue != null && <Row label="Issue">{gh(wi.issue, "issues") ? <a className="inline-flex items-center gap-1 text-emerald-300 hover:text-emerald-200" href={gh(wi.issue, "issues")!} target="_blank" rel="noreferrer"><Bug className="size-3" /> #{wi.issue} <ExternalLink className="size-3" /></a> : <span><Bug className="inline size-3" /> #{wi.issue}</span>}</Row>}
                {wi.pr != null && <Row label="PR">{gh(wi.pr, "pull") ? <a className="inline-flex items-center gap-1 text-emerald-300 hover:text-emerald-200" href={gh(wi.pr, "pull")!} target="_blank" rel="noreferrer"><GitPullRequest className="size-3" /> #{wi.pr} <ExternalLink className="size-3" /></a> : <span>#{wi.pr}</span>}</Row>}
                <Row label="Created">{new Date(wi.created_at).toLocaleString()}{wi.created_by ? ` · ${wi.created_by}` : ""}</Row>
              </div>

              {/* quick state + mode control */}
              <div className="flex flex-wrap gap-4">
                <div className="min-w-0 flex-1">
                  <SectionLabel className="mb-1.5">State</SectionLabel>
                  <div className="flex flex-wrap gap-1.5">
                    {WORK_ITEM_STATES.map((s) => (
                      <button key={s} onClick={() => setState(s)} className={`rounded-lg border px-2.5 py-1 text-xs capitalize ${wi.state === s ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-200" : "border-white/10 text-white/60 hover:bg-white/5"}`}>{s.replace("_", " ")}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <SectionLabel className="mb-1.5">Mode</SectionLabel>
                  <select value={wi.mode} onChange={async (e) => { const r = await patchItem(wi.id, { mode: e.target.value as WorkItemMode }); if (r) { toast.success(`Mode → ${e.target.value}`); refresh(); } }} className={inputCls}>
                    {WORK_ITEM_MODES.map((m) => <option key={m} value={m} className="bg-[#0d1322]">{m.replace(/_/g, " ")}</option>)}
                  </select>
                </div>
              </div>

              {/* plan (compose in plan-only, or read the submitted plan) */}
              <PlanSection wi={wi} submitPlan={submitPlan} onDone={refresh} />

              {/* start a multi-role workflow for this task (or its approved plan) */}
              <WorkflowLauncher workItemId={wi.id} title={wi.title} />

              {/* parent / children */}
              {(wi.parent_task_id || (detail?.children.length ?? 0) > 0) && (
                <div className="glass-card p-3">
                  <SectionLabel className="mb-2">Related tasks</SectionLabel>
                  {wi.parent_task_id && <button onClick={() => onSelectItem(wi.parent_task_id!)} className="mb-1.5 inline-flex min-h-8 items-center gap-1.5 rounded-lg px-1.5 text-xs font-medium text-indigo-300 hover:bg-white/5 hover:text-indigo-200"><GitBranch className="size-3" /> parent task</button>}
                  {(detail?.children.length ?? 0) > 0 && (
                    <div className="ml-2 space-y-0.5 border-l border-white/10 pl-3">
                      {(detail?.children ?? []).map((c) => (
                        <button key={c.id} onClick={() => onSelectItem(c.id)} className="relative flex w-full min-h-8 items-center gap-2 rounded-lg px-1.5 py-1 text-left text-xs text-white/70 hover:bg-white/5">
                          <span className="absolute -left-3 top-1/2 h-px w-2.5 bg-white/10" aria-hidden />
                          <StateBadge state={c.state} /> <span className="truncate">{c.title}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* handoff timeline */}
              <div>
                <SectionLabel className="mb-2">Handoff trail</SectionLabel>
                <div className="glass-inset p-3.5">
                  <HandoffTimeline messages={detail?.messages ?? []} agentName={agentName} />
                </div>
              </div>

              {/* record a handoff */}
              <div className="glass-inset p-3.5">
                <SectionLabel className="mb-2">Record a handoff / blocker / question</SectionLabel>
                <div className="grid grid-cols-2 gap-2">
                  <select value={hoFrom} onChange={(e) => setHoFrom(e.target.value)} className={inputCls}>
                    <option value="" className="bg-[#0d1322]">from…</option>
                    {agents.map((a) => <option key={a.id} value={a.id} className="bg-[#0d1322]">{a.name}</option>)}
                  </select>
                  <select value={hoTo} onChange={(e) => setHoTo(e.target.value)} className={inputCls}>
                    <option value="" className="bg-[#0d1322]">to…</option>
                    {agents.map((a) => <option key={a.id} value={a.id} className="bg-[#0d1322]">{a.name}</option>)}
                    <option value="user" className="bg-[#0d1322]">Roy (user)</option>
                  </select>
                  <select value={hoType} onChange={(e) => setHoType(e.target.value as AgentMessageType)} className={`${inputCls} col-span-2`}>
                    {AGENT_MESSAGE_TYPES.map((t) => <option key={t} value={t} className="bg-[#0d1322]">{t.replace("_", " ")}</option>)}
                  </select>
                </div>
                <textarea value={hoNote} onChange={(e) => setHoNote(e.target.value)} rows={2} placeholder="note (optional)" className="mt-2 w-full resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/25 outline-none focus:border-emerald-500/40" />
                <label className="mt-2 flex items-center gap-2 text-xs text-white/60">
                  <input type="checkbox" checked={hoHuman} onChange={(e) => setHoHuman(e.target.checked)} /> needs a human decision (creates an approval)
                </label>
                <Button variant="accent" className="mt-2 h-11 w-full rounded-xl font-semibold" onClick={sendHandoff}>
                  <Send className="size-4" /> Record
                </Button>
              </div>
            </div>
          )}
        </DrawerContent>
      )}
    </Drawer>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-white/5 py-2 last:border-0">
      <span className="text-xs text-white/40">{label}</span>
      <span className="text-right text-xs text-white/80">{children}</span>
    </div>
  );
}
