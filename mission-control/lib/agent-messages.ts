// Structured inter-agent collaboration log: handoffs, review requests, questions, results, blockers,
// instructions, summaries. NOT a chat layer — each message is a typed, resolvable record on a work item /
// thread. A message with requires_human=true creates a durable APPROVAL (Decision Inbox item) so a human
// question/blocker surfaces in the existing approvals flow. Payloads are redacted; every post is audited.
// Not importing "server-only" so agent-messages.test.ts runs under node --test.
import crypto from "node:crypto";
import { db, recordAudit } from "./db.ts";
import { redact } from "./redact.ts";
import { createApproval } from "./approvals.ts";

export type AgentMessageType = "handoff" | "review_request" | "question" | "result" | "blocker" | "instruction" | "summary";
export type AgentMessageStatus = "pending" | "accepted" | "in_progress" | "done" | "rejected";
export const AGENT_MESSAGE_TYPES: AgentMessageType[] = ["handoff", "review_request", "question", "result", "blocker", "instruction", "summary"];
export const AGENT_MESSAGE_STATUSES: AgentMessageStatus[] = ["pending", "accepted", "in_progress", "done", "rejected"];

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

export interface AgentMessage {
  id: string;
  from_agent_id: string | null;
  to_agent_id: string | null;
  to_role: string | null;
  work_item_id: string | null;
  type: AgentMessageType;
  payload: Record<string, unknown> | null;
  thread_id: string;
  status: AgentMessageStatus;
  requires_human: boolean;
  approval_id: string | null;
  created_at: string;
  resolved_at: string | null;
}

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], dflt: T): T => (allowed.includes(v as T) ? (v as T) : dflt);
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.slice(0, max) : null);

/** Redact any string leaf in the payload so secrets never land in the message log. */
function redactPayload(p: unknown): Record<string, unknown> | null {
  if (!p || typeof p !== "object") return null;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return redact(v).slice(0, 4000);
    if (Array.isArray(v)) return v.slice(0, 100).map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).slice(0, 60).map(([k, x]) => [redact(k).slice(0, 200), walk(x)])); // redact KEYS too
    return v;
  };
  return walk(p) as Record<string, unknown>;
}

function rowToMessage(r: Record<string, unknown>): AgentMessage {
  let payload: Record<string, unknown> | null = null;
  try { payload = r.payload_json ? JSON.parse(r.payload_json as string) : null; } catch { payload = null; }
  return {
    id: r.id as string,
    from_agent_id: (r.from_agent_id as string) ?? null,
    to_agent_id: (r.to_agent_id as string) ?? null,
    to_role: (r.to_role as string) ?? null,
    work_item_id: (r.work_item_id as string) ?? null,
    type: r.type as AgentMessageType,
    payload,
    thread_id: r.thread_id as string,
    status: r.status as AgentMessageStatus,
    requires_human: !!(r.requires_human as number),
    approval_id: (r.approval_id as string) ?? null,
    created_at: r.created_at as string,
    resolved_at: (r.resolved_at as string) ?? null,
  };
}

export interface PostAgentMessageInput {
  from_agent_id?: string | null;
  to_agent_id?: string | null;
  to_role?: string | null;
  work_item_id?: string | null;
  type: AgentMessageType;
  payload?: Record<string, unknown> | null;
  thread_id?: string | null; // omit to start a new thread
  requires_human?: boolean;
  status?: AgentMessageStatus;
}

/** A short human-facing summary of a message (also used as the approval summary for requires_human). */
export function messageSummary(m: Pick<AgentMessage, "type" | "from_agent_id" | "to_agent_id" | "to_role" | "payload">): string {
  const from = m.from_agent_id ?? "an agent";
  const to = m.to_agent_id ?? m.to_role ?? "the team";
  const note = typeof m.payload?.note === "string" ? `: ${m.payload.note}` : typeof m.payload?.message === "string" ? `: ${m.payload.message}` : "";
  switch (m.type) {
    case "handoff": return `${from} handed off to ${to}${note}`.slice(0, 240);
    case "review_request": return `${from} requested a review from ${to}${note}`.slice(0, 240);
    case "question": return `${from} asks ${to}${note}`.slice(0, 240);
    case "blocker": return `${from} is blocked${note}`.slice(0, 240);
    case "result": return `${from} returned a result to ${to}${note}`.slice(0, 240);
    case "instruction": return `${from} instructed ${to}${note}`.slice(0, 240);
    case "summary": return `${from} summary${note}`.slice(0, 240);
    default: return `${from} → ${to}`;
  }
}

export function postAgentMessage(input: PostAgentMessageInput): AgentMessage {
  const type = oneOf(input.type, AGENT_MESSAGE_TYPES, "summary");
  const id = crypto.randomUUID();
  const thread_id = str(input.thread_id, 64) ?? crypto.randomUUID();
  const payload = redactPayload(input.payload);
  const now = new Date().toISOString();
  const requires_human = input.requires_human === true;

  let approval_id: string | null = null;
  if (requires_human) {
    // route the human question/blocker into the durable approvals inbox (the safety/human-in-the-loop gate)
    const { approval } = createApproval({
      kind: "plan_signoff",
      summary: messageSummary({ type, from_agent_id: input.from_agent_id ?? null, to_agent_id: input.to_agent_id ?? null, to_role: input.to_role ?? null, payload }),
      work_item_id: str(input.work_item_id, 64),
      agent_id: str(input.from_agent_id, 120),
      advice: `Inter-agent ${type} needs a human decision`,
      action: { type: "noop" },
    });
    approval_id = approval.id;
    // best-effort phone notify — an outage must not block posting the message
    (async () => {
      try {
        const { getProvider, isPhoneConfigured } = await import("./phone/index.ts");
        if (isPhoneConfigured()) await getProvider()?.sendApprovalRequest(approval);
      } catch { /* swallow */ }
    })();
  }

  db()
    .prepare(
      `INSERT INTO agent_messages (id,from_agent_id,to_agent_id,to_role,work_item_id,type,payload_json,thread_id,status,requires_human,approval_id,created_at,resolved_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)`,
    )
    .run(
      id, str(input.from_agent_id, 120), str(input.to_agent_id, 120), str(input.to_role, 64), str(input.work_item_id, 64), type,
      payload ? JSON.stringify(payload) : null, thread_id, oneOf(input.status, AGENT_MESSAGE_STATUSES, "pending"), requires_human ? 1 : 0, approval_id, now,
    );
  recordAudit({ actor: str(input.from_agent_id, 120) ?? "system", via: "agent", action: `agent_message.${type}`, approval_id, detail: redact(messageSummary({ type, from_agent_id: input.from_agent_id ?? null, to_agent_id: input.to_agent_id ?? null, to_role: input.to_role ?? null, payload })).slice(0, 200) });
  return rowToMessage(db().prepare("SELECT * FROM agent_messages WHERE id = ?").get(id) as Record<string, unknown>);
}

export function listThread(threadId: string): AgentMessage[] {
  return (db().prepare("SELECT * FROM agent_messages WHERE thread_id = ? ORDER BY created_at ASC, id ASC").all(String(threadId)) as Record<string, unknown>[]).map(rowToMessage);
}

/** Recent agent messages across ALL work items (newest first) — for the Communication Agent's context. */
export function listRecentAgentMessages(limit = 100): AgentMessage[] {
  const n = Math.min(500, Math.max(1, Math.trunc(limit)));
  return (db().prepare("SELECT * FROM agent_messages ORDER BY id DESC LIMIT ?").all(n) as Record<string, unknown>[]).map(rowToMessage);
}

export function listMessagesForWorkItem(workItemId: string): AgentMessage[] {
  return (db().prepare("SELECT * FROM agent_messages WHERE work_item_id = ? ORDER BY created_at ASC, id ASC").all(String(workItemId)) as Record<string, unknown>[]).map(rowToMessage);
}

export function getAgentMessage(id: string): AgentMessage | null {
  const r = db().prepare("SELECT * FROM agent_messages WHERE id = ?").get(String(id)) as Record<string, unknown> | undefined;
  return r ? rowToMessage(r) : null;
}

/** Resolve a message (accept/in_progress/done/reject). Sets resolved_at for terminal states. */
export function resolveMessage(id: string, status: AgentMessageStatus, actor?: string): AgentMessage {
  const cur = getAgentMessage(id);
  if (!cur) throw new HttpError(404, "agent message not found");
  if (cur.status === "done" || cur.status === "rejected") throw new HttpError(409, `message already ${cur.status}`); // terminal — can't reopen
  const next = oneOf(status, AGENT_MESSAGE_STATUSES, cur.status);
  const terminal = next === "done" || next === "rejected";
  db().prepare("UPDATE agent_messages SET status=?, resolved_at=? WHERE id=?").run(next, terminal ? new Date().toISOString() : null, id);
  recordAudit({ actor: actor ?? "dashboard", via: "dashboard", action: "agent_message.resolve", detail: `${cur.status} → ${next}` });
  return getAgentMessage(id)!;
}
