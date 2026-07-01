// Structured conversations layer over the EXISTING conversations/messages tables (no parallel message system).
// It gives the flat chat log a shape — Team Chat · Task/Workflow Threads · Decision Threads · (optional) Agent
// threads · Daily Summaries — via the new kind + link columns, and bridges chat actions to the existing services
// (work-items · approvals · agent-messages). Old rows (kind 'orchestrator'/'task') keep working, mapped into the
// Team/Task groups. Agent Logs + Daily Summaries are surfaced from their own systems (agent_messages /
// communication_summaries) — this module does not duplicate them. Node-testable (no "server-only").
import crypto from "node:crypto";
import { db, recordAudit, getSetting, setSetting } from "./db.ts";
import { redact } from "./redact.ts";
import { createWorkItem } from "./work-items.ts";
import { createApproval, getApproval } from "./approvals.ts";
import { postAgentMessage } from "./agent-messages.ts";

export class ConvError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export const convStatusOf = (e: unknown): number => (e instanceof ConvError ? e.status : 500);

export type ConversationKind = "team" | "agent" | "decision" | "task" | "workflow" | "summary";
export const CONVERSATION_KINDS: ConversationKind[] = ["team", "agent", "decision", "task", "workflow", "summary"];
export type MessageType = "summary" | "decision" | "log" | "question" | "answer" | "system" | "approval" | "blocker" | "instruction";
export const MESSAGE_TYPES: MessageType[] = ["summary", "decision", "log", "question", "answer", "system", "approval", "blocker", "instruction"];
// UI groups (task+workflow shown together as "Tasks"); this is also how legacy kinds fold in.
export type ConversationGroup = "team" | "task" | "decision" | "agent" | "summary";

/** Map any stored kind (incl. legacy 'orchestrator') onto a display group so old threads stay visible + un-chaotic. */
export function kindGroup(kind: string): ConversationGroup {
  if (kind === "orchestrator" || kind === "team") return "team";
  if (kind === "task" || kind === "workflow") return "task";
  if (kind === "decision" || kind === "agent" || kind === "summary") return kind;
  return "team"; // unknown legacy → Team bucket (never dropped)
}

export interface Thread {
  id: string;
  kind: string;
  group: ConversationGroup;
  title: string | null;
  issue: number | null;
  team_id: string | null;
  agent_id: string | null;
  work_item_id: string | null;
  workflow_id: string | null;
  approval_id: string | null;
  archived: boolean;
  session_id: string | null;
  model: string | null;
  effort: string | null;
  created_at: string;
  updated_at: string;
  last_message?: string | null;
  last_type?: string | null;
  message_count?: number;
}
export interface StructMessage {
  id: number;
  conversation_id: string;
  role: string;
  type: string | null;
  agent_id: string | null;
  content: string;
  meta: string | null;
  created_at: string;
}

const now = () => new Date().toISOString();
function rowToThread(r: Record<string, unknown>): Thread {
  const kind = String(r.kind ?? "team");
  return {
    id: r.id as string, kind, group: kindGroup(kind), title: (r.title as string) ?? null, issue: (r.issue as number) ?? null,
    team_id: (r.team_id as string) ?? null, agent_id: (r.agent_id as string) ?? null, work_item_id: (r.work_item_id as string) ?? null,
    workflow_id: (r.workflow_id as string) ?? null, approval_id: (r.approval_id as string) ?? null, archived: !!(r.archived as number),
    session_id: (r.session_id as string) ?? null, model: (r.model as string) ?? null, effort: (r.effort as string) ?? null,
    created_at: r.created_at as string, updated_at: r.updated_at as string,
  };
}

export interface CreateThreadInput {
  id?: string; kind: ConversationKind; title?: string | null;
  team_id?: string | null; agent_id?: string | null; work_item_id?: string | null; workflow_id?: string | null; approval_id?: string | null;
  issue?: number | null; session_id?: string | null; model?: string | null; effort?: string | null;
}
export function createThread(input: CreateThreadInput): Thread {
  const id = input.id ?? crypto.randomUUID();
  const ts = now();
  db().prepare(`INSERT INTO conversations (id,kind,issue,title,session_id,cwd,model,effort,team_id,agent_id,work_item_id,workflow_id,approval_id,archived,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)`)
    .run(id, input.kind, input.issue ?? null, input.title ? String(input.title).slice(0, 200) : null,
      input.session_id ?? (input.kind === "team" || input.kind === "task" ? crypto.randomUUID() : null), null,
      input.model ?? null, input.effort ?? null, input.team_id ?? null, input.agent_id ?? null,
      input.work_item_id ?? null, input.workflow_id ?? null, input.approval_id ?? null, ts, ts);
  return getThread(id)!;
}
export function getThread(id: string): Thread | null {
  const r = db().prepare("SELECT * FROM conversations WHERE id = ?").get(String(id)) as Record<string, unknown> | undefined;
  return r ? rowToThread(r) : null;
}

function attachPreview(t: Thread): Thread {
  const last = db().prepare("SELECT content, type FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1").get(t.id) as { content?: string; type?: string } | undefined;
  const cnt = db().prepare("SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ?").get(t.id) as { c: number };
  return { ...t, last_message: last?.content ? String(last.content).slice(0, 120) : null, last_type: last?.type ?? null, message_count: cnt?.c ?? 0 };
}

export interface ListOpts { kind?: string; group?: ConversationGroup; includeArchived?: boolean; limit?: number }
export function listThreads(opts: ListOpts = {}): Thread[] {
  const where: string[] = []; const args: unknown[] = [];
  if (opts.kind) { where.push("kind = ?"); args.push(opts.kind); }
  if (!opts.includeArchived) where.push("(archived IS NULL OR archived = 0)");
  const n = Number.isFinite(Number(opts.limit)) ? Math.min(500, Math.max(1, Math.trunc(Number(opts.limit)))) : 200;
  const rows = db().prepare(`SELECT * FROM conversations ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY updated_at DESC LIMIT ?`).all(...args, n) as Record<string, unknown>[];
  let threads = rows.map(rowToThread);
  if (opts.group) threads = threads.filter((t) => t.group === opts.group);
  return threads.map(attachPreview);
}
/** All threads bucketed by display group — the "no chaos" grouped list. */
export function listGrouped(): Record<ConversationGroup, Thread[]> {
  const out: Record<ConversationGroup, Thread[]> = { team: [], task: [], decision: [], agent: [], summary: [] };
  for (const t of listThreads({ limit: 400 })) out[t.group].push(t);
  return out;
}

/** Search titles + message content (parameterised LIKE, wildcards escaped). Bounded. */
export function searchThreads(q: string, limit = 50): Thread[] {
  const term = String(q ?? "").trim();
  if (!term) return [];
  const like = "%" + term.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
  const n = Math.min(100, Math.max(1, Math.trunc(limit)));
  const rows = db().prepare(
    `SELECT DISTINCT c.* FROM conversations c LEFT JOIN messages m ON m.conversation_id = c.id
     WHERE (c.archived IS NULL OR c.archived = 0) AND (c.title LIKE ? ESCAPE '\\' OR m.content LIKE ? ESCAPE '\\')
     ORDER BY c.updated_at DESC LIMIT ?`).all(like, like, n) as Record<string, unknown>[];
  return rows.map(rowToThread).map(attachPreview);
}

// ── messages ──
const REDACT_TYPES = new Set<string>(["log", "system", "approval"]); // system-originated content is scrubbed; human/agent prose isn't
export interface PostMessageInput { conversation_id: string; role: string; type?: MessageType; content: string; agent_id?: string | null; meta?: object | null }
export function postMessage(input: PostMessageInput): number {
  const t = getThread(input.conversation_id);
  if (!t) throw new ConvError(404, "conversation not found");
  const type = input.type && MESSAGE_TYPES.includes(input.type) ? input.type : null;
  const content = type && REDACT_TYPES.has(type) ? redact(String(input.content)).slice(0, 8000) : String(input.content).slice(0, 8000);
  const ts = now();
  const r = db().prepare(`INSERT INTO messages (conversation_id,role,type,agent_id,content,meta,created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(input.conversation_id, input.role, type, input.agent_id ?? null, content, input.meta ? JSON.stringify(input.meta) : null, ts);
  db().prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(ts, input.conversation_id);
  return Number(r.lastInsertRowid);
}
export function threadMessages(conversationId: string): StructMessage[] {
  return db().prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC").all(String(conversationId)) as StructMessage[];
}
export function setArchived(id: string, archived: boolean, actor?: string): Thread {
  const t = getThread(id);
  if (!t) throw new ConvError(404, "conversation not found");
  db().prepare("UPDATE conversations SET archived = ?, updated_at = ? WHERE id = ?").run(archived ? 1 : 0, now(), id);
  recordAudit({ actor: actor ?? "roy", via: "dashboard", action: "conversation.archive", detail: `${id} → ${archived}` });
  return getThread(id)!;
}

// ── the default Team Chat (Roy ↔ Communication/Manager) ──
export function getOrCreateTeamChat(): Thread {
  const id = getSetting("conv.team_main", "");
  if (id) { const t = getThread(id); if (t) return t; }
  const t = createThread({ kind: "team", title: "Team Chat" });
  setSetting("conv.team_main", t.id);
  return t;
}

// ── linked threads (decision/task/workflow/agent) — created lazily, deduped by their link ──
function findByLink(col: "approval_id" | "work_item_id" | "workflow_id" | "agent_id", val: string): Thread | null {
  const r = db().prepare(`SELECT * FROM conversations WHERE ${col} = ? ORDER BY updated_at DESC LIMIT 1`).get(String(val)) as Record<string, unknown> | undefined;
  return r ? rowToThread(r) : null;
}
/** Decision thread for an approval — the discussion layer; the approval stays source-of-truth in the Decision Inbox. */
export function threadForApproval(approvalId: string, opts: { create?: boolean } = {}): Thread | null {
  const existing = findByLink("approval_id", approvalId);
  if (existing) return existing;
  if (!opts.create) return null;
  const ap = getApproval(approvalId);
  if (!ap) throw new ConvError(404, "approval not found");
  return createThread({ kind: "decision", approval_id: approvalId, title: `Decision: ${String(ap.summary ?? approvalId).slice(0, 120)}`, work_item_id: ap.work_item_id ?? null, issue: ap.issue ?? null });
}
export function threadForWorkItem(workItemId: string, opts: { create?: boolean; title?: string } = {}): Thread | null {
  const existing = findByLink("work_item_id", workItemId);
  if (existing) return existing;
  if (!opts.create) return null;
  return createThread({ kind: "task", work_item_id: workItemId, title: opts.title ? `Task: ${opts.title.slice(0, 120)}` : `Task ${workItemId}` });
}
export function threadForWorkflow(workflowId: string, opts: { create?: boolean; title?: string } = {}): Thread | null {
  const existing = findByLink("workflow_id", workflowId);
  if (existing) return existing;
  if (!opts.create) return null;
  return createThread({ kind: "workflow", workflow_id: workflowId, title: opts.title ? `Workflow: ${opts.title.slice(0, 120)}` : `Workflow ${workflowId}` });
}
/** Optional per-agent thread — only surfaced from the agent detail, never a default in the main list. */
export function agentThread(agentId: string, opts: { create?: boolean } = {}): Thread | null {
  const existing = findByLink("agent_id", agentId);
  if (existing && existing.kind === "agent") return existing;
  if (!opts.create) return existing && existing.kind === "agent" ? existing : null;
  return createThread({ kind: "agent", agent_id: agentId, title: `Agent: ${agentId}` });
}

// ── phone logging — inbound/outbound phone messages recorded as conversation messages (opt-in capability) ──
export function logPhoneMessage(input: { direction: "in" | "out"; text: string; chatId?: string | null; conversation_id?: string | null; meta?: object | null }): number {
  const convId = input.conversation_id ?? getOrCreateTeamChat().id;
  return postMessage({
    conversation_id: convId, role: input.direction === "in" ? "user" : "assistant", type: "log",
    content: `📱 ${input.direction === "in" ? "phone →" : "→ phone"}: ${input.text}`,
    meta: { via: "phone", chatId: input.chatId ?? null, ...(input.meta ?? {}) },
  });
}

// ── chat actions (bridge to the existing services; each also drops a system note into the thread) ──
export function createTaskFromChat(input: { conversation_id: string; title: string; description?: string | null; team_id?: string | null; created_by?: string | null }) {
  if (!getThread(input.conversation_id)) throw new ConvError(404, "conversation not found"); // validate BEFORE any side effect
  const title = String(input.title ?? "").trim();
  if (!title) throw new ConvError(400, "title required");
  const wi = createWorkItem({ title, description: input.description ?? null, source_type: "chat", source_ref: input.conversation_id, team_id: input.team_id ?? null, created_by: input.created_by ?? "roy" });
  postMessage({ conversation_id: input.conversation_id, role: "system", type: "system", content: `Created task: ${title}`, meta: { work_item_id: wi.id } });
  recordAudit({ actor: input.created_by ?? "roy", via: "dashboard", action: "chat.create_task", detail: `${wi.id}: ${title}`.slice(0, 160) });
  return { work_item: wi };
}
export function createDecisionFromChat(input: { conversation_id: string; question: string; advice?: string | null; work_item_id?: string | null; created_by?: string | null }) {
  if (!getThread(input.conversation_id)) throw new ConvError(404, "conversation not found"); // validate BEFORE minting an approval
  const question = String(input.question ?? "").trim();
  if (!question) throw new ConvError(400, "question required");
  const { approval } = createApproval({ kind: "escalation", summary: question.slice(0, 500), advice: input.advice ?? null, work_item_id: input.work_item_id ?? null, requested_by_agent_id: null });
  const thread = threadForApproval(approval.id, { create: true })!; // discussion thread, kept linked to the Decision Inbox
  postMessage({ conversation_id: input.conversation_id, role: "system", type: "decision", content: `Raised a decision: ${question}`, meta: { approval_id: approval.id, thread_id: thread.id } });
  recordAudit({ actor: input.created_by ?? "roy", via: "dashboard", action: "chat.create_decision", detail: `${approval.id}: ${question}`.slice(0, 160) });
  return { approval, thread };
}
export function assignToAgent(input: { conversation_id: string; to_agent_id?: string | null; to_role?: string | null; title: string; note?: string | null; created_by?: string | null }) {
  if (!getThread(input.conversation_id)) throw new ConvError(404, "conversation not found"); // validate BEFORE creating a work item
  const title = String(input.title ?? "").trim();
  if (!title) throw new ConvError(400, "title required");
  if (!input.to_agent_id && !input.to_role) throw new ConvError(400, "to_agent_id or to_role required");
  const wi = createWorkItem({ title, description: input.note ?? null, source_type: "chat", source_ref: input.conversation_id, assigned_agent_id: input.to_agent_id ?? null, assigned_role: input.to_role ?? null, created_by: input.created_by ?? "roy" });
  postMessage({ conversation_id: input.conversation_id, role: "system", type: "instruction", content: `Assigned to ${input.to_agent_id ?? input.to_role}: ${title}`, meta: { work_item_id: wi.id } });
  return { work_item: wi };
}
export function sendToManager(input: { conversation_id: string; note: string; work_item_id?: string | null; created_by?: string | null }) {
  if (!getThread(input.conversation_id)) throw new ConvError(404, "conversation not found"); // validate BEFORE messaging the manager
  const note = String(input.note ?? "").trim();
  if (!note) throw new ConvError(400, "note required");
  const msg = postAgentMessage({ to_role: "manager", type: "instruction", work_item_id: input.work_item_id ?? null, payload: { note } });
  postMessage({ conversation_id: input.conversation_id, role: "system", type: "instruction", content: `Sent to Manager: ${note}`, meta: { agent_message_id: msg.id } });
  return { agent_message: msg };
}
