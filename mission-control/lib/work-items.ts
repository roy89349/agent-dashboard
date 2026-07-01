// Work items: every task is a traceable unit (queued→…→done) that a GitHub issue / chat / phone / agent
// can be linked to. Additive: the existing issue→agent→PR flow + board cards are untouched; a work item is a
// richer overlay linked by issue/pr number. All mutations validate enums server-side, redact free text, and
// audit via recordAudit. Not importing "server-only" so work-items.test.ts runs under node --test.
import crypto from "node:crypto";
import { db, recordAudit } from "./db.ts";
import { redact } from "./redact.ts";

export type WorkItemSource = "github_issue" | "chat" | "phone" | "agent" | "manual" | "workflow";
export type WorkItemState = "queued" | "running" | "blocked" | "waiting_user" | "review" | "failed" | "done" | "cancelled";
export type WorkItemPriority = "low" | "normal" | "high" | "urgent";
export type WorkItemRisk = "low" | "medium" | "high" | "critical";
export type WorkItemMode = "plan_only" | "build_after_approval" | "autonomous_within_limits";

export const WORK_ITEM_STATES: WorkItemState[] = ["queued", "running", "blocked", "waiting_user", "review", "failed", "done", "cancelled"];
export const WORK_ITEM_PRIORITIES: WorkItemPriority[] = ["low", "normal", "high", "urgent"];
export const WORK_ITEM_RISKS: WorkItemRisk[] = ["low", "medium", "high", "critical"];
export const WORK_ITEM_MODES: WorkItemMode[] = ["plan_only", "build_after_approval", "autonomous_within_limits"];
const SOURCES: WorkItemSource[] = ["github_issue", "chat", "phone", "agent", "manual", "workflow"];

export interface WorkItem {
  id: string;
  source_type: WorkItemSource;
  source_ref: string | null;
  title: string;
  description: string | null;
  assigned_agent_id: string | null;
  assigned_role: string | null;
  team_id: string | null;
  state: WorkItemState;
  priority: WorkItemPriority;
  risk_level: WorkItemRisk;
  parent_task_id: string | null;
  issue: number | null;
  pr: number | null;
  mode: WorkItemMode;
  plan: Record<string, unknown> | null; // parsed plan_json (the structured Plan), when submitted
  plan_summary: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

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

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], dflt: T): T => (allowed.includes(v as T) ? (v as T) : dflt);
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? redact(v).slice(0, max) : null);
const intOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null);

function rowToWorkItem(r: Record<string, unknown>): WorkItem {
  return {
    id: r.id as string,
    source_type: r.source_type as WorkItemSource,
    source_ref: (r.source_ref as string) ?? null,
    title: r.title as string,
    description: (r.description as string) ?? null,
    assigned_agent_id: (r.assigned_agent_id as string) ?? null,
    assigned_role: (r.assigned_role as string) ?? null,
    team_id: (r.team_id as string) ?? null,
    state: r.state as WorkItemState,
    priority: r.priority as WorkItemPriority,
    risk_level: r.risk_level as WorkItemRisk,
    parent_task_id: (r.parent_task_id as string) ?? null,
    issue: (r.issue as number) ?? null,
    pr: (r.pr as number) ?? null,
    mode: ((r.mode as WorkItemMode) ?? "build_after_approval"),
    plan: parseJson(r.plan_json as string | null),
    plan_summary: (r.plan_summary as string) ?? null,
    created_by: (r.created_by as string) ?? null,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  };
}
function parseJson(s: string | null): Record<string, unknown> | null {
  if (!s) return null;
  try { const p = JSON.parse(s); return p && typeof p === "object" ? p : null; } catch { return null; }
}

export interface CreateWorkItemInput {
  source_type?: WorkItemSource;
  source_ref?: string | null;
  title: string;
  description?: string | null;
  assigned_agent_id?: string | null;
  assigned_role?: string | null;
  team_id?: string | null;
  state?: WorkItemState;
  priority?: WorkItemPriority;
  risk_level?: WorkItemRisk;
  parent_task_id?: string | null;
  issue?: number | null;
  pr?: number | null;
  mode?: WorkItemMode;
  created_by?: string | null;
}

const byIssue = (issue: number): WorkItem | null => {
  const r = db().prepare("SELECT * FROM work_items WHERE issue = ? ORDER BY created_at ASC LIMIT 1").get(issue) as Record<string, unknown> | undefined;
  return r ? rowToWorkItem(r) : null;
};

export function createWorkItem(input: CreateWorkItemInput): WorkItem {
  const title = str(input.title, 300);
  if (!title) throw new HttpError(400, "title required");
  const issue = intOrNull(input.issue);
  // idempotent by issue: never create a second work item for the same GitHub issue
  if (issue !== null) {
    const existing = byIssue(issue);
    if (existing) return existing;
  }
  const now = new Date().toISOString();
  const risk = oneOf(input.risk_level, WORK_ITEM_RISKS, "low");
  // DEFAULT-TO-PLAN-ONLY: large/risky tasks (high/critical risk) start in plan_only unless explicitly set
  const mode = oneOf(input.mode, WORK_ITEM_MODES, risk === "high" || risk === "critical" ? "plan_only" : "build_after_approval");
  const wi: WorkItem = {
    id: crypto.randomUUID(),
    source_type: oneOf(input.source_type, SOURCES, "manual"),
    source_ref: str(input.source_ref, 300),
    title,
    description: str(input.description, 8000),
    assigned_agent_id: str(input.assigned_agent_id, 120),
    assigned_role: str(input.assigned_role, 64),
    team_id: str(input.team_id, 120),
    state: oneOf(input.state, WORK_ITEM_STATES, "queued"),
    priority: oneOf(input.priority, WORK_ITEM_PRIORITIES, "normal"),
    risk_level: risk,
    parent_task_id: str(input.parent_task_id, 64),
    issue,
    pr: intOrNull(input.pr),
    mode,
    plan: null,
    plan_summary: null,
    created_by: str(input.created_by, 120),
    created_at: now,
    updated_at: now,
  };
  try {
    db()
      .prepare(
        `INSERT INTO work_items (id,source_type,source_ref,title,description,assigned_agent_id,assigned_role,team_id,state,priority,risk_level,parent_task_id,issue,pr,mode,plan_json,plan_summary,created_by,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,?,?)`,
      )
      .run(
        wi.id, wi.source_type, wi.source_ref, wi.title, wi.description, wi.assigned_agent_id, wi.assigned_role, wi.team_id,
        wi.state, wi.priority, wi.risk_level, wi.parent_task_id, wi.issue, wi.pr, wi.mode, wi.created_by, wi.created_at, wi.updated_at,
      );
  } catch (e) {
    // lost a race on the unique-issue index → return the row that won (still idempotent)
    if (issue !== null) { const won = byIssue(issue); if (won) return won; }
    throw e;
  }
  recordAudit({ actor: wi.created_by ?? "system", via: "system", action: "work_item.create", issue: wi.issue, detail: redact(wi.title).slice(0, 200) });
  return wi;
}

export function getWorkItem(id: string): WorkItem | null {
  const r = db().prepare("SELECT * FROM work_items WHERE id = ?").get(String(id)) as Record<string, unknown> | undefined;
  return r ? rowToWorkItem(r) : null;
}

export interface WorkItemFilter {
  state?: WorkItemState;
  assigned_agent_id?: string;
  assigned_role?: string;
  team_id?: string;
  issue?: number;
  parent_task_id?: string;
  priority?: WorkItemPriority;
  limit?: number;
}

export function listWorkItems(f: WorkItemFilter = {}): WorkItem[] {
  const where: string[] = [];
  const args: unknown[] = [];
  const add = (col: string, val: unknown) => { if (val !== undefined && val !== null && val !== "") { where.push(`${col} = ?`); args.push(val); } };
  add("state", f.state);
  add("assigned_agent_id", f.assigned_agent_id);
  add("assigned_role", f.assigned_role);
  add("team_id", f.team_id);
  add("issue", f.issue);
  add("parent_task_id", f.parent_task_id);
  add("priority", f.priority);
  const raw = Math.trunc(Number(f.limit));
  const n = Number.isFinite(raw) ? Math.min(500, Math.max(1, raw)) : 200; // NaN-safe (bad ?limit → 200, not a crash)
  const sql = `SELECT * FROM work_items ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY updated_at DESC LIMIT ?`;
  return (db().prepare(sql).all(...args, n) as Record<string, unknown>[]).map(rowToWorkItem);
}

export function childWorkItems(parentId: string): WorkItem[] {
  return (db().prepare("SELECT * FROM work_items WHERE parent_task_id = ? ORDER BY created_at ASC").all(String(parentId)) as Record<string, unknown>[]).map(rowToWorkItem);
}

export type WorkItemPatch = Partial<
  Pick<WorkItem, "title" | "description" | "state" | "priority" | "risk_level" | "assigned_agent_id" | "assigned_role" | "team_id" | "parent_task_id" | "issue" | "pr" | "source_ref" | "mode">
> & { actor?: string };

/** Validate + apply a patch to an existing work item. Only known columns; enums clamped; free text redacted. */
export function updateWorkItem(id: string, patch: WorkItemPatch): WorkItem {
  const cur = getWorkItem(id);
  if (!cur) throw new HttpError(404, "work item not found");
  const next: WorkItem = { ...cur };
  if (patch.title !== undefined) { const t = str(patch.title, 300); if (t) next.title = t; }
  if (patch.description !== undefined) next.description = str(patch.description, 8000);
  if (patch.state !== undefined) next.state = oneOf(patch.state, WORK_ITEM_STATES, cur.state);
  if (patch.priority !== undefined) next.priority = oneOf(patch.priority, WORK_ITEM_PRIORITIES, cur.priority);
  if (patch.risk_level !== undefined) next.risk_level = oneOf(patch.risk_level, WORK_ITEM_RISKS, cur.risk_level);
  if (patch.assigned_agent_id !== undefined) next.assigned_agent_id = str(patch.assigned_agent_id, 120);
  if (patch.assigned_role !== undefined) next.assigned_role = str(patch.assigned_role, 64);
  if (patch.team_id !== undefined) next.team_id = str(patch.team_id, 120);
  if (patch.parent_task_id !== undefined) next.parent_task_id = patch.parent_task_id === id ? cur.parent_task_id : str(patch.parent_task_id, 64); // no self-parent
  if (patch.issue !== undefined) next.issue = intOrNull(patch.issue);
  if (patch.pr !== undefined) next.pr = intOrNull(patch.pr);
  if (patch.source_ref !== undefined) next.source_ref = str(patch.source_ref, 300);
  if (patch.mode !== undefined) next.mode = oneOf(patch.mode, WORK_ITEM_MODES, cur.mode);
  // audit EVERY field change (not only state) — the PATCH endpoint mutates any field
  const changed = (["title", "description", "state", "priority", "risk_level", "assigned_agent_id", "assigned_role", "team_id", "parent_task_id", "issue", "pr", "source_ref", "mode"] as const).filter((k) => next[k] !== cur[k]);
  if (changed.length === 0) return cur; // no-op → no write, no updated_at bump
  next.updated_at = new Date().toISOString();
  db()
    .prepare(
      `UPDATE work_items SET title=?,description=?,state=?,priority=?,risk_level=?,assigned_agent_id=?,assigned_role=?,team_id=?,parent_task_id=?,issue=?,pr=?,source_ref=?,mode=?,updated_at=? WHERE id=?`,
    )
    .run(next.title, next.description, next.state, next.priority, next.risk_level, next.assigned_agent_id, next.assigned_role, next.team_id, next.parent_task_id, next.issue, next.pr, next.source_ref, next.mode, next.updated_at, id);
  if (next.state !== cur.state)
    recordAudit({ actor: patch.actor ?? "dashboard", via: "dashboard", action: "work_item.state", issue: next.issue, detail: `${cur.state} → ${next.state}` });
  else
    recordAudit({ actor: patch.actor ?? "dashboard", via: "dashboard", action: "work_item.update", issue: next.issue, detail: redact(`changed: ${changed.join(", ")}`).slice(0, 200) });
  return next;
}

export function assignWorkItem(id: string, to: { agent_id?: string | null; role?: string | null; team_id?: string | null; actor?: string }): WorkItem {
  const wi = updateWorkItem(id, { assigned_agent_id: to.agent_id, assigned_role: to.role, team_id: to.team_id, actor: to.actor });
  recordAudit({ actor: to.actor ?? "dashboard", via: "dashboard", action: "work_item.assign", issue: wi.issue, detail: redact(`→ ${to.agent_id ?? to.role ?? to.team_id ?? "?"}`).slice(0, 200) });
  return wi;
}

export function completeWorkItem(id: string, opts: { pr?: number | null; actor?: string } = {}): WorkItem {
  return updateWorkItem(id, { state: "done", pr: opts.pr, actor: opts.actor });
}

export function blockWorkItem(id: string, reason: string, actor?: string): WorkItem {
  const wi = updateWorkItem(id, { state: "blocked", actor });
  recordAudit({ actor: actor ?? "dashboard", via: "dashboard", action: "work_item.block", issue: wi.issue, detail: redact(reason).slice(0, 200) });
  return wi;
}

/** Store a submitted plan on the work item (plan_json + a short plan_summary). */
export function setPlan(id: string, planJson: string, planSummary: string, actor?: string): WorkItem {
  const cur = getWorkItem(id);
  if (!cur) throw new HttpError(404, "work item not found");
  db().prepare("UPDATE work_items SET plan_json=?, plan_summary=?, updated_at=? WHERE id=?").run(planJson.slice(0, 40000), redact(planSummary).slice(0, 2000), new Date().toISOString(), id);
  recordAudit({ actor: actor ?? "system", via: "system", action: "work_item.plan_submitted", issue: cur.issue, detail: "plan submitted" });
  return getWorkItem(id)!;
}

/** Get the work item linked to a GitHub issue, creating one lazily (backward compat: old issue cards still
 *  work; opening a task promotes the issue to a tracked work item). Idempotent by issue number. */
export function workItemForIssue(issue: number, seed?: { title?: string; assigned_role?: string; created_by?: string }): WorkItem {
  const existing = db().prepare("SELECT * FROM work_items WHERE issue = ? ORDER BY created_at ASC LIMIT 1").get(issue) as Record<string, unknown> | undefined;
  if (existing) return rowToWorkItem(existing);
  return createWorkItem({
    source_type: "github_issue",
    source_ref: `#${issue}`,
    title: seed?.title ?? `Issue #${issue}`,
    assigned_role: seed?.assigned_role ?? null,
    issue,
    created_by: seed?.created_by ?? "system",
  });
}
