// Multi-repo registry, co-located with the fleet at $CONTROL_DIR/repos.json (falls back to
// $FLEET_DIR/control/repos.json). Mirrors lib/agents.ts / lib/teams.ts: file lock + CAS-on-rev + atomic
// 0600 write + strict per-entry validation (slug id, owner/name repo, absolute repo_dir, clamped
// overrides), unique ids, unknown-field stripping.
//
// SHARED CONTRACT (repo-schema.md — all three golf-3 agents build to it): the registry holds EXTRA repos
// only. The PRIMARY repo is synthesised from env (REPO/REPO_DIR/PROJECT_NAME/PROJECT_DESC/GREEN_CMD/
// LABEL_READY) as id "primary" and is NEVER stored in the file. An absent/empty file = single-repo mode
// (zero-config default), byte-identical to today — reads NEVER throw and fall back to {rev:0, repos:[]}.
// repo_dir is only FORMAT-validated (absolute, no ".."): it lives on the fleet host, not the dashboard.
// Secrets never live here; redact() runs on any outbound surface (audit/phone/UI). Not importing
// "server-only" so the unit tests (repos.test.ts) run under node --test, exactly like agents.ts / teams.ts.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { REPO_BUDGET_MODES, RISK_FLOORS } from "./types.ts";
import type { Repo, RepoInput, ReposFile, ReposPatch, RepoOverrides, ResolvedRepo, RepoBudgetMode, RiskFloor } from "./types";

// ── paths (same resolution as fleet.ts / agents.ts / teams.ts, plus the $CONTROL_DIR / $REPOS_FILE
//    overrides the shell contract uses) ──
function fleetDir(): string {
  const env = process.env.FLEET_DIR;
  if (env && env.trim()) return env.trim();
  return path.resolve(process.cwd(), ".."); // dashboard lives in $FLEET_DIR/mission-control
}
const CONTROL = () => {
  const env = process.env.CONTROL_DIR;
  return env && env.trim() ? env.trim() : path.join(fleetDir(), "control");
};
const F_REPOS = () => {
  const env = process.env.REPOS_FILE;
  return env && env.trim() ? env.trim() : path.join(CONTROL(), "repos.json");
};
const F_LOCK = () => `${F_REPOS()}.lock`;

// ── the PRIMARY repo, synthesised from env — NEVER stored in repos.json ──
export const PRIMARY_ID = "primary";
/** The env-configured primary as a full ResolvedRepo (id "primary", enabled, no overrides). */
export function primaryRepo(): ResolvedRepo {
  const repo = (process.env.REPO ?? "").trim();
  const repo_dir = (process.env.REPO_DIR ?? "").trim();
  const project_name = (process.env.PROJECT_NAME ?? "").trim();
  const name = project_name || (repo.includes("/") ? repo.split("/")[1] : repo) || "Primary";
  return {
    id: PRIMARY_ID,
    name,
    repo,
    repo_dir,
    project_name: project_name || name,
    project_desc: (process.env.PROJECT_DESC ?? "").trim(),
    green_cmd: (process.env.GREEN_CMD ?? "").trim(),
    label_ready: (process.env.LABEL_READY ?? "").trim(),
    vault_dir: (process.env.VAULT_DIR ?? "").trim(),
    enabled: true,
    overrides: emptyOverrides(),
    primary: true,
  };
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

// ── validators (CONTRACT: id [a-z0-9-]{1,40}, unique, NOT "primary") ──
const ID_RE = /^[a-z0-9-]{1,40}$/;
// GitHub owner (≤39, no leading/trailing '-') / repo name (word chars . _ -)
const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}\/[A-Za-z0-9._-]{1,100}$/;
const MAX_REPOS = 50;

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

function emptyOverrides(): RepoOverrides {
  return { budget_mode: null, max_pr_per_day: null, risk_floor: null, model: null };
}

/** Clamp/enum-check the overrides. Everything is null-or-narrow: an unknown value → null (inherit). */
function normOverrides(v: unknown): RepoOverrides {
  const o = (v ?? {}) as Partial<RepoOverrides>;
  const budget_mode = REPO_BUDGET_MODES.includes(o.budget_mode as RepoBudgetMode) ? (o.budget_mode as RepoBudgetMode) : null;
  const risk_floor = RISK_FLOORS.includes(o.risk_floor as RiskFloor) ? (o.risk_floor as RiskFloor) : null;
  let max_pr_per_day: number | null = null;
  if (o.max_pr_per_day != null) {
    const n = typeof o.max_pr_per_day === "number" ? Math.trunc(o.max_pr_per_day) : NaN;
    max_pr_per_day = Number.isFinite(n) && n > 0 ? Math.min(n, 1000) : null; // null-or-positive-int
  }
  const model = typeof o.model === "string" && o.model.trim() ? o.model.trim().slice(0, 80) : null;
  return { budget_mode, max_pr_per_day, risk_floor, model };
}

/** Validate + normalize ONE repo (400 on bad input) and strip unknown fields. Format checks only for
 *  repo_dir — it lives on the fleet host, so no existence check beyond "absolute path, no ..". */
export function normalizeRepo(input: RepoInput): Repo {
  if (!input || typeof input !== "object") throw new HttpError(400, "repo entry required");
  const id = typeof input.id === "string" ? input.id : "";
  if (!ID_RE.test(id)) throw new HttpError(400, "repo id required (slug: [a-z0-9-], 1–40 chars)");
  if (id === PRIMARY_ID) throw new HttpError(400, `id '${PRIMARY_ID}' is reserved for the env repo`);
  const repo = str(input.repo, 200);
  if (!REPO_RE.test(repo)) throw new HttpError(400, `repo ${id}: 'repo' must be owner/name`);
  const repo_dir = str(input.repo_dir, 300);
  if (!path.posix.isAbsolute(repo_dir) || repo_dir.split("/").includes(".."))
    throw new HttpError(400, `repo ${id}: 'repo_dir' must be an absolute path`);
  const name = str(input.name, 120) || id;
  return {
    id,
    name,
    repo,
    repo_dir,
    project_name: str(input.project_name, 120) || name,
    project_desc: str(input.project_desc, 2000),
    green_cmd: str(input.green_cmd, 512), // "" = inherit GREEN_CMD
    label_ready: str(input.label_ready, 120), // "" = inherit LABEL_READY
    vault_dir: str(input.vault_dir, 300),
    enabled: input.enabled !== false,
    overrides: normOverrides(input.overrides),
  };
}

function atomicWriteSync(file: string, data: string) {
  const tmp = `${file}.tmp.${process.pid}.${crypto.randomBytes(4).toString("hex")}`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {}
}

// ── reads (never throw; absent/corrupt file = zero-config single-repo) ──
function emptyFile(): ReposFile {
  return { schema: 1, rev: 0, updated_at: null, repos: [] };
}
function safeNormalize(r: RepoInput): Repo | null {
  try {
    return normalizeRepo(r);
  } catch {
    return null; // a single corrupt entry is dropped; the rest (and the rev) survive
  }
}
function coerceFile(d: unknown): ReposFile {
  const o = (d ?? {}) as Partial<ReposFile>;
  const seen = new Set<string>();
  const repos = (Array.isArray(o.repos) ? (o.repos as RepoInput[]) : [])
    .map(safeNormalize)
    .filter((r): r is Repo => !!r && r.id !== PRIMARY_ID && !seen.has(r.id) && (seen.add(r.id), true));
  return {
    schema: 1,
    rev: typeof o.rev === "number" && o.rev >= 0 ? Math.trunc(o.rev) : 0,
    updated_at: typeof o.updated_at === "string" ? o.updated_at : null,
    repos,
  };
}
/** Read the live registry (EXTRAS only). Missing/broken file → {schema:1, rev:0, repos:[]}. */
export function readRepos(): ReposFile {
  try {
    return coerceFile(JSON.parse(fs.readFileSync(F_REPOS(), "utf8")));
  } catch {
    return emptyFile();
  }
}

/** The resolved list the dashboard/fleet iterates: the synthesised PRIMARY first, then each ENABLED
 *  extra (in stored order). Single-repo installs get exactly [primary]. */
export function listReposResolved(): ResolvedRepo[] {
  return [
    primaryRepo(),
    ...readRepos()
      .repos.filter((r) => r.enabled)
      .map((r) => ({ ...r, primary: false })),
  ];
}

/** Resolve a card/slot `repo` id to a resolved entry (tolerates absence/unknown → primary/null). */
export function repoById(id: string | null | undefined): ResolvedRepo | null {
  if (!id || id === PRIMARY_ID) return primaryRepo();
  const r = readRepos().repos.find((x) => x.id === id);
  return r ? { ...r, primary: false } : null;
}

// ── lock (identical to agents.ts / teams.ts / fleet.ts) ──
function withLock<T>(fn: () => T): T {
  const lock = F_LOCK();
  const STALE_MS = 5000;
  let held = false;
  for (let i = 0; i < 60 && !held; i++) {
    try {
      const fd = fs.openSync(lock, "wx", 0o600);
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, ts: Date.now() }));
      fs.closeSync(fd);
      held = true;
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      try {
        const st = fs.statSync(lock);
        if (Date.now() - st.mtimeMs > STALE_MS) {
          fs.unlinkSync(lock);
          continue;
        }
      } catch {
        continue;
      }
      const until = Date.now() + 10;
      while (Date.now() < until) {}
    }
  }
  if (!held) throw new HttpError(503, "repos registry busy (could not acquire lock)");
  try {
    return fn();
  } finally {
    try {
      fs.unlinkSync(lock);
    } catch {}
  }
}

/** Validate + apply a patch (upsert-merge / remove) to the current EXTRAS and return the new list. */
export function sanitizeRepoPatch(patch: ReposPatch, current: ReposFile): Repo[] {
  let list = current.repos.slice();

  if (patch.upsert !== undefined) {
    if (typeof patch.upsert.id !== "string") throw new HttpError(400, "upsert.id required");
    const i = list.findIndex((r) => r.id === patch.upsert!.id);
    // MERGE over the existing entry so a partial upsert ({id, enabled}) only changes the named fields.
    const base = i >= 0 ? list[i] : undefined;
    const merged = (base ? { ...base, ...patch.upsert, overrides: { ...base.overrides, ...(patch.upsert.overrides ?? {}) } } : patch.upsert) as RepoInput;
    const n = normalizeRepo(merged);
    if (i >= 0) list[i] = n;
    else list.push(n);
  }
  if (patch.remove !== undefined) {
    if (typeof patch.remove !== "string") throw new HttpError(400, "remove must be a repo id");
    if (patch.remove === PRIMARY_ID) throw new HttpError(400, `cannot remove the '${PRIMARY_ID}' repo (env-configured)`);
    list = list.filter((r) => r.id !== patch.remove);
  }

  const seen = new Set<string>();
  for (const r of list) {
    if (seen.has(r.id)) throw new HttpError(400, `duplicate repo id: ${r.id}`);
    seen.add(r.id);
  }
  if (list.length > MAX_REPOS) throw new HttpError(400, `too many repos (max ${MAX_REPOS})`);
  return list;
}

/** Write with CAS on rev. baseRev must equal the current rev or → 409. Returns the new rev. */
export function writeRepos(patch: ReposPatch, baseRev: number): number {
  return withLock(() => {
    const current = readRepos();
    if (typeof baseRev !== "number" || baseRev !== current.rev)
      throw new HttpError(409, `stale state (rev ${baseRev} ≠ ${current.rev}) — reload`);
    const repos = sanitizeRepoPatch(patch, current);
    const next: ReposFile = { schema: 1, rev: current.rev + 1, updated_at: new Date().toISOString(), repos };
    atomicWriteSync(F_REPOS(), JSON.stringify(next, null, 2));
    return next.rev;
  });
}

/** Delete one EXTRA repo by id (never the env "primary"). Self-CAS: reads the fresh rev under the lock.
 *  Returns the new rev, or the unchanged rev if the id wasn't present. */
export function deleteRepo(id: string): number {
  if (id === PRIMARY_ID) throw new HttpError(400, `cannot delete the '${PRIMARY_ID}' repo (env-configured)`);
  return withLock(() => {
    const current = readRepos();
    if (!current.repos.some((r) => r.id === id)) return current.rev; // idempotent no-op
    const repos = current.repos.filter((r) => r.id !== id);
    const next: ReposFile = { schema: 1, rev: current.rev + 1, updated_at: new Date().toISOString(), repos };
    atomicWriteSync(F_REPOS(), JSON.stringify(next, null, 2));
    return next.rev;
  });
}
