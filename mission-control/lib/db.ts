import "server-only";
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
  `);
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
