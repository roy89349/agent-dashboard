// Durable approvals (the decision inbox: dashboard + phone). The decision token is stored HASHED and
// is single-use; decisions are idempotent and auditable. Pure server logic over node:sqlite — no
// fleet/github imports (action execution lives in the caller, lib/phone/actions.ts), so this stays
// testable under `node --test`. Mirrors the lock/CAS/validation style of lib/fleet.ts.
import crypto from "node:crypto";
import { db, recordAudit } from "./db.ts";
import { redact, redactPreview } from "./redact.ts";

export type ApprovalKind =
  | "merge" | "cap_increase" | "force_opus" | "deploy"
  | "secret_access" | "plan_signoff" | "risky_action" | "prompt_confirm" | "workflow_step";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";
export type DecidedVia = "dashboard" | "phone" | "telegram" | "whatsapp" | "api";

export interface Approval {
  id: string;
  kind: ApprovalKind;
  work_item_id: string | null;
  issue: number | null;
  pr: number | null;
  agent_id: string | null;
  requested_by_agent_id: string | null;
  summary: string;
  diff_preview: string | null;
  risk: string | null;
  advice: string | null;
  action_json: string | null;
  status: ApprovalStatus;
  decided_by: string | null;
  decided_via: string | null;
  decided_at: string | null;
  reason: string | null;
  expires_at: string | null;
  decision_token_hash: string | null;
  notification_ids_json: string | null;
  created_at: string;
}

const APPROVAL_KINDS: ApprovalKind[] = [
  "merge", "cap_increase", "force_opus", "deploy",
  "secret_access", "plan_signoff", "risky_action", "prompt_confirm", "workflow_step",
];
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PREVIEW = 900;

export class ApprovalError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export function approvalErrorStatus(e: unknown): number {
  return e instanceof ApprovalError ? e.status : 500;
}

// ── tokens (hashed, single-use) ──
export function mintDecisionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(String(token), "utf8").digest("hex");
}
export function verifyDecisionToken(id: string, token: string): boolean {
  const a = rawApproval(id);
  if (!a || a.status !== "pending" || !a.decision_token_hash || !token) return false;
  const want = Buffer.from(a.decision_token_hash, "hex");
  const got = Buffer.from(hashToken(token), "hex");
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

// ── reads ──
function rawApproval(id: string): Approval | null {
  return (db().prepare("SELECT * FROM approvals WHERE id = ?").get(id) as Approval | undefined) ?? null;
}
function maybeExpire(row: Approval): Approval {
  if (row.status === "pending" && row.expires_at && Date.parse(row.expires_at) < Date.now()) {
    db().prepare("UPDATE approvals SET status='expired' WHERE id=? AND status='pending'").run(row.id);
    return { ...row, status: "expired" };
  }
  return row;
}
export function getApproval(id: string): Approval | null {
  const r = rawApproval(id);
  return r ? maybeExpire(r) : null;
}
export function listPendingApprovals(): Approval[] {
  const rows = db()
    .prepare("SELECT * FROM approvals WHERE status='pending' ORDER BY created_at DESC LIMIT 200")
    .all() as Approval[];
  return rows.map(maybeExpire).filter((a) => a.status === "pending");
}
export function listApprovals(limit = 100): Approval[] {
  const n = Math.min(500, Math.max(1, Math.trunc(limit)));
  const rows = db().prepare("SELECT * FROM approvals ORDER BY created_at DESC LIMIT ?").all(n) as Approval[];
  return rows.map(maybeExpire);
}
/** READ-ONLY variant: recent approvals WITHOUT the lazy-expire write side effect. Callers that only display
 *  (e.g. the War Room GET) must not mutate; compute effective status in-memory if needed. */
export function listApprovalsRO(limit = 100): Approval[] {
  const n = Math.min(500, Math.max(1, Math.trunc(limit)));
  return db().prepare("SELECT * FROM approvals ORDER BY created_at DESC LIMIT ?").all(n) as Approval[];
}
/** Bulk-expire overdue pending approvals (call from a poller / before listing). Returns count. */
export function expireApprovals(): number {
  const r = db()
    .prepare("UPDATE approvals SET status='expired' WHERE status='pending' AND expires_at IS NOT NULL AND expires_at < ?")
    .run(new Date().toISOString());
  return Number(r.changes ?? 0);
}

/** Strip the token hash before anything leaves the server. */
export function publicApproval(a: Approval): Omit<Approval, "decision_token_hash"> {
  const { decision_token_hash: _omit, ...rest } = a;
  void _omit;
  return rest;
}

// ── create ──
export interface CreateApprovalInput {
  kind: ApprovalKind;
  summary: string;
  issue?: number | null;
  pr?: number | null;
  agent_id?: string | null;
  requested_by_agent_id?: string | null;
  work_item_id?: string | null;
  diff_preview?: string | null; // redacted + truncated on the way in
  risk?: string | null;
  advice?: string | null;
  action?: object | null; // the validated server-side action to run on approve (e.g. {type:'merge',pr:12})
  ttlMs?: number;
}

/** Create a pending approval. Returns the row + the RAW one-time token (only available here). */
export function createApproval(input: CreateApprovalInput): { approval: Approval; token: string } {
  if (!APPROVAL_KINDS.includes(input.kind)) throw new ApprovalError(400, `invalid kind: ${input.kind}`);
  if (!input.summary || typeof input.summary !== "string") throw new ApprovalError(400, "summary required");
  const id = crypto.randomUUID();
  const token = mintDecisionToken();
  const now = new Date();
  const expires = new Date(now.getTime() + (input.ttlMs ?? DEFAULT_TTL_MS)).toISOString();
  const preview = input.diff_preview ? redactPreview(String(input.diff_preview), MAX_PREVIEW) : null;
  db()
    .prepare(
      `INSERT INTO approvals
       (id,kind,work_item_id,issue,pr,agent_id,requested_by_agent_id,summary,diff_preview,risk,advice,
        action_json,status,expires_at,decision_token_hash,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'pending', ?,?,?)`,
    )
    .run(
      id,
      input.kind,
      input.work_item_id ?? null,
      input.issue ?? null,
      input.pr ?? null,
      input.agent_id ?? null,
      input.requested_by_agent_id ?? null,
      redact(input.summary).slice(0, 500),
      preview,
      input.risk ? redact(input.risk).slice(0, 300) : null,
      input.advice ? redact(input.advice).slice(0, 300) : null,
      input.action ? JSON.stringify(input.action) : null,
      expires,
      hashToken(token),
      now.toISOString(),
    );
  recordAudit({
    via: "system",
    action: "approval.create",
    kind: input.kind,
    approval_id: id,
    issue: input.issue ?? null,
    detail: redact(input.summary).slice(0, 200),
  });
  return { approval: rawApproval(id)!, token };
}

// ── decide ──
export interface DecideOpts {
  via: DecidedVia;
  by: string;
  token?: string; // a valid one-time token, OR …
  trusted?: boolean; // … the caller already authenticated the actor (dashboard session / verified chat)
  reason?: string;
}

/** Decide an approval. Idempotent: repeating the SAME decision returns it; a DIFFERENT one → 409.
 *  Auth: a valid single-use token OR opts.trusted. Expired → 410. Consumes the token on success. */
export function decideApproval(id: string, action: "approve" | "reject", opts: DecideOpts): Approval {
  const a = getApproval(id); // also lazily expires
  if (!a) throw new ApprovalError(404, "approval not found");
  if (a.status === "expired") throw new ApprovalError(410, "approval expired");
  const want: ApprovalStatus = action === "approve" ? "approved" : "rejected";
  if (a.status !== "pending") {
    if (a.status === want) return a; // idempotent re-decision
    throw new ApprovalError(409, `already ${a.status}`);
  }
  if (!opts.trusted) {
    if (!opts.token || !verifyDecisionToken(id, opts.token))
      throw new ApprovalError(403, "invalid or missing decision token");
  }
  db()
    .prepare(
      `UPDATE approvals SET status=?, decided_by=?, decided_via=?, decided_at=?, reason=?,
       decision_token_hash=NULL WHERE id=? AND status='pending'`,
    )
    .run(
      want,
      String(opts.by).slice(0, 120),
      opts.via,
      new Date().toISOString(),
      opts.reason ? redact(opts.reason).slice(0, 300) : null,
      id,
    );
  recordAudit({
    actor: String(opts.by).slice(0, 120),
    via: opts.via,
    action: "approval.decide",
    kind: a.kind,
    approval_id: id,
    issue: a.issue,
    detail: action,
  });
  return getApproval(id) ?? a;
}

/** Redact + clamp any preview text before it leaves the server (e.g. to a phone). */
export function redactApprovalPreview(s: string, maxLen = 900): string {
  return redactPreview(s, maxLen);
}
