// Leren van afwijzingen — every REJECTED approval becomes a persisted lesson in agent-memory.
// The context-compiler already injects agent memory into every optimized run, so a lesson written
// here steers the agent's NEXT run automatically. Repeated rejections of the same kind escalate to
// a "warning" memory (warnings are injected FIRST and surfaced by the safety layer).
// Never throws — learning must never break a decide flow. Measurable: audit `memory.rejection_lesson`
// + memory items with source_type "decision" (source_ref = approval id).
import { addMemory, listMemory, type MemoryItem } from "./agent-memory.ts";
import { getWorkItem } from "./work-items.ts";
import { readAgents } from "./agents.ts";
import { recordAudit } from "./db.ts";
import type { Approval } from "./approvals.ts";

export type RejectedApproval = Pick<
  Approval,
  "id" | "kind" | "summary" | "reason" | "agent_id" | "work_item_id" | "issue" | "pr"
>;

// kinds that carry no agent behaviour to learn from (a cancelled free-text prompt is not a mistake)
const SKIP_KINDS = new Set(["prompt_confirm"]);
export const WARNING_AFTER = 3; // same-kind rejections before a lesson escalates to a warning

/** approval.agent_id → work item's agent → work item's role → the enabled agent for that role. */
function resolveAgent(a: RejectedApproval): { agentId: string | null; role: string | null } {
  if (a.agent_id) return { agentId: a.agent_id, role: null };
  if (a.work_item_id) {
    try {
      const wi = getWorkItem(a.work_item_id);
      if (wi?.assigned_agent_id) return { agentId: wi.assigned_agent_id, role: wi.assigned_role ?? null };
      if (wi?.assigned_role) {
        const agent = readAgents().agents.find((x) => x.role === wi.assigned_role && x.enabled);
        if (agent) return { agentId: agent.id, role: wi.assigned_role };
      }
    } catch {
      /* resolution is best-effort */
    }
  }
  return { agentId: null, role: null };
}

/** Called from the approval REJECT paths (dashboard + phone). Best-effort, idempotent per approval. */
export function learnFromRejection(a: RejectedApproval, actor?: string): MemoryItem | null {
  try {
    if (SKIP_KINDS.has(a.kind)) return null;
    const { agentId } = resolveAgent(a);
    if (!agentId) return null; // nothing to attach the lesson to

    const existing = listMemory({ agent_id: agentId, limit: 100 });
    // idempotent: one lesson per approval (a re-tapped Reject button must not spam the memory)
    if (existing.some((m) => m.source_ref === a.id)) return null;

    const where = a.issue ? ` (issue #${a.issue})` : a.pr ? ` (PR #${a.pr})` : "";
    const reason = (a.reason ?? "").trim();
    const lesson = addMemory({
      agent_id: agentId,
      type: "lesson",
      title: `Rejected ${a.kind}: ${a.summary.slice(0, 140)}`,
      content:
        `Roy rejected this ${a.kind}${where}.` +
        (reason ? ` Reason: ${reason.slice(0, 400)}.` : " No reason given.") +
        " Adjust the approach before proposing similar work again.",
      source_type: "decision",
      source_ref: a.id,
      created_by: actor ?? "approval",
    });
    recordAudit({
      actor: actor ?? "approval",
      via: "system",
      action: "memory.rejection_lesson",
      issue: a.issue ?? null,
      detail: `${agentId}: ${a.kind} → lesson ${lesson.id.slice(0, 8)}`,
    });

    // escalate: ≥ WARNING_AFTER same-kind rejection lessons → one standing warning (injected first)
    const kindPrefix = `Rejected ${a.kind}:`;
    const sameKind = existing.filter((m) => m.type === "lesson" && m.title.startsWith(kindPrefix)).length + 1;
    const warningRef = `rejections:${a.kind}`;
    if (sameKind >= WARNING_AFTER && !existing.some((m) => m.source_ref === warningRef)) {
      addMemory({
        agent_id: agentId,
        type: "warning",
        title: `Repeated rejections: ${a.kind} (${sameKind}×)`,
        content:
          `Work of kind "${a.kind}" by this agent has now been rejected ${sameKind} times. ` +
          "Before submitting this kind of work again: re-read the recent rejection lessons, propose a plan first, and keep the change smaller.",
        source_type: "decision",
        source_ref: warningRef,
        created_by: actor ?? "approval",
      });
      recordAudit({
        actor: actor ?? "approval",
        via: "system",
        action: "memory.rejection_warning",
        detail: `${agentId}: ${a.kind} rejected ${sameKind}× → standing warning`,
      });
    }
    return lesson;
  } catch {
    return null; // learning must never block a decision
  }
}
