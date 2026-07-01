// server-side only (uses node:sqlite + node:fs). Not importing "server-only" so the unit tests can
// run under `node --test`; node:sqlite already makes this unusable in a client bundle.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Local, co-located storage via the BUILT-IN node:sqlite (no native dependency).
 * Keeps conversation history (orchestrator chat + per-task sessions), session ids for
 * --resume, and standalone settings. File lives under $FLEET_DIR/data, 0600.
 */

function fleetDir(): string {
  const env = process.env.FLEET_DIR;
  if (env && env.trim()) return env.trim();
  return path.resolve(process.cwd(), "..");
}

let _db: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (_db) return _db;
  const dir = path.join(fleetDir(), "data");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, "mission-control.db");
  const d = new DatabaseSync(file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {}
  d.exec("PRAGMA journal_mode = WAL;");
  d.exec("PRAGMA foreign_keys = ON;");
  d.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id          TEXT PRIMARY KEY,
      kind        TEXT NOT NULL,                -- 'orchestrator' | 'task'
      issue       INTEGER,                      -- when kind='task'
      title       TEXT,
      session_id  TEXT,                         -- claude --session-id (for --resume)
      cwd         TEXT,                         -- working dir where the session lives (resume scope)
      model       TEXT,
      effort      TEXT,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role            TEXT NOT NULL,            -- 'user' | 'assistant' | 'tool' | 'system'
      content         TEXT NOT NULL,
      meta            TEXT,                     -- JSON: cost, num_turns, tool name, etc.
      created_at      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id);
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
    -- durable approvals (decision inbox: dashboard + phone). The token is stored HASHED, single-use.
    CREATE TABLE IF NOT EXISTS approvals (
      id                    TEXT PRIMARY KEY,
      kind                  TEXT NOT NULL,        -- merge|cap_increase|force_opus|deploy|secret_access|plan_signoff|risky_action|prompt_confirm
      work_item_id          TEXT,
      issue                 INTEGER,
      pr                    INTEGER,
      agent_id              TEXT,
      requested_by_agent_id TEXT,
      summary               TEXT NOT NULL,
      diff_preview          TEXT,                 -- already REDACTED + truncated before insert
      risk                  TEXT,
      advice                TEXT,
      action_json           TEXT,                 -- the validated server-side action to run on approve
      status                TEXT NOT NULL DEFAULT 'pending',  -- pending|approved|rejected|expired
      decided_by            TEXT,
      decided_via           TEXT,                 -- dashboard|phone|telegram|whatsapp|api
      decided_at            TEXT,
      reason                TEXT,
      expires_at            TEXT,
      decision_token_hash   TEXT,
      notification_ids_json TEXT,
      created_at            TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status, created_at);
    -- append-only audit log of every sensitive action (phone command, approval decision, fleet change)
    CREATE TABLE IF NOT EXISTS audit (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ts          TEXT NOT NULL,
      actor       TEXT,                 -- chat id / 'dashboard' / agent id
      via         TEXT,                 -- dashboard|phone|telegram|api|system
      action      TEXT NOT NULL,        -- e.g. approval.create / approval.decide / phone.command / fleet.pause
      kind        TEXT,
      approval_id TEXT,
      issue       INTEGER,
      detail      TEXT                  -- REDACTED JSON detail
    );
    CREATE INDEX IF NOT EXISTS idx_audit_id ON audit(id DESC);
    -- work items: every task is a traceable unit (additive — GitHub issue cards still work; a work item
    -- links to an issue/pr by number). Mutations are validated + audited server-side (lib/work-items.ts).
    CREATE TABLE IF NOT EXISTS work_items (
      id                TEXT PRIMARY KEY,
      source_type       TEXT NOT NULL,                    -- github_issue|chat|phone|agent|manual|workflow
      source_ref        TEXT,
      title             TEXT NOT NULL,
      description       TEXT,                             -- REDACTED before insert
      assigned_agent_id TEXT,
      assigned_role     TEXT,
      team_id           TEXT,
      state             TEXT NOT NULL DEFAULT 'queued',   -- queued|running|blocked|waiting_user|review|failed|done|cancelled
      priority          TEXT NOT NULL DEFAULT 'normal',   -- low|normal|high|urgent
      risk_level        TEXT NOT NULL DEFAULT 'low',      -- low|medium|high|critical
      parent_task_id    TEXT,
      issue             INTEGER,
      pr                INTEGER,
      mode              TEXT NOT NULL DEFAULT 'build_after_approval', -- plan_only|build_after_approval|autonomous_within_limits
      plan_json         TEXT,                             -- the structured plan (Plan) when submitted
      plan_summary      TEXT,
      created_by        TEXT,
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_work_items_state ON work_items(state, updated_at DESC);
    -- one work item per GitHub issue (partial: issue is nullable) — enforces the idempotency guarantee
    CREATE UNIQUE INDEX IF NOT EXISTS uq_work_items_issue ON work_items(issue) WHERE issue IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_work_items_parent ON work_items(parent_task_id);
    -- structured inter-agent collaboration log (handoffs/reviews/blockers/questions/results) — NOT a chatlayer.
    CREATE TABLE IF NOT EXISTS agent_messages (
      id             TEXT PRIMARY KEY,
      from_agent_id  TEXT,
      to_agent_id    TEXT,
      to_role        TEXT,
      work_item_id   TEXT,
      type           TEXT NOT NULL,                       -- handoff|review_request|question|result|blocker|instruction|summary
      payload_json   TEXT,                                -- REDACTED JSON
      thread_id      TEXT,
      status         TEXT NOT NULL DEFAULT 'pending',     -- pending|accepted|in_progress|done|rejected
      requires_human INTEGER NOT NULL DEFAULT 0,
      approval_id    TEXT,                                -- durable approval created when requires_human
      created_at     TEXT NOT NULL,
      resolved_at    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_agent_messages_wi ON agent_messages(work_item_id, id);
    CREATE INDEX IF NOT EXISTS idx_agent_messages_thread ON agent_messages(thread_id, id);
    -- workflow engine: templates → workflows → steps → events. Visual, traceable multi-role pipelines over
    -- the existing work_items + approvals. Orchestration + data only (the runner executes steps later).
    CREATE TABLE IF NOT EXISTS workflow_templates (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT,
      category    TEXT,
      steps_json  TEXT NOT NULL,                     -- [{name,role,required_skills[],approval_required,output_expected,max_attempts}]
      enabled     INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workflows (
      id              TEXT PRIMARY KEY,
      template_id     TEXT,
      work_item_id    TEXT,
      team_id         TEXT,
      title           TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'queued', -- queued|running|blocked|waiting_user|failed|done|cancelled
      current_step_id TEXT,
      created_by      TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_workflows_status ON workflows(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_workflows_wi ON workflows(work_item_id);
    CREATE TABLE IF NOT EXISTS workflow_steps (
      id                   TEXT PRIMARY KEY,
      workflow_id          TEXT NOT NULL,
      step_order           INTEGER NOT NULL,
      name                 TEXT NOT NULL,
      assigned_agent_id    TEXT,
      assigned_role        TEXT,
      required_skills_json TEXT,                      -- JSON string[] of skill hints
      approval_required    INTEGER NOT NULL DEFAULT 0,
      status               TEXT NOT NULL DEFAULT 'queued', -- queued|running|blocked|waiting_user|review|failed|done|skipped
      max_attempts         INTEGER NOT NULL DEFAULT 1,
      attempt_count        INTEGER NOT NULL DEFAULT 0,
      output_expected      TEXT,
      output_json          TEXT,                      -- REDACTED before insert
      approval_id          TEXT,                      -- the durable approval raised for this step (if any)
      started_at           TEXT,
      completed_at         TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_steps_wf ON workflow_steps(workflow_id, step_order);
    CREATE TABLE IF NOT EXISTS workflow_events (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_id  TEXT NOT NULL,
      step_id      TEXT,
      type         TEXT NOT NULL,
      message      TEXT,
      payload_json TEXT,                              -- REDACTED before insert
      created_at   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_events_wf ON workflow_events(workflow_id, id);
    -- manager / decomposer: a big task → a decomposition PLAN (subtasks + roles + deps + risks + a workflow
    -- proposal) that must be plan_signoff-approved before it materializes into child work_items (+ optionally
    -- agent-ready GitHub issues) and a workflow. One proposed plan per parent work item at a time.
    CREATE TABLE IF NOT EXISTS manager_plans (
      id            TEXT PRIMARY KEY,
      work_item_id  TEXT NOT NULL,                     -- the PARENT work item being decomposed
      source        TEXT,                              -- github_issue|phone|chat|dashboard|agent
      source_ref    TEXT,
      status        TEXT NOT NULL DEFAULT 'proposed',  -- proposed|approved|rejected|materialized
      plan_json     TEXT NOT NULL,                     -- the DecompositionPlan (REDACTED before insert)
      depth         INTEGER NOT NULL DEFAULT 0,        -- decomposition depth of the parent (for max_depth)
      approval_id   TEXT,
      workflow_id   TEXT,                              -- the workflow started on approval
      created_by    TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_manager_plans_wi ON manager_plans(work_item_id);
    CREATE INDEX IF NOT EXISTS idx_manager_plans_status ON manager_plans(status, updated_at DESC);
  `);
  // additive migrations for existing dbs (ADD COLUMN is idempotent-safe: errors if the column exists → ignore)
  for (const col of [
    "ALTER TABLE work_items ADD COLUMN mode TEXT NOT NULL DEFAULT 'build_after_approval'",
    "ALTER TABLE work_items ADD COLUMN plan_json TEXT",
    "ALTER TABLE work_items ADD COLUMN plan_summary TEXT",
  ]) {
    try { d.exec(col); } catch { /* column already exists */ }
  }
  _db = d;
  return d;
}

// ── conversations ──
export interface Conversation {
  id: string;
  kind: "orchestrator" | "task";
  issue: number | null;
  title: string | null;
  session_id: string | null;
  cwd: string | null;
  model: string | null;
  effort: string | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: number;
  conversation_id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  meta: string | null;
  created_at: string;
}

export function createConversation(c: {
  id: string;
  kind: "orchestrator" | "task";
  issue?: number | null;
  title?: string | null;
  session_id?: string | null;
  cwd?: string | null;
  model?: string | null;
  effort?: string | null;
}): void {
  const now = new Date().toISOString();
  db()
    .prepare(
      `INSERT INTO conversations (id,kind,issue,title,session_id,cwd,model,effort,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      c.id,
      c.kind,
      c.issue ?? null,
      c.title ?? null,
      c.session_id ?? null,
      c.cwd ?? null,
      c.model ?? null,
      c.effort ?? null,
      now,
      now,
    );
}

export function getConversation(id: string): Conversation | null {
  const row = db().prepare("SELECT * FROM conversations WHERE id = ?").get(id);
  return (row as Conversation) ?? null;
}

export function listConversations(kind?: string): Conversation[] {
  const sql = kind
    ? "SELECT * FROM conversations WHERE kind = ? ORDER BY updated_at DESC LIMIT 200"
    : "SELECT * FROM conversations ORDER BY updated_at DESC LIMIT 200";
  const stmt = db().prepare(sql);
  return (kind ? stmt.all(kind) : stmt.all()) as Conversation[];
}

export function touchConversation(id: string, patch: Partial<Conversation> = {}): void {
  const fields: string[] = ["updated_at = ?"];
  const vals: (string | number | null)[] = [new Date().toISOString()];
  for (const key of ["title", "session_id", "model", "effort", "cwd"] as const) {
    if (patch[key] !== undefined) {
      fields.push(`${key} = ?`);
      vals.push(patch[key] as string | null);
    }
  }
  vals.push(id);
  db().prepare(`UPDATE conversations SET ${fields.join(", ")} WHERE id = ?`).run(...vals);
}

export function addMessage(m: {
  conversation_id: string;
  role: Message["role"];
  content: string;
  meta?: object | null;
}): number {
  const now = new Date().toISOString();
  const r = db()
    .prepare(
      `INSERT INTO messages (conversation_id,role,content,meta,created_at) VALUES (?,?,?,?,?)`,
    )
    .run(
      m.conversation_id,
      m.role,
      m.content,
      m.meta ? JSON.stringify(m.meta) : null,
      now,
    );
  db().prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now, m.conversation_id);
  return Number(r.lastInsertRowid);
}

export function getMessages(conversationId: string): Message[] {
  return db()
    .prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC")
    .all(conversationId) as Message[];
}

// ── settings ──
export function getSetting(key: string, dflt = ""): string {
  const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? dflt;
}
export function setSetting(key: string, value: string): void {
  db()
    .prepare(
      "INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key, value);
}

// ── audit log ──
export interface AuditEntry {
  ts: string;
  actor: string | null;
  via: string | null;
  action: string;
  kind: string | null;
  approval_id: string | null;
  issue: number | null;
  detail: string | null;
}
/** Append one audit row. `detail` must already be redacted by the caller. */
export function recordAudit(e: {
  actor?: string | null;
  via?: string | null;
  action: string;
  kind?: string | null;
  approval_id?: string | null;
  issue?: number | null;
  detail?: string | null;
}): void {
  db()
    .prepare(
      `INSERT INTO audit (ts,actor,via,action,kind,approval_id,issue,detail) VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run(
      new Date().toISOString(),
      e.actor ?? null,
      e.via ?? null,
      e.action,
      e.kind ?? null,
      e.approval_id ?? null,
      e.issue ?? null,
      e.detail ?? null,
    );
}
export function listAudit(limit = 100): (AuditEntry & { id: number })[] {
  const n = Math.min(500, Math.max(1, Math.trunc(limit)));
  return db()
    .prepare("SELECT * FROM audit ORDER BY id DESC LIMIT ?")
    .all(n) as (AuditEntry & { id: number })[];
}
/** Audit trail for ONE approval (oldest → newest, so the timeline reads top-to-bottom). */
export function listAuditForApproval(approvalId: string, limit = 50): (AuditEntry & { id: number })[] {
  const n = Math.min(200, Math.max(1, Math.trunc(limit)));
  return db()
    .prepare("SELECT * FROM audit WHERE approval_id = ? ORDER BY id ASC LIMIT ?")
    .all(String(approvalId), n) as (AuditEntry & { id: number })[];
}
