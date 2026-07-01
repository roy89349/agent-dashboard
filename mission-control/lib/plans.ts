// Plan-only lifecycle: an agent (or you) submits a structured PLAN for a work item; it becomes a durable
// plan_signoff approval in the Decision Inbox / phone; on approve the work item flips to build_after_approval
// (queued), on reject it is blocked and the agent gets feedback via an agent_message. The plan-only ENFORCEMENT
// (an agent may read/plan but not mutate) lives server-side in lib/permissions.ts. Not "server-only" → testable.
import { getWorkItem, updateWorkItem, setPlan } from "./work-items.ts";
import { createApproval } from "./approvals.ts";
import { postAgentMessage } from "./agent-messages.ts";
import { recordAudit } from "./db.ts";
import { redact } from "./redact.ts";
import type { WorkItem } from "./work-items.ts";
import type { Approval } from "./approvals.ts";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export function httpStatusOf(e: unknown): number {
  return e instanceof HttpError ? e.status : 500;
}

/** The mandatory 9-section plan output. */
export interface Plan {
  goal: string;
  approach: string;
  expected_files: string[];
  needed_agents: string[];
  workflow_steps: string[];
  risks: string[];
  test_plan: string;
  cost_estimate: string;
  approval_question: string;
}

const s = (v: unknown, max: number): string => redact(typeof v === "string" ? v : String(v ?? "")).slice(0, max);
const arr = (v: unknown, max = 40): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => redact(x).slice(0, 500)).slice(0, max) : [];

export function normalizePlan(input: Partial<Plan>): Plan {
  return {
    goal: s(input.goal, 1000),
    approach: s(input.approach, 4000),
    expected_files: arr(input.expected_files),
    needed_agents: arr(input.needed_agents, 30),
    workflow_steps: arr(input.workflow_steps, 60),
    risks: arr(input.risks, 40),
    test_plan: s(input.test_plan, 4000),
    cost_estimate: s(input.cost_estimate, 500),
    approval_question: s(input.approval_question, 500),
  };
}

/** A readable, redacted rendering of the plan for the approval preview (Decision Inbox + phone). */
export function renderPlan(p: Plan): string {
  const list = (xs: string[]) => xs.map((x) => `• ${x}`).join("\n") || "—";
  return [
    `GOAL\n${p.goal || "—"}`,
    `APPROACH\n${p.approach || "—"}`,
    `EXPECTED FILES\n${list(p.expected_files)}`,
    `NEEDED AGENTS/ROLES\n${list(p.needed_agents)}`,
    `WORKFLOW STEPS\n${p.workflow_steps.map((x, i) => `${i + 1}. ${x}`).join("\n") || "—"}`,
    `RISKS\n${list(p.risks)}`,
    `TEST PLAN\n${p.test_plan || "—"}`,
    `COST / TIME\n${p.cost_estimate || "—"}`,
  ].join("\n\n");
}

/** Submit a plan: store it, move the work item to `review`, and raise a plan_signoff approval (+ phone). */
export function submitPlan(workItemId: string, input: Partial<Plan>, actor?: string): { workItem: WorkItem; approval: Approval } {
  const wi = getWorkItem(workItemId);
  if (!wi) throw new HttpError(404, "work item not found");
  const plan = normalizePlan(input);
  if (!plan.goal) throw new HttpError(400, "plan.goal required");

  setPlan(workItemId, JSON.stringify(plan), plan.approval_question || plan.goal, actor);
  updateWorkItem(workItemId, { state: "review", actor: actor ?? "system" }); // waiting on the plan decision

  const { approval } = createApproval({
    kind: "plan_signoff",
    summary: (plan.approval_question || `Approve the plan for: ${wi.title}`).slice(0, 300),
    work_item_id: workItemId,
    agent_id: wi.assigned_agent_id,
    issue: wi.issue,
    risk: `${wi.risk_level}${plan.risks.length ? ` · ${plan.risks.length} risks` : ""}`,
    advice: plan.approach.slice(0, 300),
    diff_preview: renderPlan(plan),
    action: { type: "approve_plan", work_item_id: workItemId },
  });
  // best-effort phone notify (durably pending regardless)
  (async () => {
    try {
      const { getProvider, isPhoneConfigured } = await import("./phone/index.ts");
      if (isPhoneConfigured()) await getProvider()?.sendApprovalRequest(approval);
    } catch { /* swallow */ }
  })();
  recordAudit({ actor: actor ?? wi.assigned_agent_id ?? "system", via: "system", action: "plan.submitted", approval_id: approval.id, issue: wi.issue, detail: redact(plan.goal).slice(0, 200) });
  return { workItem: getWorkItem(workItemId)!, approval };
}

/** Plan approved → convert to a build task: mode build_after_approval + state queued; tell the agent to proceed. */
export function approvePlan(workItemId: string, actor?: string): WorkItem {
  const wi = getWorkItem(workItemId);
  if (!wi) throw new HttpError(404, "work item not found");
  // Only a plan that is still awaiting its decision may be approved. A stale/replayed approval (item already
  // building, done or cancelled) is a safe no-op — never resurrect or reset a moved-on work item.
  if (wi.state !== "review") {
    recordAudit({ actor: actor ?? "approval", via: "system", action: "plan.approve_skipped", issue: wi.issue, detail: `stale plan approval ignored (state=${wi.state})` });
    return wi;
  }
  const next = updateWorkItem(workItemId, { mode: "build_after_approval", state: "queued", actor: actor ?? "approval" });
  postAgentMessage({
    from_agent_id: "user", to_agent_id: wi.assigned_agent_id, to_role: wi.assigned_role, work_item_id: workItemId,
    type: "instruction", payload: { note: "Plan approved — you may proceed to build." },
  });
  recordAudit({ actor: actor ?? "dashboard", via: "dashboard", action: "plan.approved", issue: wi.issue, detail: "plan approved → build_after_approval" });
  return next;
}

/** Plan rejected → block the work item + hand the reason back to the agent as a blocker message. */
export function rejectPlan(workItemId: string, reason?: string, actor?: string): WorkItem {
  const wi = getWorkItem(workItemId);
  if (!wi) throw new HttpError(404, "work item not found");
  // Same guard as approvePlan: only reject a plan still under review; a stale reject must not force an already
  // building/cancelled/done item to blocked.
  if (wi.state !== "review") {
    recordAudit({ actor: actor ?? "approval", via: "system", action: "plan.reject_skipped", issue: wi.issue, detail: `stale plan rejection ignored (state=${wi.state})` });
    return wi;
  }
  const next = updateWorkItem(workItemId, { state: "blocked", actor: actor ?? "approval" });
  postAgentMessage({
    from_agent_id: "user", to_agent_id: wi.assigned_agent_id, to_role: wi.assigned_role, work_item_id: workItemId,
    type: "blocker", payload: { note: reason || "Plan rejected — revise and resubmit." },
  });
  recordAudit({ actor: actor ?? "dashboard", via: "dashboard", action: "plan.rejected", issue: wi.issue, detail: redact(reason || "").slice(0, 200) });
  return next;
}

/** Called from the approval-decide paths on REJECT: if it was a plan approval, block the work item + feedback. */
export function handlePlanRejection(approval: Pick<Approval, "kind" | "work_item_id" | "reason">, actor?: string): void {
  if (approval.kind === "plan_signoff" && approval.work_item_id) {
    try { rejectPlan(approval.work_item_id, approval.reason ?? "Plan rejected", actor); } catch { /* never block the decide flow */ }
  }
}
