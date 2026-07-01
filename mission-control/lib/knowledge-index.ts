// Knowledge Vault index: a SECURE, searchable METADATA store that turns project docs into a "project brain" for
// agents — rules, coding standards, vision, decisions, architecture, team instructions — linkable to teams/agents.
// SECURITY FIRST: secret files (.env / keys / credentials) are NEVER indexed; every stored preview is redacted +
// secret-scrubbed; content with a detected secret is flagged safe_to_use=0. No shell-out. Not "server-only" so it
// is unit-testable (the vault reader for /kennis stays in lib/knowledge.ts).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db, recordAudit } from "./db.ts";
import { redact, redactPreview } from "./redact.ts";

export class KnowledgeError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export function knowledgeStatusOf(e: unknown): number { return e instanceof KnowledgeError ? e.status : 500; }

export type KnowledgeType =
  | "markdown" | "docs" | "project_rules" | "coding_standards" | "product_vision" | "business_goals"
  | "api_docs" | "decision" | "customer_requirements" | "architecture" | "security_rules" | "team_instruction" | "note";
export const KNOWLEDGE_TYPES: KnowledgeType[] = [
  "markdown", "docs", "project_rules", "coding_standards", "product_vision", "business_goals",
  "api_docs", "decision", "customer_requirements", "architecture", "security_rules", "team_instruction", "note",
];

export interface KnowledgeItem {
  id: string;
  title: string;
  type: KnowledgeType;
  source_path: string | null;
  source_url: string | null;
  tags: string[];
  project_id: string | null;
  team_id: string | null;
  summary: string | null;
  content_preview: string | null;
  allowed_agents: string[]; // agent ids or roles; empty = every agent may use it
  safe_to_use: boolean;
  archived: boolean;
  indexed_at: string | null;
  created_at: string;
  updated_at: string;
}

// ── security: what may never be indexed, and what marks content unsafe ──
const ALLOWED_EXT = new Set([".md", ".markdown", ".txt"]);
const MAX_FILE_BYTES = 1_000_000;
const MAX_TREE_FILES = 2000;
const SKIP_DIRS = new Set([".git", ".obsidian", ".trash", "node_modules", ".ssh", ".aws", "__pycache__"]);
// paths that must NEVER be indexed (secret / credential material) — matched against the relative path
const DENY_PATH: RegExp[] = [
  /(^|[/\\])\.env(\.|$|[/\\])/i, /\.pem$/i, /\.key$/i, /\.p12$/i, /\.pfx$/i, /\.pkcs12$/i, /\.(crt|cer|der|jks|keystore)$/i,
  /id_(rsa|dsa|ecdsa|ed25519)/i, /(^|[/\\])\.(ssh|aws|gnupg)([/\\]|$)/i, /(^|[/\\])\.(npmrc|netrc|pgpass)$/i,
  /(^|[/\\])credentials?(\.|$|[/\\])/i, /(^|[/\\])secrets?(\.|$|[/\\])/i, /(password|passwd|token|apikey|api[_-]key)/i,
  /\.(sqlite|db|log|pyc)$/i,
];
// content that, if present, marks the item safe_to_use=0 (a doc that happens to contain a secret)
const SECRET_RE: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /-----BEGIN OPENSSH PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/, /\bASIA[0-9A-Z]{16}\b/, /\bAIza[0-9A-Za-z_\-]{35}\b/,
  /\bgh[posur]_[A-Za-z0-9]{20,}\b/, /\bgithub_pat_[A-Za-z0-9_]{20,}\b/, /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\bsk-(ant-)?[A-Za-z0-9_-]{16,}\b/, /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}/,
  /(?:password|passwd|api[_-]?key|secret|token|bearer|authorization|client[_-]?secret)\s*[:=]\s*["']?[A-Za-z0-9+/=_\-]{12,}/i,
];

/** Strip anything secret-looking from text that will be STORED/shown (redact + our extra patterns). */
export function scrubSecrets(text: string): string {
  let r = redact(text);
  for (const re of SECRET_RE) r = r.replace(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"), "«REDACTED-secret»");
  return r;
}
const ext = (p: string) => path.extname(p).toLowerCase();
/** Is this path allowed to be indexed at all? (supported text ext + not a deny-listed secret path). */
export function isIndexablePath(rel: string): boolean {
  if (!ALLOWED_EXT.has(ext(rel))) return false;
  return !DENY_PATH.some((re) => re.test(rel));
}
export function hasSecretContent(content: string): boolean {
  return SECRET_RE.some((re) => re.test(content));
}
export interface SafetyVerdict { indexable: boolean; reason: string | null; has_secret: boolean; safe_to_use: boolean; preview: string }
/** THE safety gate: decide whether a source may be indexed + produce a redacted, secret-scrubbed preview. */
export function validateKnowledgeSafety(sourcePath: string | null, content: string): SafetyVerdict {
  const indexable = sourcePath ? isIndexablePath(sourcePath) : true; // manual items have no path
  const denyReason = sourcePath && !isIndexablePath(sourcePath)
    ? (!ALLOWED_EXT.has(ext(sourcePath)) ? "unsupported file type" : "denied (secret/credential path)")
    : null;
  const secret = hasSecretContent(content);
  return { indexable, reason: denyReason, has_secret: secret, safe_to_use: indexable && !secret, preview: redactPreview(scrubSecrets(content)) };
}

// ── vault path safety (traversal-guarded, confined to $VAULT_DIR) ──
export function vaultRoot(): string | null { const v = process.env.VAULT_DIR; return v && v.trim() ? path.resolve(v.trim()) : null; }
export function vaultConfigured(): boolean { return !!vaultRoot() && safe(() => fs.statSync(vaultRoot()!).isDirectory(), false); }
function safeVaultPath(rel: string): string {
  const root = vaultRoot();
  if (!root) throw new KnowledgeError(400, "VAULT_DIR is not configured");
  const p = path.resolve(root, String(rel).replace(/^[/\\]+/, ""));
  if (p !== root && !p.startsWith(root + path.sep)) throw new KnowledgeError(400, "path escapes the vault");
  return p;
}

// ── helpers ──
const now = () => new Date().toISOString();
// SECURITY: every stored/displayed text field goes through scrubSecrets (redact + the WIDER SECRET_RE set), not
// just redact() — so a secret in a title/summary/tag can never be persisted or served (content_preview already does).
const s = (v: unknown, max: number): string => scrubSecrets(typeof v === "string" ? v : String(v ?? "")).slice(0, max);
const strArr = (v: unknown, max = 24): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => scrubSecrets(x).slice(0, 80)).slice(0, max) : [];
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], dflt: T): T => (allowed.includes(v as T) ? (v as T) : dflt);
const parseArr = (j: unknown): string[] => { try { const p = JSON.parse((j as string) || "[]"); return Array.isArray(p) ? p.filter((x) => typeof x === "string") : []; } catch { return []; } };

function rowToItem(r: Record<string, unknown>): KnowledgeItem {
  return {
    id: r.id as string, title: r.title as string, type: r.type as KnowledgeType,
    source_path: (r.source_path as string) ?? null, source_url: (r.source_url as string) ?? null,
    tags: parseArr(r.tags_json), project_id: (r.project_id as string) ?? null, team_id: (r.team_id as string) ?? null,
    summary: (r.summary as string) ?? null, content_preview: (r.content_preview as string) ?? null,
    allowed_agents: parseArr(r.allowed_agents_json), safe_to_use: !!(r.safe_to_use as number), archived: !!(r.archived as number),
    indexed_at: (r.indexed_at as string) ?? null, created_at: r.created_at as string, updated_at: r.updated_at as string,
  };
}

function titleFrom(content: string, fallback: string): string {
  const h = content.match(/^\s*#\s+(.+)$/m);
  return s(h ? h[1] : fallback, 200) || fallback;
}
function summaryFrom(content: string): string {
  const line = content.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("#") && !l.startsWith("---"));
  return s(line ?? "", 300);
}

// ── add / index ──
export interface AddManualInput { kind: "manual"; title: string; type?: string; content?: string; summary?: string; tags?: string[]; team_id?: string | null; project_id?: string | null; source_url?: string | null; allowed_agents?: string[]; actor?: string }
export interface AddFileInput { kind: "file"; source_path: string; type?: string; team_id?: string | null; tags?: string[]; allowed_agents?: string[]; actor?: string }
export interface AddFolderInput { kind: "folder"; source_path?: string; type?: string; team_id?: string | null; actor?: string }
export type AddInput = AddManualInput | AddFileInput | AddFolderInput;

function upsert(item: Omit<KnowledgeItem, "created_at" | "updated_at">): KnowledgeItem {
  const ts = now();
  const existing = item.source_path ? db().prepare("SELECT id, created_at FROM knowledge_items WHERE source_path = ?").get(item.source_path) as { id: string; created_at: string } | undefined : undefined;
  const id = existing?.id ?? item.id;
  const created = existing?.created_at ?? ts;
  db().prepare(`INSERT INTO knowledge_items (id,title,type,source_path,source_url,tags_json,project_id,team_id,summary,content_preview,allowed_agents_json,safe_to_use,archived,indexed_at,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET title=excluded.title,type=excluded.type,source_url=excluded.source_url,tags_json=excluded.tags_json,project_id=excluded.project_id,team_id=excluded.team_id,summary=excluded.summary,content_preview=excluded.content_preview,allowed_agents_json=excluded.allowed_agents_json,safe_to_use=excluded.safe_to_use,indexed_at=excluded.indexed_at,updated_at=excluded.updated_at`)
    .run(id, item.title, item.type, item.source_path, item.source_url, JSON.stringify(item.tags), item.project_id, item.team_id, item.summary, item.content_preview, JSON.stringify(item.allowed_agents), item.safe_to_use ? 1 : 0, item.archived ? 1 : 0, item.indexed_at, created, ts);
  return getKnowledgeItem(id)!;
}

function indexFile(rel: string, opts: { type?: string; team_id?: string | null; tags?: string[]; allowed_agents?: string[] }): KnowledgeItem | null {
  if (!isIndexablePath(rel)) return null; // NEVER index a secret/credential/unsupported file
  const abs = safeVaultPath(rel);
  let content: string;
  try {
    // confinement: refuse to read THROUGH a symlink — resolve the real target and re-verify it stays inside the
    // real vault root (a lexical check alone is bypassable by a symlinked .md pointing at ~/.ssh, a real .env, …).
    const root = vaultRoot();
    if (!root) return null;
    const real = fs.realpathSync(abs), realRoot = fs.realpathSync(root);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return null;
    if (fs.lstatSync(abs).isSymbolicLink()) return null;
    if (fs.statSync(abs).size > MAX_FILE_BYTES) return null;
    content = fs.readFileSync(abs, "utf8");
  } catch { return null; }
  const v = validateKnowledgeSafety(rel, content);
  return upsert({
    id: crypto.randomUUID(), title: titleFrom(content, path.basename(rel)),
    type: oneOf(opts.type, KNOWLEDGE_TYPES, "markdown"), source_path: rel, source_url: null,
    tags: strArr(opts.tags), project_id: null, team_id: opts.team_id ? s(opts.team_id, 120) : null,
    summary: summaryFrom(content), content_preview: v.preview,
    allowed_agents: strArr(opts.allowed_agents), safe_to_use: v.safe_to_use, archived: false, indexed_at: now(),
  });
}

/** Add a knowledge source: a manual record, a single vault file, or a whole vault folder (secret files skipped). */
export function addKnowledgeSource(input: AddInput): { item?: KnowledgeItem; indexed?: number; skipped?: number } {
  if (input.kind === "manual") {
    const title = s(input.title, 200);
    if (!title) throw new KnowledgeError(400, "title required");
    const content = typeof input.content === "string" ? input.content : "";
    const v = validateKnowledgeSafety(null, content);
    const item = upsert({
      id: crypto.randomUUID(), title, type: oneOf(input.type, KNOWLEDGE_TYPES, "note"),
      source_path: null, source_url: input.source_url ? s(input.source_url, 500) : null,
      tags: strArr(input.tags), project_id: input.project_id ? s(input.project_id, 120) : null, team_id: input.team_id ? s(input.team_id, 120) : null,
      summary: input.summary ? s(input.summary, 300) : (content ? summaryFrom(content) : null), content_preview: content ? v.preview : null,
      allowed_agents: strArr(input.allowed_agents), safe_to_use: v.safe_to_use, archived: false, indexed_at: now(),
    });
    recordAudit({ actor: input.actor ?? "dashboard", via: "dashboard", action: "knowledge.add", detail: s(`manual: ${title}`, 160) });
    return { item };
  }
  if (input.kind === "file") {
    const item = indexFile(String(input.source_path), input);
    if (!item) throw new KnowledgeError(400, "file not indexable (denied secret/credential path, unsupported type, or unreadable)");
    recordAudit({ actor: input.actor ?? "dashboard", via: "dashboard", action: "knowledge.index_file", detail: s(input.source_path, 160) });
    return { item };
  }
  // folder
  const root = vaultRoot();
  if (!root) throw new KnowledgeError(400, "VAULT_DIR is not configured");
  const base = input.source_path ? safeVaultPath(input.source_path) : root;
  let indexed = 0, skipped = 0, seen = 0;
  const walk = (dir: string) => {
    if (seen >= MAX_TREE_FILES) return;
    let entries: fs.Dirent[]; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (seen >= MAX_TREE_FILES) break;
      if (e.isSymbolicLink()) { skipped++; continue; } // never follow a symlink out of the vault
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) walk(path.join(dir, e.name)); continue; }
      seen++;
      const rel = path.relative(root, path.join(dir, e.name));
      if (!isIndexablePath(rel)) { skipped++; continue; } // secrets / unsupported → never indexed
      if (indexFile(rel, { type: input.type, team_id: input.team_id })) indexed++; else skipped++;
    }
  };
  walk(base);
  recordAudit({ actor: input.actor ?? "dashboard", via: "dashboard", action: "knowledge.reindex", detail: s(`${input.source_path ?? "/"}: ${indexed} indexed, ${skipped} skipped`, 160) });
  return { indexed, skipped };
}

// ── reads ──
export function getKnowledgeItem(id: string): KnowledgeItem | null {
  const r = db().prepare("SELECT * FROM knowledge_items WHERE id = ?").get(String(id)) as Record<string, unknown> | undefined;
  return r ? rowToItem(r) : null;
}
export interface KnowledgeFilter { type?: KnowledgeType; team_id?: string; tag?: string; agent_id?: string; role?: string; include_archived?: boolean; safe_only?: boolean; limit?: number }
export function listKnowledgeItems(f: KnowledgeFilter = {}): KnowledgeItem[] {
  const where: string[] = []; const args: unknown[] = [];
  if (f.type) { where.push("type = ?"); args.push(f.type); }
  if (f.team_id) { where.push("(team_id = ? OR team_id IS NULL)"); args.push(f.team_id); }
  if (!f.include_archived) where.push("archived = 0");
  if (f.safe_only) where.push("safe_to_use = 1");
  const n = Number.isFinite(Math.trunc(Number(f.limit))) ? Math.min(500, Math.max(1, Math.trunc(Number(f.limit)))) : 200;
  const sql = `SELECT * FROM knowledge_items ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY updated_at DESC LIMIT ?`;
  let items = (db().prepare(sql).all(...args, n) as Record<string, unknown>[]).map(rowToItem);
  if (f.tag) items = items.filter((i) => i.tags.includes(f.tag!));
  if (f.agent_id || f.role) items = items.filter((i) => agentMayUse(i, f.agent_id, f.role));
  return items;
}

/** May this agent (id/role) use the item? Empty allowed_agents = everyone; otherwise id or role must be listed. */
export function agentMayUse(item: KnowledgeItem, agentId?: string | null, role?: string | null): boolean {
  if (item.allowed_agents.length === 0) return true;
  return (!!agentId && item.allowed_agents.includes(agentId)) || (!!role && item.allowed_agents.includes(role));
}

export interface KnowledgeHit { item: KnowledgeItem; score: number; snippet: string }
/** Search the indexed knowledge (title/summary/preview/tags). Access-scoped when an agent context is given;
 *  safe_to_use only by default (never surface flagged-unsafe content in a search). */
export function searchKnowledge(query: string, opts: { agent_id?: string | null; role?: string | null; team_id?: string | null; include_unsafe?: boolean; limit?: number } = {}): KnowledgeHit[] {
  const terms = redact(String(query)).toLowerCase().split(/[^a-z0-9#]+/).filter((t) => t.length > 2).slice(0, 12);
  const items = listKnowledgeItems({ team_id: opts.team_id ?? undefined, safe_only: !opts.include_unsafe, limit: 500 });
  const hits: KnowledgeHit[] = [];
  for (const item of items) {
    if (!agentMayUse(item, opts.agent_id, opts.role)) continue;
    const hay = `${item.title} ${item.summary ?? ""} ${item.content_preview ?? ""} ${item.tags.join(" ")}`.toLowerCase();
    const score = terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
    if (score > 0 || terms.length === 0) hits.push({ item, score, snippet: (item.summary || item.content_preview || "").slice(0, 200) });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, Math.min(50, Math.max(1, opts.limit ?? 20)));
}

/** Knowledge an agent may consult (safe, unarchived, access-ok) — for the Communication / Manager integrations. */
export function knowledgeForAgent(agentId: string | null, role: string | null, teamId?: string | null): KnowledgeItem[] {
  return listKnowledgeItems({ team_id: teamId ?? undefined, safe_only: true, agent_id: agentId ?? undefined, role: role ?? undefined, limit: 200 });
}
export function knowledgeForTeam(teamId: string | null): KnowledgeItem[] {
  return listKnowledgeItems({ team_id: teamId ?? undefined, safe_only: true, limit: 200 });
}

// ── update / archive ──
export interface KnowledgePatch { title?: string; type?: string; summary?: string; tags?: string[]; team_id?: string | null; project_id?: string | null; allowed_agents?: string[]; safe_to_use?: boolean; actor?: string }
export function updateKnowledgeItem(id: string, patch: KnowledgePatch): KnowledgeItem {
  const cur = getKnowledgeItem(id);
  if (!cur) throw new KnowledgeError(404, "knowledge item not found");
  const next: KnowledgeItem = { ...cur };
  if (patch.title !== undefined) { const t = s(patch.title, 200); if (t) next.title = t; }
  if (patch.type !== undefined) next.type = oneOf(patch.type, KNOWLEDGE_TYPES, cur.type);
  if (patch.summary !== undefined) next.summary = patch.summary ? s(patch.summary, 300) : null;
  if (patch.tags !== undefined) next.tags = strArr(patch.tags);
  if (patch.team_id !== undefined) next.team_id = patch.team_id ? s(patch.team_id, 120) : null;
  if (patch.project_id !== undefined) next.project_id = patch.project_id ? s(patch.project_id, 120) : null;
  if (patch.allowed_agents !== undefined) next.allowed_agents = strArr(patch.allowed_agents);
  if (patch.safe_to_use !== undefined) next.safe_to_use = !!patch.safe_to_use;
  db().prepare("UPDATE knowledge_items SET title=?,type=?,summary=?,tags_json=?,team_id=?,project_id=?,allowed_agents_json=?,safe_to_use=?,updated_at=? WHERE id=?")
    .run(next.title, next.type, next.summary, JSON.stringify(next.tags), next.team_id, next.project_id, JSON.stringify(next.allowed_agents), next.safe_to_use ? 1 : 0, now(), id);
  recordAudit({ actor: patch.actor ?? "dashboard", via: "dashboard", action: "knowledge.update", detail: s(next.title, 160) });
  return getKnowledgeItem(id)!;
}
export function archiveKnowledgeItem(id: string, actor?: string): KnowledgeItem {
  const cur = getKnowledgeItem(id);
  if (!cur) throw new KnowledgeError(404, "knowledge item not found");
  db().prepare("UPDATE knowledge_items SET archived=1, updated_at=? WHERE id=?").run(now(), id);
  recordAudit({ actor: actor ?? "dashboard", via: "dashboard", action: "knowledge.archive", detail: s(cur.title, 160) });
  return getKnowledgeItem(id)!;
}

// ── default team instructions (the project's ground rules — seeded once) ──
const DEFAULT_INSTRUCTIONS: { id: string; title: string; summary: string; tags: string[] }[] = [
  { id: "ki_instr_code_style", title: "Use the existing code style", summary: "Match the surrounding code — naming, formatting, patterns. Don't reformat unrelated code.", tags: ["coding", "style"] },
  { id: "ki_instr_run_tests", title: "Always run the tests", summary: "Run the test suite before opening a PR; add tests for new behaviour.", tags: ["testing", "quality"] },
  { id: "ki_instr_no_dep", title: "No new dependency without approval", summary: "Adding a dependency needs an approval — prefer the standard library / existing packages.", tags: ["dependencies", "approval"] },
  { id: "ki_instr_small_prs", title: "Make small PRs", summary: "Keep PRs focused and reviewable; split large work into subtasks.", tags: ["pr", "workflow"] },
  { id: "ki_instr_explain_risky", title: "Explain risky choices", summary: "When a change is risky, explain the trade-off and raise a decision for sign-off.", tags: ["risk", "safety"] },
  { id: "ki_instr_phone_blockers", title: "Use the Phone Command Interface for blockers", summary: "When blocked, escalate via the Phone Command Interface / Decision Inbox — don't stall silently.", tags: ["blockers", "phone"] },
];
let _seeded = false;
export function ensureDefaultInstructions(): void {
  if (_seeded) return;
  const count = Number((db().prepare("SELECT COUNT(*) AS c FROM knowledge_items WHERE type = 'team_instruction'").get() as { c: number }).c);
  if (count === 0) {
    const ts = now();
    const ins = db().prepare("INSERT OR IGNORE INTO knowledge_items (id,title,type,source_path,source_url,tags_json,project_id,team_id,summary,content_preview,allowed_agents_json,safe_to_use,archived,indexed_at,created_at,updated_at) VALUES (?,?,?,NULL,NULL,?,NULL,NULL,?,?,?,1,0,?,?,?)");
    for (const d of DEFAULT_INSTRUCTIONS) ins.run(d.id, d.title, "team_instruction", JSON.stringify(d.tags), d.summary, d.summary, JSON.stringify([]), ts, ts, ts);
  }
  _seeded = true;
}

function safe<T>(fn: () => T, dflt: T): T { try { return fn(); } catch { return dflt; } }
