// Audit Log service: read/filter/search/export over the append-only audit_events table. The WRITE + central
// redaction live in db.ts (insertAuditEvent), so every recordAudit() call across the app already flows in — this
// module is the rich public API (logAuditEvent + queries + export). No secret ever reaches storage un-redacted.
import { db, insertAuditEvent, type AuditEventInput, type AuditActorType, type AuditStatus, type AuditSource } from "./db.ts";
import { redact } from "./redact.ts";

export type { AuditEventInput, AuditActorType, AuditStatus, AuditSource } from "./db.ts";
export const ACTOR_TYPES: AuditActorType[] = ["user", "agent", "system", "phone", "api"];
export const AUDIT_STATUSES: AuditStatus[] = ["allowed", "denied", "pending_approval", "approved", "rejected", "failed"];
export const AUDIT_SOURCES: AuditSource[] = ["dashboard", "phone", "telegram", "whatsapp", "worker", "supervisor", "api"];
export const RISK_LEVELS = ["low", "medium", "high", "critical"] as const;

export interface AuditEvent {
  id: string;
  ts: string;
  actor_type: string | null;
  actor_id: string | null;
  actor_label: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  risk_level: string | null;
  status: string | null;
  old_value_json: string | null;
  new_value_json: string | null;
  details_json: string | null;
  redacted_summary: string | null;
  related_work_item_id: string | null;
  related_workflow_id: string | null;
  related_approval_id: string | null;
  related_pr: number | null;
  related_issue: number | null;
  source: string | null;
  created_at: string;
}

/** The public write entry (the goal's `logAuditEvent`) — redaction happens inside insertAuditEvent. */
export function logAuditEvent(input: AuditEventInput): string {
  return insertAuditEvent(input);
}

/** Central redaction helper for callers that want to pre-scrub a value/diff before logging. */
export function redactAuditDetails(v: unknown, max = 4000): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : (() => { try { return JSON.stringify(v); } catch { return String(v); } })();
  return redact(s).slice(0, max);
}

export interface AuditFilter {
  actor_id?: string | null;
  actor_type?: string | null;
  action?: string | null;      // exact, or a trailing-dot prefix like "workflow."
  risk_level?: string | null;
  status?: string | null;
  source?: string | null;
  agent_id?: string | null;    // matches actor_id OR target_id
  work_item_id?: string | null;
  workflow_id?: string | null;
  approval_id?: string | null;
  from?: string | null;        // ISO, inclusive
  to?: string | null;          // ISO, inclusive
  q?: string | null;           // search
  limit?: number;
  offset?: number;
}

const esc = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);
function buildWhere(f: AuditFilter): { sql: string; args: unknown[] } {
  const where: string[] = []; const args: unknown[] = [];
  if (f.actor_id) { where.push("actor_id = ?"); args.push(f.actor_id); }
  if (f.actor_type) { where.push("actor_type = ?"); args.push(f.actor_type); }
  if (f.action) {
    if (f.action.endsWith(".")) { where.push("action LIKE ? ESCAPE '\\'"); args.push(esc(f.action) + "%"); }
    else { where.push("action = ?"); args.push(f.action); }
  }
  if (f.risk_level) { where.push("risk_level = ?"); args.push(f.risk_level); }
  if (f.status) { where.push("status = ?"); args.push(f.status); }
  if (f.source) { where.push("source = ?"); args.push(f.source); }
  if (f.agent_id) { where.push("(actor_id = ? OR target_id = ?)"); args.push(f.agent_id, f.agent_id); }
  if (f.work_item_id) { where.push("related_work_item_id = ?"); args.push(f.work_item_id); }
  if (f.workflow_id) { where.push("related_workflow_id = ?"); args.push(f.workflow_id); }
  if (f.approval_id) { where.push("related_approval_id = ?"); args.push(f.approval_id); }
  if (f.from) { where.push("created_at >= ?"); args.push(f.from); }
  if (f.to) { where.push("created_at <= ?"); args.push(f.to); }
  if (f.q && f.q.trim()) {
    const like = "%" + esc(f.q.trim()) + "%";
    where.push("(action LIKE ? ESCAPE '\\' OR actor_label LIKE ? ESCAPE '\\' OR actor_id LIKE ? ESCAPE '\\' OR target_id LIKE ? ESCAPE '\\' OR redacted_summary LIKE ? ESCAPE '\\' OR details_json LIKE ? ESCAPE '\\')");
    args.push(like, like, like, like, like, like);
  }
  return { sql: where.length ? "WHERE " + where.join(" AND ") : "", args };
}

export function listAuditEvents(f: AuditFilter = {}): { events: AuditEvent[]; total: number } {
  const { sql, args } = buildWhere(f);
  const limit = Number.isFinite(Number(f.limit)) ? Math.min(500, Math.max(1, Math.trunc(Number(f.limit)))) : 100;
  const offset = Number.isFinite(Number(f.offset)) ? Math.max(0, Math.trunc(Number(f.offset))) : 0;
  const total = (db().prepare(`SELECT COUNT(*) AS c FROM audit_events ${sql}`).get(...args) as { c: number }).c;
  const events = db().prepare(`SELECT * FROM audit_events ${sql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset) as AuditEvent[];
  return { events, total };
}

export function getAuditEvent(id: string): AuditEvent | null {
  return (db().prepare("SELECT * FROM audit_events WHERE id = ?").get(String(id)) as AuditEvent) ?? null;
}

// ── export ──
const CSV_COLS: (keyof AuditEvent)[] = ["created_at", "actor_type", "actor_id", "actor_label", "action", "target_type", "target_id", "risk_level", "status", "source", "related_work_item_id", "related_workflow_id", "related_approval_id", "related_pr", "related_issue", "redacted_summary", "id"];
/** Escape a CSV cell: quote when needed AND neutralise spreadsheet formula injection (=,+,-,@,tab,CR leading). */
function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // formula-injection guard
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}
export function exportAuditEvents(f: AuditFilter = {}, format: "json" | "csv" = "json"): { body: string; contentType: string; filename: string } {
  const { sql, args } = buildWhere(f);
  const cap = Math.min(50000, Number.isFinite(Number(f.limit)) ? Math.max(1, Math.trunc(Number(f.limit))) : 10000);
  const rows = db().prepare(`SELECT * FROM audit_events ${sql} ORDER BY created_at DESC, id DESC LIMIT ?`).all(...args, cap) as AuditEvent[];
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "csv") {
    const header = CSV_COLS.join(",");
    const lines = rows.map((r) => CSV_COLS.map((c) => csvCell(r[c])).join(","));
    return { body: [header, ...lines].join("\r\n"), contentType: "text/csv; charset=utf-8", filename: `audit-${stamp}.csv` };
  }
  return { body: JSON.stringify(rows, null, 2), contentType: "application/json", filename: `audit-${stamp}.json` };
}
