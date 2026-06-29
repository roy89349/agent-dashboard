import "server-only";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

/**
 * Knowledge base = a local notes vault (Obsidian / plain markdown) at $VAULT_DIR.
 * Read / search / write, strictly confined to the vault (path-traversal guarded).
 */

const ALLOWED_EXT = new Set([".md", ".markdown", ".txt"]);
const MAX_FILE_BYTES = 1_000_000; // 1 MB cap for read/write
const MAX_TREE_FILES = 3000;
const SKIP_DIRS = new Set([".git", ".obsidian", "node_modules", ".trash"]);

class KErr extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export function kStatusOf(e: unknown): number {
  return e instanceof KErr ? e.status : 500;
}

export function vaultRoot(): string {
  return process.env.VAULT_DIR?.trim() || "";
}
export function vaultConfigured(): boolean {
  const r = vaultRoot();
  try {
    return !!r && fs.statSync(r).isDirectory();
  } catch {
    return false;
  }
}

// realpath of the nearest existing ancestor (so new files can be validated too)
function realOfNearest(full: string): string {
  let dir = full;
  for (;;) {
    try {
      return fs.realpathSync(dir);
    } catch {
      const up = path.dirname(dir);
      if (up === dir) throw new KErr(400, "path outside vault");
      dir = up;
    }
  }
}

// Resolve a vault-relative path and assert it stays inside the vault — lexically AND
// after following symlinks (realpath) — plus an allowed extension.
function resolveInVault(rel: unknown, requireExt = true): string {
  const root = vaultRoot();
  if (!root) throw new KErr(400, "no vault configured");
  if (typeof rel !== "string" || !rel || rel.length > 1024) throw new KErr(400, "invalid path");
  if (rel.includes("\0")) throw new KErr(400, "invalid path");
  const base = path.resolve(root);
  const full = path.resolve(base, rel);
  if (full !== base && !full.startsWith(base + path.sep)) throw new KErr(400, "path outside vault");
  if (requireExt && !ALLOWED_EXT.has(path.extname(full).toLowerCase()))
    throw new KErr(400, "unsupported file type");
  // symlink-escape guard: the real (symlink-resolved) location must still be inside the vault.
  const realRoot = fs.realpathSync(base);
  const real = realOfNearest(full);
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new KErr(400, "path outside vault");
  return full;
}

export interface NoteEntry {
  path: string; // vault-relative
  name: string;
  dir: string;
  size: number;
  mtime: number;
}

export function listTree(): NoteEntry[] {
  const root = vaultRoot();
  if (!vaultConfigured()) return [];
  const base = path.resolve(root);
  const out: NoteEntry[] = [];
  const walk = (dir: string) => {
    if (out.length >= MAX_TREE_FILES) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= MAX_TREE_FILES) return;
      if (e.isSymbolicLink()) continue; // never follow symlinks out of the vault
      if (e.name.startsWith(".") && e.isDirectory()) continue;
      if (SKIP_DIRS.has(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(abs);
      } else if (e.isFile() && ALLOWED_EXT.has(path.extname(e.name).toLowerCase())) {
        let st: fs.Stats;
        try {
          st = fs.statSync(abs);
        } catch {
          continue;
        }
        const rel = path.relative(base, abs);
        out.push({
          path: rel,
          name: e.name,
          dir: path.dirname(rel) === "." ? "" : path.dirname(rel),
          size: st.size,
          mtime: Math.floor(st.mtimeMs),
        });
      }
    }
  };
  walk(base);
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

export function readNote(rel: unknown): { path: string; content: string } {
  const full = resolveInVault(rel);
  let st: fs.Stats;
  try {
    st = fs.statSync(full);
  } catch {
    throw new KErr(404, "not found");
  }
  if (!st.isFile()) throw new KErr(400, "not a file");
  if (st.size > MAX_FILE_BYTES) throw new KErr(413, "file too large");
  return { path: path.relative(path.resolve(vaultRoot()), full), content: fs.readFileSync(full, "utf8") };
}

export function writeNote(rel: unknown, content: unknown): { path: string } {
  const full = resolveInVault(rel);
  if (typeof content !== "string") throw new KErr(400, "content must be a string");
  if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) throw new KErr(413, "content too large");
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const tmp = `${full}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, full);
  return { path: path.relative(path.resolve(vaultRoot()), full) };
}

export interface SearchHit {
  path: string;
  line: number;
  text: string;
}

export function searchNotes(query: unknown): SearchHit[] {
  const root = vaultRoot();
  if (!vaultConfigured()) return [];
  if (typeof query !== "string" || !query.trim()) return [];
  const q = query.trim().slice(0, 200);
  const base = path.resolve(root);

  // Prefer ripgrep (fast). Pass the query via argv (not a shell) so it's literal-safe.
  const rg = spawnSync(
    "rg",
    ["--no-heading", "--line-number", "--smart-case", "--max-count", "5", "-g", "*.md", "-g", "*.markdown", "-g", "*.txt", "--", q, base],
    { encoding: "utf8", timeout: 8000, maxBuffer: 4_000_000 },
  );
  const hits: SearchHit[] = [];
  // rg exit 0 = matches, exit 1 = NO matches (both are "ran fine"). Only fall back to the
  // JS scan when ripgrep genuinely couldn't run (binary missing / timed out / spawn error).
  if (!rg.error && (rg.status === 0 || rg.status === 1)) {
    for (const line of (rg.stdout || "").split("\n")) {
      if (!line || hits.length >= 200) break;
      // format: <abs>:<lineno>:<text>
      const m = line.match(/^(.*?):(\d+):(.*)$/);
      if (!m) continue;
      const abs = m[1];
      if (!abs.startsWith(base)) continue;
      hits.push({ path: path.relative(base, abs), line: Number(m[2]), text: m[3].slice(0, 300) });
    }
    return hits;
  }
  // Fallback: scan the tree in JS (rg missing or errored).
  const needle = q.toLowerCase();
  for (const entry of listTree()) {
    if (hits.length >= 200) break;
    let content: string;
    try {
      content = fs.readFileSync(path.join(base, entry.path), "utf8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(needle)) {
        hits.push({ path: entry.path, line: i + 1, text: lines[i].slice(0, 300) });
        if (hits.length >= 200) break;
      }
    }
  }
  return hits;
}
