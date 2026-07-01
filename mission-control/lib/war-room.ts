// War Room aggregation: ONE read-only snapshot of the whole production floor — fleet health, every agent's live
// activity, and a smart-grouped event timeline — assembled from the EXISTING sources (fleet status.json + the
// audit log + workflow_events + work_items + workflows + approvals). No GitHub/network per call, no shell-out;
// the page polls this single endpoint. No "server-only" so it is unit-testable.
import fs from "node:fs";
import path from "node:path";
import { readAgents } from "./agents.ts";
import { readTeams } from "./teams.ts";
import { listWorkItems, type WorkItem, type WorkItemState } from "./work-items.ts";
import { listWorkflows, listRecentWorkflowEvents, type Workflow } from "./workflows.ts";
import { listApprovalsRO, type Approval } from "./approvals.ts";
import { listAudit, type AuditEntry } from "./db.ts";
import type { FleetStatus } from "./types";

// Read the fleet status.json DIRECTLY (fleet.ts is server-only, which breaks node --test; war-room.ts is already
// server-side via node:sqlite). Just the liveness fields we surface — no lock, no writes.
function fleetDir(): string { const e = process.env.FLEET_DIR; return e && e.trim() ? e.trim() : path.resolve(process.cwd(), ".."); }
function readStatus(): FleetStatus | null {
  let st: FleetStatus;
  try { st = JSON.parse(fs.readFileSync(path.join(fleetDir(), "control", "status.json"), "utf8")); } catch { return null; }
  let online = false;
  if (typeof st.supervisor_pid === "number" && st.supervisor_pid > 0) {
    try { process.kill(st.supervisor_pid, 0); online = true; } catch { online = false; }
  }
  if (online && st.heartbeat) { const age = Date.now() - new Date(st.heartbeat).getTime(); if (!(age < 5 * 60 * 1000)) online = false; }
  return { ...st, online };
}

export type AgentLiveStatus = "working" | "blocked" | "waiting_review" | "waiting_user" | "failed" | "done" | "sleeping";
export const AGENT_LIVE_STATUSES: AgentLiveStatus[] = ["working", "blocked", "waiting_review", "waiting_user", "failed", "done", "sleeping"];
export type EventSeverity = "info" | "success" | "warn" | "danger";

export interface WarRoomHealth {
  mode: string;
  online: boolean;
  workers: { active: number; max: number | null };
  agents: { active: number; total: number };
  workflows_running: number;
  open_decisions: number;
  blockers: number;
  prs_ready: number;
  breaker: { tripped: boolean; fails: number };
  budget_warning: string | null;
}
export interface AgentActivity {
  id: string;
  name: string;
  role: string | null;
  team: string | null;
  status: AgentLiveStatus;
  task: string | null;
  work_item_id: string | null;
  workflow_id: string | null;
  workflow_step: string | null;
  phase: string | null;
  busy_since: string | null;
  last_event: { type: string; title: string; ts: string } | null;
  waiting_approval: boolean;
  budget: string | null;
}
export interface WarEvent {
  id: string;
  ts: string;
  type: string;
  category: "task" | "work_item" | "plan" | "decision" | "workflow" | "phone" | "fleet" | "security" | "system";
  severity: EventSeverity;
  title: string;
  actor: string | null;
  role: string | null;
  team: string | null;
  issue: number | null;
  pr: number | null;
  work_item_id: string | null;
  workflow_id: string | null;
  approval_id: string | null;
  agent_id: string | null;
  count: number;
}
export interface WarRoomSnapshot {
  health: WarRoomHealth;
  buckets: Record<AgentLiveStatus, number>;
  agents: AgentActivity[];
  events: WarEvent[];
  facets: { teams: string[]; agents: { id: string; name: string }[]; roles: string[]; workflows: { id: string; title: string }[]; severities: EventSeverity[] };
  generated_at: string;
}

// state → the agent's live bucket, and the precedence when an agent touches several items (most-pressing wins)
const STATE_TO_LIVE: Partial<Record<WorkItemState, AgentLiveStatus>> = {
  running: "working", blocked: "blocked", review: "waiting_review", waiting_user: "waiting_user", failed: "failed", done: "done",
};
const LIVE_PRECEDENCE: AgentLiveStatus[] = ["waiting_user", "blocked", "waiting_review", "failed", "working", "done", "sleeping"];
const morePressing = (a: AgentLiveStatus, b: AgentLiveStatus) => (LIVE_PRECEDENCE.indexOf(a) <= LIVE_PRECEDENCE.indexOf(b) ? a : b);

/** Build the whole War Room snapshot in one shot. `limit` bounds the raw event scan (grouped output is smaller). */
export function buildWarRoom(limit = 140): WarRoomSnapshot {
  const status = safe(() => readStatus(), null);
  const agents = safe(() => readAgents().agents, [] as ReturnType<typeof readAgents>["agents"]);
  const workItems = safe(() => listWorkItems({ limit: 300 }), [] as WorkItem[]);
  const workflows = safe(() => listWorkflows({ limit: 200 }), [] as Workflow[]);
  // READ-ONLY: load approvals once WITHOUT the lazy-expire write, and compute the effective-pending set in-memory
  // (a GET must never write). This also serves the per-audit-row enrichment map (no per-row point query).
  const nowMs = Date.now();
  const allAppr = safe(() => listApprovalsRO(200), [] as Approval[]);
  const pending = allAppr.filter((a) => a.status === "pending" && (!a.expires_at || Date.parse(a.expires_at) > nowMs));

  const agentById = new Map(agents.map((a) => [a.id, a]));
  const issueToItem = new Map<number, WorkItem>();
  for (const wi of workItems) if (wi.issue != null && !issueToItem.has(wi.issue)) issueToItem.set(wi.issue, wi);
  const itemById = new Map(workItems.map((w) => [w.id, w]));
  const wfByWorkItem = new Map<string, Workflow>();
  for (const w of workflows) if (w.work_item_id && !wfByWorkItem.has(w.work_item_id)) wfByWorkItem.set(w.work_item_id, w);
  // resolve every agent's team ONCE from a single teams read (no per-agent file read).
  const teamByAgent = buildTeamByAgent(agents.map((a) => a.id));
  const apprById = new Map<string, Approval>(allAppr.map((a) => [a.id, a]));
  const teamName = (agentId: string): string | null => teamByAgent.get(agentId) ?? null;

  // ── events (audit minus workflow.* + workflow_events) → normalised, sorted, grouped ──
  const rawEvents = buildEvents(limit, { agentById, issueToItem, itemById, workflows, apprById, teamByAgent });

  // ── agents: each agent's most-pressing current work item drives its live status/card ──
  const slotByAgent = new Map<string, FleetStatus["slots"][number]>();
  for (const s of status?.slots ?? []) if (s.agent_id) slotByAgent.set(s.agent_id, s);

  const activity: AgentActivity[] = agents.filter((a) => a.enabled).map((a): AgentActivity => {
    const mine = workItems.filter((wi) => wi.assigned_agent_id === a.id || (!wi.assigned_agent_id && !!wi.assigned_role && wi.assigned_role === a.role));
    // pick the most-pressing non-terminal-ish item (done only counts if nothing more pressing)
    let cur: WorkItem | null = null;
    let live: AgentLiveStatus = "sleeping";
    for (const wi of mine) {
      const l = STATE_TO_LIVE[wi.state];
      if (!l) continue;
      if (cur === null || morePressing(l, live) === l) { cur = wi; live = l; }
    }
    const slot = slotByAgent.get(a.id);
    if (!cur && slot && slot.issue != null) live = "working"; // on a fleet slot but no linked work item → working
    const wf = cur ? wfByWorkItem.get(cur.id) ?? null : null;
    const curIssue: number | null = cur ? cur.issue : null;
    const curId: string | null = cur ? cur.id : null;
    const lastEv = rawEvents.find((e) => e.agent_id === a.id || (curId != null && (e.work_item_id === curId || (curIssue != null && e.issue === curIssue)))) ?? null;
    const waiting = pending.some((p) => p.agent_id === a.id || (curId != null && (p.work_item_id === curId || (curIssue != null && p.issue === curIssue))));
    return {
      id: a.id, name: a.name, role: a.role ?? null, team: teamName(a.id), status: live,
      task: (cur ? cur.title : slot?.title) ?? null, work_item_id: curId,
      workflow_id: wf?.id ?? null, workflow_step: wf?.current_step_id ? stepName(wf) : null,
      phase: (slot?.current_phase ?? slot?.phase ?? null) as string | null,
      busy_since: (cur ? cur.updated_at : slot?.started_at) ?? null,
      last_event: lastEv ? { type: lastEv.type, title: lastEv.title, ts: lastEv.ts } : null,
      waiting_approval: waiting,
      budget: a.daily_token_budget ? `${a.daily_token_budget.toLocaleString()} tok/day` : null,
    };
  });

  const buckets = Object.fromEntries(AGENT_LIVE_STATUSES.map((s) => [s, 0])) as Record<AgentLiveStatus, number>;
  for (const a of activity) buckets[a.status]++;

  const blockers = workItems.filter((w) => w.state === "blocked").length + workflows.filter((w) => w.status === "blocked").length;
  const prsReady = pending.filter((p) => p.kind === "merge").length || workItems.filter((w) => w.pr != null && w.state === "review").length;
  const health: WarRoomHealth = {
    mode: status?.mode ?? "stopped",
    online: status?.online ?? false,
    workers: { active: (status?.slots ?? []).filter((s) => s.pid != null || s.issue != null).length, max: status?.knobs?.max_workers ?? null },
    agents: { active: activity.filter((a) => a.status !== "sleeping" && a.status !== "done").length, total: agents.filter((a) => a.enabled).length },
    workflows_running: workflows.filter((w) => w.status === "running" || w.status === "waiting_user").length,
    open_decisions: pending.length,
    blockers,
    prs_ready: prsReady,
    breaker: { tripped: status?.breaker?.tripped ?? false, fails: status?.breaker?.consecutive_fails ?? 0 },
    budget_warning: budgetWarning(agents),
  };

  const teams = Array.from(new Set(activity.map((a) => a.team).filter((t): t is string => !!t))).sort();
  const roles = Array.from(new Set(agents.map((a) => a.role).filter((r): r is string => !!r))).sort();
  // the workflow filter must cover every workflow the timeline can show — active ones AND any referenced by an
  // event (a completed/failed workflow still appears in the timeline, so it needs a dropdown entry).
  const eventWfIds = new Set(rawEvents.map((e) => e.workflow_id).filter((id): id is string => !!id));
  return {
    health, buckets, agents: activity, events: rawEvents,
    facets: {
      teams, roles,
      agents: agents.map((a) => ({ id: a.id, name: a.name })),
      workflows: workflows.filter((w) => w.status === "running" || w.status === "waiting_user" || w.status === "blocked" || eventWfIds.has(w.id)).map((w) => ({ id: w.id, title: w.title })),
      severities: ["danger", "warn", "success", "info"],
    },
    generated_at: new Date().toISOString(),
  };
}

function stepName(wf: Workflow): string | null {
  return wf.current_step_id ? "in progress" : null; // the step name lives on the workflow detail; keep the card light
}

function budgetWarning(agents: ReturnType<typeof readAgents>["agents"]): string | null {
  // placeholder: no per-agent token usage is tracked yet. Surface a hint if budgets are configured.
  const withBudget = agents.filter((a) => a.enabled && a.daily_token_budget);
  return withBudget.length ? null : null;
}

// ── event building ──
// map each agent id → its safest enabled (non-template) team name, from ONE teams read
function buildTeamByAgent(agentIds: string[]): Map<string, string> {
  const teams = safe(() => readTeams().teams.filter((t) => t.enabled && !t.is_template), [] as ReturnType<typeof readTeams>["teams"]);
  const modeRank: Record<string, number> = { manual: 0, auto_below_risk: 1, auto: 2 };
  const safety = (t: (typeof teams)[number]) => (modeRank[t.approval_policy.mode] ?? 0) * 2 - (t.approval_policy.blocking_roles.length ? 1 : 0);
  const out = new Map<string, string>();
  for (const id of agentIds) {
    const t = teams.filter((x) => x.members.includes(id)).sort((a, b) => safety(a) - safety(b))[0];
    if (t) out.set(id, t.name);
  }
  return out;
}

interface EventCtx {
  agentById: Map<string, { role?: string | null; name?: string }>;
  issueToItem: Map<number, WorkItem>;
  itemById: Map<string, WorkItem>;
  workflows: Workflow[];
  apprById: Map<string, Approval>;
  teamByAgent: Map<string, string>;
}
function buildEvents(limit: number, ctx: EventCtx): WarEvent[] {
  const wfById = new Map(ctx.workflows.map((w) => [w.id, w]));
  const raw: WarEvent[] = [];

  // 1. audit rows (skip workflow.* — those come richer from workflow_events; skip permission allows — noise)
  for (const a of safe(() => listAudit(limit), [] as (AuditEntry & { id: number })[])) {
    if (a.action.startsWith("workflow.")) continue;
    const m = mapAudit(a);
    if (!m) continue;
    const item = a.issue != null ? ctx.issueToItem.get(a.issue) ?? null : null;
    const appr = a.approval_id ? ctx.apprById.get(a.approval_id) ?? null : null;
    const actorAgent = a.actor ? ctx.agentById.get(a.actor) : undefined;
    const teamOf = (id?: string | null) => (id ? ctx.teamByAgent.get(id) ?? null : null);
    raw.push({
      id: `a${a.id}`, ts: a.ts, ...m,
      actor: a.actor ?? null, role: actorAgent?.role ?? null,
      team: teamOf(actorAgent ? a.actor : null) ?? teamOf(appr?.agent_id) ?? teamOf(item?.assigned_agent_id) ?? null,
      issue: a.issue ?? appr?.issue ?? null, pr: appr?.pr ?? null,
      work_item_id: appr?.work_item_id ?? item?.id ?? null,
      workflow_id: null, approval_id: a.approval_id ?? null,
      agent_id: actorAgent ? a.actor! : appr?.agent_id ?? null, count: 1,
    });
  }
  // 2. workflow_events (the granular workflow timeline)
  for (const e of safe(() => listRecentWorkflowEvents(Math.min(limit, 100)), [] as ReturnType<typeof listRecentWorkflowEvents>)) {
    const m = mapWorkflowEvent(e.type, e.message);
    if (!m) continue;
    const wf = wfById.get(e.workflow_id);
    const wfItem = wf?.work_item_id ? ctx.itemById.get(wf.work_item_id) ?? null : null;
    raw.push({
      id: `w${e.id}`, ts: e.created_at, ...m,
      actor: null, role: null, team: wfItem?.assigned_agent_id ? ctx.teamByAgent.get(wfItem.assigned_agent_id) ?? null : null,
      issue: null, pr: null, work_item_id: wf?.work_item_id ?? null,
      workflow_id: e.workflow_id, approval_id: null, agent_id: wfItem?.assigned_agent_id ?? null, count: 1,
    });
  }

  raw.sort((x, y) => (x.ts < y.ts ? 1 : x.ts > y.ts ? -1 : 0));
  return groupEvents(raw).slice(0, 80);
}

/** Collapse adjacent same-(type+subject) events within a 10-minute window into one group with a count. */
function groupEvents(events: WarEvent[]): WarEvent[] {
  const out: WarEvent[] = [];
  const subj = (e: WarEvent) => e.work_item_id || (e.issue != null ? `i${e.issue}` : "") || e.workflow_id || e.approval_id || e.actor || e.type;
  for (const e of events) {
    const prev = out[out.length - 1];
    // only collapse TRULY identical adjacent events (same type + title + subject) — the title check stops
    // distinct events that share a coarse type + a fallback subject (e.g. two different fleet changes) merging.
    if (prev && prev.type === e.type && prev.title === e.title && subj(prev) === subj(e) && Math.abs(Date.parse(prev.ts) - Date.parse(e.ts)) < 10 * 60 * 1000) {
      prev.count++; // keep the newest (prev, since sorted desc) as the representative
      continue;
    }
    out.push({ ...e });
  }
  return out;
}

type EventCore = Pick<WarEvent, "type" | "category" | "severity" | "title">;
function mapAudit(a: AuditEntry): EventCore | null {
  const d = (a.detail ?? "").toLowerCase();
  switch (a.action) {
    case "task.create": return { type: "issue_claimed", category: "task", severity: "info", title: "Task created" };
    case "work_item.create": return { type: "work_item_created", category: "work_item", severity: "info", title: "Work item created" };
    case "work_item.state": {
      if (d.includes("blocked")) return { type: "blocker", category: "work_item", severity: "danger", title: `Blocked${a.detail ? ` (${a.detail})` : ""}` };
      if (d.includes("failed")) return { type: "failure", category: "work_item", severity: "danger", title: `Failed${a.detail ? ` (${a.detail})` : ""}` };
      if (d.includes("done")) return { type: "done", category: "work_item", severity: "success", title: "Work item done" };
      return { type: "state_change", category: "work_item", severity: "info", title: `State ${a.detail ?? "changed"}` };
    }
    case "work_item.assign": return { type: "assigned", category: "work_item", severity: "info", title: `Assigned ${a.detail ?? ""}` };
    case "work_item.update": return { type: "work_item_updated", category: "work_item", severity: "info", title: "Work item updated" };
    case "work_item.plan_submitted":
    case "plan.submitted": return { type: "plan_created", category: "plan", severity: "info", title: "Plan submitted" };
    case "plan.approved": return { type: "plan_approved", category: "plan", severity: "success", title: "Plan approved" };
    case "plan.rejected": return { type: "plan_rejected", category: "plan", severity: "warn", title: "Plan rejected" };
    case "manager.propose": return { type: "plan_created", category: "plan", severity: "info", title: "Decomposition proposed" };
    case "manager.materialize": return { type: "subtasks_created", category: "plan", severity: "success", title: `Subtasks created${a.detail ? ` (${a.detail})` : ""}` };
    case "manager.reject": return { type: "plan_rejected", category: "plan", severity: "warn", title: "Decomposition rejected" };
    case "approval.create": return { type: "approval_requested", category: "decision", severity: "warn", title: `Approval requested${a.kind ? ` · ${a.kind.replace(/_/g, " ")}` : ""}` };
    case "approval.decide": {
      const merge = a.kind === "merge";
      if (d === "approve") return { type: merge ? "merge_approved" : "approval_approved", category: "decision", severity: "success", title: merge ? "Merge approved" : "Approved" };
      if (d === "reject") return { type: "approval_rejected", category: "decision", severity: "warn", title: "Rejected" };
      return { type: "approval_decided", category: "decision", severity: "info", title: "Decided" };
    }
    case "approval.defer_manager": return { type: "approval_deferred", category: "decision", severity: "info", title: "Deferred to manager" };
    case "phone.command": return { type: "phone_command", category: "phone", severity: "info", title: `Phone command${a.detail ? ` · ${a.detail}` : ""}` };
    case "phone.message": return { type: "phone_command", category: "phone", severity: "info", title: "Phone message" };
    case "fleet.mode": return { type: "fleet_change", category: "fleet", severity: "info", title: `Fleet → ${a.detail ?? "changed"}` };
    case "fleet.breaker_reset": return { type: "fleet_change", category: "fleet", severity: "info", title: "Breaker reset" };
    default:
      // key off the ACTION, not the detail: deny reasons ("agent disabled", "autonomy 1 < required 2 …") never
      // contain the word "denied", so a detail-substring check would silently drop every access denial.
      if (a.action === "permission.denied") return { type: "blocked", category: "security", severity: "danger", title: `Denied: ${a.detail ?? a.action.replace("permission.", "")}` };
      if (a.action.startsWith("security")) return { type: "security_blocked", category: "security", severity: "danger", title: "Security block" };
      return null; // drop the rest (permission allows, config tweaks) to keep the timeline signal-dense
  }
}
function mapWorkflowEvent(type: string, message: string | null): EventCore | null {
  switch (type) {
    case "workflow_created": return { type: "workflow_started", category: "workflow", severity: "info", title: `Workflow started${message ? ` · ${message}` : ""}` };
    case "step_started": return { type: "workflow_step_started", category: "workflow", severity: "info", title: `Step: ${message ?? ""}` };
    case "step_completed": return { type: "workflow_step_completed", category: "workflow", severity: "success", title: `Step done: ${message ?? ""}` };
    case "workflow_completed": return { type: "workflow_completed", category: "workflow", severity: "success", title: "Workflow complete" };
    case "approval_requested": return { type: "approval_requested", category: "workflow", severity: "warn", title: `Step needs approval: ${message ?? ""}` };
    case "step_failed":
    case "workflow_failed": return { type: "failure", category: "workflow", severity: "danger", title: `Step failed${message ? `: ${message}` : ""}` };
    case "step_blocked": return { type: "blocker", category: "workflow", severity: "danger", title: `Step blocked${message ? `: ${message}` : ""}` };
    case "step_retry": return { type: "retry", category: "workflow", severity: "warn", title: `Retry: ${message ?? ""}` };
    default: return null; // step_skipped / approval_stale / workflow_updated / cancelled → not timeline-worthy
  }
}

function safe<T>(fn: () => T, dflt: T): T { try { return fn(); } catch { return dflt; } }
