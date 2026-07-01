// Agent memory + feedback loops: VISIBLE, editable, agent/team/project-scoped memory (no black box, no hidden
// personal memory). The user's feedback on a task/PR/decision/workflow becomes a durable memory item that agents
// (Manager, Communication, the safety layer) can consult on future work. All content is REDACTED. No shell-out.
import crypto from "node:crypto";
import { db, recordAudit } from "./db.ts";
import { redact } from "./redact.ts";

export class MemError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export function memStatusOf(e: unknown): number { return e instanceof MemError ? e.status : 500; }

export type MemoryType = "preference" | "rule" | "lesson" | "warning" | "strength" | "weakness" | "feedback";
export const MEMORY_TYPES: MemoryType[] = ["preference", "rule", "lesson", "warning", "strength", "weakness", "feedback"];
export type MemorySource = "manual" | "task" | "pr" | "decision" | "workflow" | "summary";
const SOURCES: MemorySource[] = ["manual", "task", "pr", "decision", "workflow", "summary"];

export interface MemoryItem {
  id: string;
  agent_id: string;
  team_id: string | null;
  project_id: string | null;
  type: MemoryType;
  title: string;
  content: string | null;
  source_type: MemorySource | null;
  source_ref: string | null;
  enabled: boolean;
  archived: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
export interface FeedbackItem {
  id: string;
  agent_id: string;
  work_item_id: string | null;
  workflow_id: string | null;
  decision_id: string | null;
  pr: number | null;
  rating: number | null;
  feedback_type: string;
  comment: string | null;
  memory_id: string | null;
  created_by: string | null;
  created_at: string;
}

// ── the feedback actions (each mints a memory item of the mapped type) ──
export interface FeedbackAction { type: string; label: string; memory_type: MemoryType; rating: number; template: string }
export const FEEDBACK_ACTIONS: FeedbackAction[] = [
  { type: "do_more", label: "Do this more", memory_type: "preference", rating: 1, template: "Do more of this kind of work." },
  { type: "never", label: "Never do this again", memory_type: "warning", rating: -1, template: "Never do this again." },
  { type: "ask_less", label: "Ask me less often", memory_type: "preference", rating: 1, template: "Ask for approval less often on routine work — proceed within limits." },
  { type: "ask_always", label: "Always ask me for this", memory_type: "rule", rating: 0, template: "Always ask me before this kind of change." },
  { type: "always_tests", label: "Always run tests first", memory_type: "rule", rating: 0, template: "Always run the tests before opening a PR." },
  { type: "smaller_prs", label: "Make smaller PRs", memory_type: "preference", rating: 0, template: "Keep PRs small and focused." },
  { type: "explain_deps", label: "No new dependency without explanation", memory_type: "rule", rating: 0, template: "Do not add a new dependency without explaining why." },
  { type: "ui_style", label: "Use this UI style more", memory_type: "preference", rating: 1, template: "Prefer this UI style / pattern." },
  { type: "defer_manager", label: "Let the Manager decide this", memory_type: "rule", rating: 0, template: "Defer this type of decision to the Manager." },
];
const actionByType = new Map(FEEDBACK_ACTIONS.map((a) => [a.type, a]));

// ── helpers ──
const now = () => new Date().toISOString();
const s = (v: unknown, max: number): string => redact(typeof v === "string" ? v : String(v ?? "")).slice(0, max);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], dflt: T): T => (allowed.includes(v as T) ? (v as T) : dflt);

function rowToMemory(r: Record<string, unknown>): MemoryItem {
  return {
    id: r.id as string, agent_id: r.agent_id as string, team_id: (r.team_id as string) ?? null, project_id: (r.project_id as string) ?? null,
    type: r.type as MemoryType, title: r.title as string, content: (r.content as string) ?? null,
    source_type: (r.source_type as MemorySource) ?? null, source_ref: (r.source_ref as string) ?? null,
    enabled: !!(r.enabled as number), archived: !!(r.archived as number),
    created_by: (r.created_by as string) ?? null, created_at: r.created_at as string, updated_at: r.updated_at as string,
  };
}
function rowToFeedback(r: Record<string, unknown>): FeedbackItem {
  return {
    id: r.id as string, agent_id: r.agent_id as string, work_item_id: (r.work_item_id as string) ?? null,
    workflow_id: (r.workflow_id as string) ?? null, decision_id: (r.decision_id as string) ?? null, pr: (r.pr as number) ?? null,
    rating: (r.rating as number) ?? null, feedback_type: r.feedback_type as string, comment: (r.comment as string) ?? null,
    memory_id: (r.memory_id as string) ?? null, created_by: (r.created_by as string) ?? null, created_at: r.created_at as string,
  };
}

// ── memory CRUD ──
export interface AddMemoryInput {
  agent_id: string; team_id?: string | null; project_id?: string | null; type?: string; title: string; content?: string | null;
  source_type?: string; source_ref?: string | null; created_by?: string | null;
}
export function addMemory(input: AddMemoryInput): MemoryItem {
  const agent_id = s(input.agent_id, 120);
  const title = s(input.title, 200);
  if (!agent_id || !title) throw new MemError(400, "agent_id and title required");
  const id = crypto.randomUUID(); const ts = now();
  db().prepare(`INSERT INTO agent_memory (id,agent_id,team_id,project_id,type,title,content,source_type,source_ref,enabled,archived,created_by,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,1,0,?,?,?)`)
    .run(id, agent_id, input.team_id ? s(input.team_id, 120) : null, input.project_id ? s(input.project_id, 120) : null,
      oneOf(input.type, MEMORY_TYPES, "lesson"), title, input.content ? s(input.content, 4000) : null,
      input.source_type ? oneOf(input.source_type, SOURCES, "manual") : "manual", input.source_ref ? s(input.source_ref, 200) : null,
      input.created_by ? s(input.created_by, 120) : "roy", ts, ts);
  recordAudit({ actor: input.created_by ?? "roy", via: "dashboard", action: "memory.add", detail: s(`${agent_id}: ${title}`, 160) });
  return getMemory(id)!;
}
export function getMemory(id: string): MemoryItem | null {
  const r = db().prepare("SELECT * FROM agent_memory WHERE id = ?").get(String(id)) as Record<string, unknown> | undefined;
  return r ? rowToMemory(r) : null;
}
export interface MemoryFilter { agent_id?: string; team_id?: string; type?: MemoryType; enabled_only?: boolean; include_archived?: boolean; limit?: number }
export function listMemory(f: MemoryFilter = {}): MemoryItem[] {
  const where: string[] = []; const args: unknown[] = [];
  if (f.agent_id) { where.push("agent_id = ?"); args.push(f.agent_id); }
  if (f.team_id) { where.push("(team_id = ? OR team_id IS NULL)"); args.push(f.team_id); }
  if (f.type) { where.push("type = ?"); args.push(f.type); }
  if (f.enabled_only) where.push("enabled = 1");
  if (!f.include_archived) where.push("archived = 0");
  const n = Number.isFinite(Math.trunc(Number(f.limit))) ? Math.min(500, Math.max(1, Math.trunc(Number(f.limit)))) : 200;
  const sql = `SELECT * FROM agent_memory ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY updated_at DESC LIMIT ?`;
  return (db().prepare(sql).all(...args, n) as Record<string, unknown>[]).map(rowToMemory);
}
export interface MemoryPatch { title?: string; content?: string | null; type?: string; team_id?: string | null; project_id?: string | null; enabled?: boolean; archived?: boolean; actor?: string }
export function updateMemory(id: string, patch: MemoryPatch): MemoryItem {
  const cur = getMemory(id);
  if (!cur) throw new MemError(404, "memory not found");
  const next: MemoryItem = { ...cur };
  if (patch.title !== undefined) { const t = s(patch.title, 200); if (t) next.title = t; }
  if (patch.content !== undefined) next.content = patch.content ? s(patch.content, 4000) : null;
  if (patch.type !== undefined) next.type = oneOf(patch.type, MEMORY_TYPES, cur.type);
  if (patch.team_id !== undefined) next.team_id = patch.team_id ? s(patch.team_id, 120) : null;
  if (patch.project_id !== undefined) next.project_id = patch.project_id ? s(patch.project_id, 120) : null;
  if (patch.enabled !== undefined) next.enabled = !!patch.enabled;
  if (patch.archived !== undefined) next.archived = !!patch.archived; // restore = {archived:false}
  if (patch.enabled === true) next.archived = false; // re-enabling un-archives — enabled+archived can't diverge
  db().prepare("UPDATE agent_memory SET title=?,content=?,type=?,team_id=?,project_id=?,enabled=?,archived=?,updated_at=? WHERE id=?")
    .run(next.title, next.content, next.type, next.team_id, next.project_id, next.enabled ? 1 : 0, next.archived ? 1 : 0, now(), id);
  recordAudit({ actor: patch.actor ?? "roy", via: "dashboard", action: "memory.update", detail: s(next.title, 160) });
  return getMemory(id)!;
}
export function archiveMemory(id: string, actor?: string): MemoryItem {
  const cur = getMemory(id);
  if (!cur) throw new MemError(404, "memory not found");
  db().prepare("UPDATE agent_memory SET archived=1, enabled=0, updated_at=? WHERE id=?").run(now(), id);
  recordAudit({ actor: actor ?? "roy", via: "dashboard", action: "memory.archive", detail: s(cur.title, 160) });
  return getMemory(id)!;
}

// ── feedback → memory ──
export interface RecordFeedbackInput {
  agent_id: string; feedback_type: string; comment?: string | null; rating?: number | null;
  work_item_id?: string | null; workflow_id?: string | null; decision_id?: string | null; pr?: number | null;
  team_id?: string | null; created_by?: string | null;
}
export function recordFeedback(input: RecordFeedbackInput): { feedback: FeedbackItem; memory: MemoryItem | null } {
  const agent_id = s(input.agent_id, 120);
  if (!agent_id) throw new MemError(400, "agent_id required");
  const action = actionByType.get(input.feedback_type);
  if (!action) throw new MemError(400, `unknown feedback_type: ${input.feedback_type}`);
  const source_type: MemorySource = input.pr != null ? "pr" : input.workflow_id ? "workflow" : input.decision_id ? "decision" : input.work_item_id ? "task" : "manual";
  const source_ref = input.pr != null ? `#${input.pr}` : input.workflow_id ?? input.decision_id ?? input.work_item_id ?? null;

  // mint a VISIBLE memory item so the feedback is used later (not a hidden black box)
  const memory = addMemory({
    agent_id, team_id: input.team_id ?? null, type: action.memory_type,
    title: action.label, content: (input.comment ? `${redact(input.comment).slice(0, 3000)} — ` : "") + action.template,
    source_type, source_ref, created_by: input.created_by ?? "roy",
  });

  const id = crypto.randomUUID();
  db().prepare(`INSERT INTO agent_feedback (id,agent_id,work_item_id,workflow_id,decision_id,pr,rating,feedback_type,comment,memory_id,created_by,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, agent_id, input.work_item_id ? s(input.work_item_id, 120) : null, input.workflow_id ? s(input.workflow_id, 120) : null,
      input.decision_id ? s(input.decision_id, 120) : null, input.pr != null ? Math.trunc(input.pr) : null,
      input.rating != null ? Math.trunc(input.rating) : action.rating, action.type, input.comment ? s(input.comment, 2000) : null,
      memory.id, input.created_by ? s(input.created_by, 120) : "roy", now());
  recordAudit({ actor: input.created_by ?? "roy", via: "dashboard", action: "agent.feedback", detail: s(`${agent_id}: ${action.label}`, 160) });
  return { feedback: getFeedback(id)!, memory };
}
export function getFeedback(id: string): FeedbackItem | null {
  const r = db().prepare("SELECT * FROM agent_feedback WHERE id = ?").get(String(id)) as Record<string, unknown> | undefined;
  return r ? rowToFeedback(r) : null;
}
export function listFeedback(agentId: string, limit = 50): FeedbackItem[] {
  const n = Math.min(200, Math.max(1, Math.trunc(limit)));
  return (db().prepare("SELECT * FROM agent_feedback WHERE agent_id = ? ORDER BY id DESC LIMIT ?").all(String(agentId), n) as Record<string, unknown>[]).map(rowToFeedback);
}

// ── retrieval for FUTURE task context (Manager / Communication / safety layer) ──
/** Enabled, non-archived memory that applies to this agent: its OWN memory + any TEAM-tagged memory for its team
 *  (a team-tagged item is shared across the team; a null team_id item stays agent-only). */
export function memoryForAgent(agentId: string, teamId?: string | null): MemoryItem[] {
  const where = ["enabled = 1", "archived = 0"];
  const args: unknown[] = [];
  if (teamId) { where.push("(agent_id = ? OR team_id = ?)"); args.push(String(agentId), String(teamId)); }
  else { where.push("agent_id = ?"); args.push(String(agentId)); }
  return (db().prepare(`SELECT * FROM agent_memory WHERE ${where.join(" AND ")} ORDER BY updated_at DESC LIMIT 100`).all(...args) as Record<string, unknown>[]).map(rowToMemory);
}
/** The rules/warnings the safety layer can surface as an extra caution for this agent. */
export function memoryWarningsFor(agentId: string): MemoryItem[] {
  return memoryForAgent(agentId).filter((m) => m.type === "rule" || m.type === "warning");
}
/** Grouped profile for the agent-detail overview (strengths/weaknesses/rules/warnings/preferences/lessons). */
export function memoryProfile(agentId: string, teamId?: string | null): Record<MemoryType, MemoryItem[]> {
  const out = Object.fromEntries(MEMORY_TYPES.map((t) => [t, [] as MemoryItem[]])) as Record<MemoryType, MemoryItem[]>;
  for (const m of listMemory({ agent_id: agentId, team_id: teamId ?? undefined, limit: 300 })) out[m.type]?.push(m);
  return out;
}
