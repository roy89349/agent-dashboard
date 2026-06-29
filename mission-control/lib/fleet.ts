import "server-only";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {
  FleetDesired,
  FleetStatus,
  FleetCommand,
  FleetMode,
  RouterMode,
  Effort,
} from "./types";

const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

/**
 * The only filesystem bridge between the dashboard (UI) and the fleet, co-located on
 * the same host. NO child_process / shell — the UI only writes declarative
 * state (control/fleet.json) and imperative one-shots (control/commands.jsonl);
 * the supervisor reads those every tick. All safeguards (lock+CAS, clamps, confirm-gate,
 * opus-env-gate, atomic write, path-assert, secret redaction) live here AND
 * defensively in the supervisor — this file is the file-trust-boundary.
 */

// ── paths ──
function fleetDir(): string {
  const env = process.env.FLEET_DIR;
  if (env && env.trim()) return env.trim();
  // co-located default: the dashboard lives in $FLEET_DIR/mission-control
  return path.resolve(process.cwd(), "..");
}
const CONTROL = () => path.join(fleetDir(), "control");
const LOGS = () => path.join(fleetDir(), "logs");
const F_FLEET = () => path.join(CONTROL(), "fleet.json");
const F_LOCK = () => path.join(CONTROL(), "fleet.lock");
const F_CMDS = () => path.join(CONTROL(), "commands.jsonl");
const F_STATUS = () => path.join(CONTROL(), "status.json");

// ── server-side ceilings (mirror of config.env; the UI can NEVER override them) ──
const ENVI = (k: string, d: number) => {
  const v = parseInt(process.env[k] ?? "", 10);
  return Number.isFinite(v) ? v : d;
};
const HARD_MAX_WORKERS = () => ENVI("HARD_MAX_WORKERS", 8);
const HARD_MAX_PR_PER_DAY = () => ENVI("HARD_MAX_PR_PER_DAY", 50);
const HARD_MAX_FAIL_BREAK = () => ENVI("HARD_MAX_FAIL_BREAK", 20);
const MIN_FAIL_BREAK = () => ENVI("MIN_FAIL_BREAK", 1);
const ALLOW_GLOBAL_OPUS = () => (process.env.ALLOW_GLOBAL_OPUS ?? "0") === "1";
const LOG_CHUNK_MAX = () => ENVI("LOG_CHUNK_MAX", 65536);

const ISSUE_MAX = 9999999;

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export function httpStatusOf(e: unknown): number {
  return e instanceof HttpError ? e.status : 500;
}

// ── atomic write (tmp in the same dir + rename, 0600) ──
function atomicWriteSync(file: string, data: string) {
  const tmp = `${file}.tmp.${process.pid}.${crypto.randomBytes(4).toString("hex")}`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {}
}

// ── defaults ──
function defaultDesired(): FleetDesired {
  return {
    schema: 1,
    rev: 0,
    updated_at: null,
    mode: "running",
    max_workers: null,
    max_pr_per_day: null,
    fail_break: null,
    router: null,
    effort: null,
    review: null,
    priority: [],
    tasks: {},
  };
}

// ── reads ──
export function readFleet(): FleetDesired {
  try {
    const raw = fs.readFileSync(F_FLEET(), "utf8");
    const d = JSON.parse(raw);
    return { ...defaultDesired(), ...d };
  } catch {
    return defaultDesired();
  }
}

export function readStatus(): FleetStatus | null {
  let st: FleetStatus;
  try {
    st = JSON.parse(fs.readFileSync(F_STATUS(), "utf8"));
  } catch {
    return null;
  }
  // liveness: pid is alive (co-located) + heartbeat not stale
  let online = false;
  if (typeof st.supervisor_pid === "number" && st.supervisor_pid > 0) {
    try {
      process.kill(st.supervisor_pid, 0);
      online = true;
    } catch {
      online = false;
    }
  }
  if (online && st.heartbeat) {
    const age = Date.now() - new Date(st.heartbeat).getTime();
    if (!(age < 5 * 60 * 1000)) online = false; // > 5 min old → dead after all
  }
  return { ...st, online };
}

// ── lock (exclusive, with bounded retry + stale-break) ──
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
        continue; // lock just disappeared → retry
      }
      const until = Date.now() + 10; // short sync wait (control actions are rare)
      while (Date.now() < until) {}
    }
  }
  if (!held) throw new HttpError(503, "fleet busy (could not acquire lock)");
  try {
    return fn();
  } finally {
    try {
      fs.unlinkSync(lock);
    } catch {}
  }
}

// ── validation / clamp ──
const clampInt = (v: unknown, lo: number, hi: number, dflt: number): number => {
  const n = typeof v === "number" ? Math.trunc(v) : NaN;
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
};

export interface FleetPatch {
  mode?: FleetMode;
  max_workers?: number | null;
  max_pr_per_day?: number | null;
  fail_break?: number | null;
  router?: RouterMode | null;
  effort?: Effort | null;
  review?: "on" | "off" | null;
  priority?: number[];
  tasks?: Record<string, { model?: "sonnet" | "opus"; effort?: Effort }>;
}

function sanitizePatch(patch: FleetPatch, current: FleetDesired): Partial<FleetDesired> {
  const out: Partial<FleetDesired> = {};
  if (patch.mode !== undefined) {
    if (!["running", "paused", "stopped"].includes(patch.mode))
      throw new HttpError(400, "invalid mode");
    out.mode = patch.mode;
  }
  if (patch.max_workers !== undefined)
    out.max_workers =
      patch.max_workers === null ? null : clampInt(patch.max_workers, 1, HARD_MAX_WORKERS(), 1);
  if (patch.max_pr_per_day !== undefined)
    out.max_pr_per_day =
      patch.max_pr_per_day === null
        ? null
        : clampInt(patch.max_pr_per_day, 0, HARD_MAX_PR_PER_DAY(), 0);
  if (patch.fail_break !== undefined)
    out.fail_break =
      patch.fail_break === null
        ? null
        : clampInt(patch.fail_break, MIN_FAIL_BREAK(), HARD_MAX_FAIL_BREAK(), MIN_FAIL_BREAK());
  if (patch.router !== undefined) {
    if (patch.router !== null && !["auto", "sonnet", "opus"].includes(patch.router))
      throw new HttpError(400, "invalid router");
    out.router = patch.router;
  }
  if (patch.effort !== undefined) {
    if (patch.effort !== null && !EFFORTS.includes(patch.effort))
      throw new HttpError(400, "invalid effort");
    out.effort = patch.effort;
  }
  if (patch.review !== undefined) {
    if (patch.review !== null && !["on", "off"].includes(patch.review))
      throw new HttpError(400, "invalid review value");
    out.review = patch.review;
  }
  if (patch.priority !== undefined) {
    if (!Array.isArray(patch.priority)) throw new HttpError(400, "priority must be a list");
    out.priority = patch.priority
      .map((n) => Math.trunc(Number(n)))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= ISSUE_MAX)
      .slice(0, 200);
  }
  if (patch.tasks !== undefined) {
    if (typeof patch.tasks !== "object" || patch.tasks === null)
      throw new HttpError(400, "tasks must be an object");
    const t: Record<string, { model?: "sonnet" | "opus"; effort?: Effort }> = {};
    for (const [k, v] of Object.entries(patch.tasks)) {
      const n = Math.trunc(Number(k));
      if (!Number.isInteger(n) || n < 1 || n > ISSUE_MAX) continue;
      const entry: { model?: "sonnet" | "opus"; effort?: Effort } = {};
      const model = (v as { model?: string })?.model;
      if (model === "sonnet" || model === "opus") entry.model = model;
      const eff = (v as { effort?: string })?.effort;
      if (eff && EFFORTS.includes(eff)) entry.effort = eff as Effort;
      if (entry.model || entry.effort) t[String(n)] = entry;
    }
    out.tasks = t;
  }
  // opus-env-gate: forcing opus only with the server flag
  if (!ALLOW_GLOBAL_OPUS()) {
    if (out.router === "opus") throw new HttpError(403, "forcing opus is disabled (ALLOW_GLOBAL_OPUS)");
    if (out.tasks && Object.values(out.tasks).some((x) => x.model === "opus"))
      throw new HttpError(403, "opus per task is disabled (ALLOW_GLOBAL_OPUS)");
  }
  return out;
}

// dangerous = requires explicit confirm:true (UI safeguard; real safeguard = clamps/env-gate above)
function isDangerous(patch: Partial<FleetDesired>, current: FleetDesired): boolean {
  if (patch.mode === "stopped") return true;
  if (patch.router === "opus") return true;
  if (patch.effort === "xhigh" || patch.effort === "max") return true;
  if (
    patch.tasks &&
    Object.values(patch.tasks).some(
      (x) => x.model === "opus" || x.effort === "xhigh" || x.effort === "max",
    )
  )
    return true;
  const curMW = current.max_workers ?? ENVI("MAX_WORKERS", 3);
  const curCap = current.max_pr_per_day ?? ENVI("MAX_PR_PER_DAY", 12);
  if (typeof patch.max_workers === "number" && patch.max_workers > curMW) return true;
  if (typeof patch.max_pr_per_day === "number" && patch.max_pr_per_day > curCap) return true;
  return false;
}

/** Write desired state with CAS on rev + clamp + confirm-gate. Returns the new rev. */
export function writeFleet(patch: FleetPatch, baseRev: number, confirm?: boolean): number {
  return withLock(() => {
    const current = readFleet();
    if (typeof baseRev !== "number" || baseRev !== current.rev)
      throw new HttpError(409, `stale state (rev ${baseRev} ≠ ${current.rev}) — reload`);
    const clean = sanitizePatch(patch, current);
    if (isDangerous(clean, current) && confirm !== true)
      throw new HttpError(412, "confirmation required for this action");
    const next: FleetDesired = {
      ...current,
      ...clean,
      rev: current.rev + 1,
      updated_at: new Date().toISOString(),
      schema: 1,
    };
    atomicWriteSync(F_FLEET(), JSON.stringify(next, null, 2));
    return next.rev;
  });
}

/** Append an imperative one-shot command (kill/cancel/breaker-reset) in a single syscall. */
export function appendCommand(c: FleetCommand): string {
  if (!["kill", "cancel", "breaker-reset"].includes(c.cmd))
    throw new HttpError(400, "unknown command");
  const line: Record<string, unknown> = {
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    cmd: c.cmd,
  };
  if (c.cmd === "kill" || c.cmd === "cancel") {
    const issue = Math.trunc(Number(c.issue));
    if (!Number.isInteger(issue) || issue < 1 || issue > ISSUE_MAX)
      throw new HttpError(400, "valid issue number required");
    line.issue = issue;
    if (c.slot !== undefined) {
      const slot = Math.trunc(Number(c.slot));
      if (Number.isInteger(slot) && slot >= 0 && slot <= 999) line.slot = slot; // hint at most
    }
  }
  if (typeof c.reason === "string" && c.reason) line.reason = c.reason.slice(0, 256);
  const buf = Buffer.from(JSON.stringify(line) + "\n", "utf8"); // <4KB, newline-terminated
  const fd = fs.openSync(F_CMDS(), "a", 0o600);
  try {
    fs.writeSync(fd, buf); // single write syscall
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.chmodSync(F_CMDS(), 0o600);
  } catch {}
  return line.id as string;
}

/** Move an issue to the front/back of the claim priority (server-side locked RMW; no client-rev). */
export function prioritizeIssue(issue: number, toFront = true): number {
  const i = Math.trunc(Number(issue));
  if (!Number.isInteger(i) || i < 1 || i > ISSUE_MAX) throw new HttpError(400, "invalid issue");
  return withLock(() => {
    const current = readFleet();
    const without = (current.priority || []).filter((n) => n !== i);
    const priority = (toFront ? [i, ...without] : [...without, i]).slice(0, 200);
    const next: FleetDesired = {
      ...current,
      priority,
      rev: current.rev + 1,
      updated_at: new Date().toISOString(),
      schema: 1,
    };
    atomicWriteSync(F_FLEET(), JSON.stringify(next, null, 2));
    return next.rev;
  });
}

// ── log-tail (secret redaction + path-assert + from-clamp + chunk-cap) ──
function redact(s: string): string {
  let r = s;
  r = r.replace(/sk-ant-[A-Za-z0-9_\-]{8,}/g, "«REDACTED-anthropic»");
  r = r.replace(/github_pat_[A-Za-z0-9_]{20,}/g, "«REDACTED-github-pat»");
  r = r.replace(/\bgh[opsu]_[A-Za-z0-9]{8,}\b/g, "«REDACTED-github»");
  r = r.replace(/eyJ[A-Za-z0-9_\-]{6,}\.[A-Za-z0-9_\-]{6,}\.[A-Za-z0-9_\-]{4,}/g, "«REDACTED-jwt»");
  r = r.replace(
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    "«REDACTED-private-key»",
  );
  r = r.replace(/^.*(TIKTOK_CLIENT_SECRET|SUPABASE_SERVICE_ROLE|service_role).*$/gm, "«REDACTED-line»");
  return r;
}

// Per-issue telemetry state (state/issue-<n>.json) — for seeding task conversations.
export function readIssueState(issue: number): Record<string, unknown> | null {
  try {
    const n = Math.trunc(issue);
    return JSON.parse(fs.readFileSync(path.join(fleetDir(), "state", `issue-${n}.json`), "utf8"));
  } catch {
    return null;
  }
}

// Last <maxBytes> of an issue's agent log, secret-redacted (for task-chat context).
export function agentLogTail(issue: number, maxBytes = 2000): string {
  try {
    const n = Math.trunc(issue);
    const file = path.resolve(LOGS(), `issue-${n}.agent.log`);
    if (!file.startsWith(path.resolve(LOGS()) + path.sep)) return "";
    const size = fs.statSync(file).size;
    const from = Math.max(0, size - maxBytes);
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(size - from);
      const read = fs.readSync(fd, buf, 0, size - from, from);
      return redact(buf.subarray(0, read).toString("utf8"));
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return "";
  }
}

export interface LogChunk {
  data: string;
  next: number;
  eof: boolean;
  size: number;
}

export function tailLog(issueRaw: unknown, fromRaw: unknown): LogChunk {
  const issue = Math.trunc(parseInt(String(issueRaw), 10));
  if (!Number.isInteger(issue) || issue < 1 || issue > ISSUE_MAX)
    throw new HttpError(400, "valid issue number required");
  // filename CONSTRUCTED from the integer; then assert it falls under logs/
  const file = path.resolve(LOGS(), `issue-${issue}.agent.log`);
  const base = path.resolve(LOGS()) + path.sep;
  if (!file.startsWith(base)) throw new HttpError(400, "invalid path");
  let size = 0;
  try {
    size = fs.statSync(file).size;
  } catch {
    return { data: "", next: 0, eof: true, size: 0 };
  }
  let from = Math.trunc(Number(fromRaw));
  if (!Number.isFinite(from) || from < 0) from = 0;
  if (from > size) from = size; // log rotated/smaller → from the end
  const want = Math.min(LOG_CHUNK_MAX(), size - from);
  if (want <= 0) return { data: "", next: size, eof: true, size };
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(want);
    const read = fs.readSync(fd, buf, 0, want, from);
    // Align the chunk boundary to the last newline (unless EOF), so a secret never
    // splits across two chunks and thereby evades the per-chunk regex redaction. A single line
    // longer than LOG_CHUNK_MAX (no newline) is, as a last resort, passed through anyway.
    let end = read;
    if (from + read < size) {
      const nl = buf.subarray(0, read).lastIndexOf(0x0a);
      if (nl >= 0) end = nl + 1;
    }
    const data = redact(buf.subarray(0, end).toString("utf8"));
    const next = from + end;
    return { data, next, eof: next >= size, size };
  } finally {
    fs.closeSync(fd);
  }
}
