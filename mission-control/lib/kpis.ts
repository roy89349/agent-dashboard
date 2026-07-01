// KPI service: productivity / quality / speed metrics for the fleet, from the EXISTING tables (work_items,
// workflows, workflow_events, approvals, agent_messages, audit). Every number is labelled real|derived (see
// analytics-shared). Bounded queries only — no full-table scans, no per-row fan-out. No invented costs here.
import { db } from "./db.ts";
import { listWorkItems, type WorkItem } from "./work-items.ts";
import { listWorkflows, listRecentWorkflowEvents, type Workflow } from "./workflows.ts";
import { listApprovalsRO, type Approval } from "./approvals.ts";
import { listRecentAgentMessages, type AgentMessage } from "./agent-messages.ts";
import { type Metric, metric, type Period, sinceFor, inRange, hoursBetween, ageHours, avg, pct, dailyTrend } from "./analytics-shared.ts";

export interface KpiFilter { period?: Period; team_id?: string | null; agent_id?: string | null; workflow_id?: string | null }
export interface KpiReport {
  period: Period;
  productivity: Metric[];
  quality: Metric[];
  speed: Metric[];
  trends: { tasks_done: { day: string; count: number }[]; workflows_done: { day: string; count: number }[] };
  generated_at: string;
}

const safe = <T>(fn: () => T, dflt: T): T => { try { return fn(); } catch { return dflt; } };

/** Gathered, filter-scoped source data (bounded). Shared by kpis + costs + performance. */
export interface AnalyticsData {
  workItems: WorkItem[];
  workflows: Workflow[];
  wfEvents: ReturnType<typeof listRecentWorkflowEvents>;
  approvals: Approval[];
  messages: AgentMessage[];
}
export function gatherAnalytics(f: { team_id?: string | null; agent_id?: string | null; workflow_id?: string | null } = {}): AnalyticsData {
  // NOTE: list helpers clamp to 500 — headline COUNTS use exact SQL (countDone/securityBlocks) so they never
  // undercount past this window; these in-memory rows drive trends/durations/derived proxies only.
  let workItems = safe(() => listWorkItems({ limit: 500 }), [] as WorkItem[]);
  let workflows = safe(() => listWorkflows({ limit: 500 }), [] as Workflow[]);
  let wfEvents = safe(() => listRecentWorkflowEvents(500), [] as ReturnType<typeof listRecentWorkflowEvents>);
  const approvals = safe(() => listApprovalsRO(500), [] as Approval[]);
  const messages = safe(() => listRecentAgentMessages(500), [] as AgentMessage[]);
  if (f.team_id) { workItems = workItems.filter((w) => w.team_id === f.team_id); workflows = workflows.filter((w) => w.team_id === f.team_id); }
  if (f.agent_id) workItems = workItems.filter((w) => w.assigned_agent_id === f.agent_id);
  if (f.workflow_id) { workflows = workflows.filter((w) => w.id === f.workflow_id); wfEvents = wfEvents.filter((e) => e.workflow_id === f.workflow_id); }
  return { workItems, workflows, wfEvents, approvals, messages };
}

// Exact, bounded aggregates for the headline "real" counts (so they never silently undercount past the 500-row
// in-memory cap). Fleet-wide security count uses an indexed COUNT with the period bound — no 2000-row window.
function countDone(table: "work_items" | "workflows", since: string | null, f: KpiFilter): number {
  const col = table === "work_items" ? "state" : "status";
  const where = [`${col} = 'done'`]; const args: unknown[] = [];
  if (since) { where.push("updated_at >= ?"); args.push(since); }
  if (f.team_id) { where.push("team_id = ?"); args.push(f.team_id); }
  if (table === "work_items" && f.agent_id) { where.push("assigned_agent_id = ?"); args.push(f.agent_id); }
  if (table === "workflows" && f.workflow_id) { where.push("id = ?"); args.push(f.workflow_id); }
  const r = safe(() => db().prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE ${where.join(" AND ")}`).get(...args) as { c: number }, { c: 0 });
  return r?.c ?? 0;
}
function securityBlocks(since: string | null): number {
  const base = "SELECT COUNT(*) AS c FROM audit WHERE (action = 'permission.denied' OR action LIKE 'security%')";
  const r = safe(() => (since ? db().prepare(base + " AND ts >= ?").get(since) : db().prepare(base).get()) as { c: number }, { c: 0 });
  return r?.c ?? 0;
}
/** Avg attempt_count across ALL steps of the (filtered) workflows — retries per step, scoped to the current filter. */
function avgRetryCount(workflowIds: string[]): number {
  if (!workflowIds.length) return 0;
  const ph = workflowIds.map(() => "?").join(",");
  const r = safe(() => db().prepare(`SELECT AVG(CAST(attempt_count AS REAL)) AS a FROM workflow_steps WHERE workflow_id IN (${ph})`).get(...workflowIds) as { a: number | null }, { a: null });
  return r?.a ? Math.round(r.a * 10) / 10 : 0;
}

export function buildKpis(f: KpiFilter = {}): KpiReport {
  const period = f.period ?? "week";
  const since = sinceFor(period);
  const d = gatherAnalytics(f);

  // ── productivity ──
  const doneTasks = d.workItems.filter((w) => w.state === "done" && inRange(w.updated_at, since));
  const doneWfs = d.workflows.filter((w) => w.status === "done" && inRange(w.updated_at, since));
  const prsCreated = new Set(d.workItems.filter((w) => w.pr != null && inRange(w.updated_at, since)).map((w) => w.pr)).size;
  const prsMerged = d.approvals.filter((a) => a.kind === "merge" && a.status === "approved" && inRange(a.decided_at, since)).length;
  const bugsFound = d.messages.filter((m) => m.type === "blocker" && inRange(m.created_at, since)).length;
  const bugsResolved = d.messages.filter((m) => m.type === "blocker" && m.status === "done" && inRange(m.resolved_at, since)).length;
  const openBlockers = d.workItems.filter((w) => w.state === "blocked").length + d.workflows.filter((w) => w.status === "blocked").length + d.messages.filter((m) => m.type === "blocker" && m.status !== "done" && m.status !== "rejected").length;
  const openDecisions = d.approvals.filter((a) => a.status === "pending" && (!a.expires_at || Date.parse(a.expires_at) > Date.now())).length;
  const productivity: Metric[] = [
    metric("tasks_done", "Tasks completed", countDone("work_items", since, f), "real"),      // exact SQL count
    metric("workflows_done", "Workflows completed", countDone("workflows", since, f), "real"), // exact SQL count
    metric("prs_created", "PRs created", prsCreated, "derived", { note: "distinct PR numbers on tracked work items" }),
    metric("prs_merged", "PRs merged", prsMerged, "real", { note: "merge approvals granted" }),
    metric("bugs_found", "Bugs / blockers raised", bugsFound, "derived", { note: "blocker messages as a proxy" }),
    metric("bugs_resolved", "Blockers resolved", bugsResolved, "derived"),
    metric("open_blockers", "Open blockers", openBlockers, "real", { note: "current" }),
    metric("open_decisions", "Decisions waiting", openDecisions, "real", { note: "current" }),
  ];

  // ── quality ──
  const stepsCompleted = d.wfEvents.filter((e) => e.type === "step_completed" && inRange(e.created_at, since)).length;
  const stepsFailed = d.wfEvents.filter((e) => e.type === "step_failed" && inRange(e.created_at, since)).length;
  const decided = d.approvals.filter((a) => (a.status === "approved" || a.status === "rejected") && inRange(a.decided_at, since));
  const rejected = decided.filter((a) => a.status === "rejected").length;
  const mergeDecided = decided.filter((a) => a.kind === "merge");
  const quality: Metric[] = [
    metric("step_success_rate", "Workflow step success", pct(stepsCompleted, stepsCompleted + stepsFailed), "derived", { unit: "%", note: `${stepsCompleted}/${stepsCompleted + stepsFailed} steps` }),
    metric("failed_steps", "Failed workflow steps", stepsFailed, "real"),
    metric("avg_retry", "Avg retries / step", avgRetryCount(d.workflows.map((w) => w.id)), "real"),
    metric("reject_rate", "Approval reject / caution rate", pct(rejected, decided.length), "derived", { unit: "%", note: `${rejected}/${decided.length} decided` }),
    metric("security_blocks", "Security / permission blocks", securityBlocks(since), "real", { note: "fleet-wide" }),
    metric("pr_review", "PR review outcome", mergeDecided.length ? `${mergeDecided.filter((a) => a.status === "approved").length}✓ / ${mergeDecided.filter((a) => a.status === "rejected").length}✗` : "—", "real"),
  ];

  // ── speed (durations are DERIVED — task/workflow lifespan; state ages are 'current') ──
  const now = new Date().toISOString();
  const cur = (arr: WorkItem[], state: WorkItem["state"]) => arr.filter((w) => w.state === state);
  const speed: Metric[] = [
    metric("avg_task_h", "Avg time / task", avg(doneTasks.map((w) => hoursBetween(w.created_at, w.updated_at))), "derived", { unit: "h", note: "created → done lifespan" }),
    metric("avg_wf_h", "Avg time / workflow", avg(doneWfs.map((w) => hoursBetween(w.created_at, w.updated_at))), "derived", { unit: "h" }),
    metric("waiting_you_h", "Avg wait on you", avg([...cur(d.workItems, "waiting_user"), ...cur(d.workItems, "review")].map((w) => ageHours(w.updated_at))), "derived", { unit: "h", note: "current items awaiting you" }),
    metric("blocked_h", "Avg time blocked", avg(cur(d.workItems, "blocked").map((w) => ageHours(w.updated_at))), "derived", { unit: "h", note: "current blocked items" }),
    metric("review_h", "Avg time in review", avg(cur(d.workItems, "review").map((w) => ageHours(w.updated_at))), "derived", { unit: "h", note: "current" }),
  ];
  void now;

  return {
    period,
    productivity, quality, speed,
    trends: {
      tasks_done: dailyTrend(d.workItems.filter((w) => w.state === "done").map((w) => w.updated_at)),
      workflows_done: dailyTrend(d.workflows.filter((w) => w.status === "done").map((w) => w.updated_at)),
    },
    generated_at: new Date().toISOString(),
  };
}
