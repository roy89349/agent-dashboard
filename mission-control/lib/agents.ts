// Config-driven agents registry, co-located with the fleet at $FLEET_DIR/control/agents.json.
// Mirrors mission-control/lib/fleet.ts: lock + CAS-on-rev + clamp/validate + opus-env-gate +
// atomic 0600 write. Additive — a missing control/agents.json falls back to the committed default
// team (deploy/agents.default.json), and nothing in the build flow consumes this yet.
//
// NB: server-side only (uses node:fs). We deliberately do NOT `import "server-only"` here so the
// unit tests (agents.test.ts) can import it under `node --test`; node:fs already makes this unusable
// in a client bundle.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Agent, AgentInput, AgentsFile, AgentModel, Effort, Depth, Autonomy } from "./types";

const MODELS = ["haiku", "sonnet", "opus"];
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const DEPTHS = ["solo", "orchestrate"];
const AUTONOMY = ["suggest", "review", "auto", "full"];

// ── paths (same resolution as fleet.ts) ──
function fleetDir(): string {
  const env = process.env.FLEET_DIR;
  if (env && env.trim()) return env.trim();
  return path.resolve(process.cwd(), ".."); // dashboard lives in $FLEET_DIR/mission-control
}
const CONTROL = () => path.join(fleetDir(), "control");
const F_AGENTS = () => path.join(CONTROL(), "agents.json");
const F_LOCK = () => path.join(CONTROL(), "agents.lock");
const F_DEFAULTS = () =>
  (process.env.AGENTS_DEFAULT_FILE && process.env.AGENTS_DEFAULT_FILE.trim()) ||
  path.join(fleetDir(), "deploy", "agents.default.json");

// ── server-side gates (mirror of config.env) ──
const ALLOW_GLOBAL_OPUS = () => (process.env.ALLOW_GLOBAL_OPUS ?? "0") === "1";
const ALLOW_AUTO_MERGE = () => (process.env.ALLOW_AUTO_MERGE ?? "0") === "1";
const HARD_MAX_CONCURRENCY = () => {
  const v = parseInt(process.env.HARD_MAX_WORKERS ?? "", 10);
  return Number.isFinite(v) ? v : 8;
};

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

// ── small validators ──
const clampInt = (v: unknown, lo: number, hi: number, dflt: number): number => {
  const n = typeof v === "number" ? Math.trunc(v) : NaN;
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
};
const strArr = (v: unknown, max = 50): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 200).slice(0, max)
    : [];

/** Normalize + validate ONE agent: fill defaults, clamp, enum-check. No opus-gate here (that is a
 *  write-time check in sanitizeAgentPatch, so stored/default agents may record opus as a preference
 *  while ALLOW_GLOBAL_OPUS still governs the actual run downstream). */
export function normalizeAgent(input: AgentInput): Agent {
  if (!input || typeof input.id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(input.id))
    throw new HttpError(400, "agent id required (slug: letter/digit, then letters/digits/-/_)");
  const role =
    typeof input.role === "string" && input.role.trim() ? input.role.trim().slice(0, 64) : "";
  if (!role) throw new HttpError(400, `agent ${input.id}: role required`);
  const model = (MODELS.includes(input.model_default as string) ? input.model_default : "sonnet") as AgentModel;
  const effort = (EFFORTS.includes(input.effort_default as string) ? input.effort_default : "medium") as Effort;
  const depth = (DEPTHS.includes(input.depth_default as string) ? input.depth_default : "solo") as Depth;
  const budget = input.daily_token_budget;
  return {
    id: input.id,
    name: typeof input.name === "string" && input.name ? input.name.slice(0, 120) : input.id,
    role,
    skills: strArr(input.skills),
    skill_ids: strArr(input.skill_ids), // linked Skill registry ids (additive; defaults to [])
    enabled: input.enabled !== false, // default ON
    model_default: model,
    effort_default: effort,
    depth_default: depth,
    autonomy: (AUTONOMY.includes(input.autonomy as string) ? input.autonomy : "review") as Autonomy,
    system_prompt_ref:
      typeof input.system_prompt_ref === "string" ? input.system_prompt_ref.slice(0, 256) : "",
    allowed_tools: strArr(input.allowed_tools),
    green_cmd: typeof input.green_cmd === "string" && input.green_cmd ? input.green_cmd.slice(0, 512) : null,
    review_of_roles: strArr(input.review_of_roles),
    blocking: input.blocking === true,
    label_scope: strArr(input.label_scope),
    max_concurrency: clampInt(input.max_concurrency, 1, HARD_MAX_CONCURRENCY(), 1),
    daily_token_budget:
      budget === null || budget === undefined ? null : clampInt(budget, 0, 1_000_000_000, 0),
    credential_ref:
      typeof input.credential_ref === "string" && input.credential_ref
        ? input.credential_ref.slice(0, 128)
        : null,
  };
}

// ── defaults / reads ──
function emptyFile(): AgentsFile {
  return { schema: 1, rev: 0, updated_at: null, agents: [] };
}
function safeNormalizeAgent(a: AgentInput): Agent | null {
  try {
    return normalizeAgent(a);
  } catch {
    return null; // one corrupt agent is dropped; the rest (and the rev) survive
  }
}
function coerceFile(d: unknown): AgentsFile {
  const o = (d ?? {}) as Partial<AgentsFile>;
  const agents = Array.isArray(o.agents) ? (o.agents as AgentInput[]).map(safeNormalizeAgent).filter((a): a is Agent => !!a) : [];
  return {
    schema: 1,
    rev: typeof o.rev === "number" && o.rev >= 0 ? Math.trunc(o.rev) : 0,
    updated_at: typeof o.updated_at === "string" ? o.updated_at : null,
    agents,
  };
}

/** The committed default team (deploy/agents.default.json). Missing/invalid seed → empty registry. */
export function defaultAgents(): AgentsFile {
  try {
    return coerceFile(JSON.parse(fs.readFileSync(F_DEFAULTS(), "utf8")));
  } catch {
    return emptyFile();
  }
}

/** Read the live registry. Missing/invalid control/agents.json → the committed default team
 *  (never throws → the existing flow is never broken by a bad/absent file). */
export function readAgents(): AgentsFile {
  try {
    return coerceFile(JSON.parse(fs.readFileSync(F_AGENTS(), "utf8")));
  } catch {
    return defaultAgents();
  }
}

// ── lock (exclusive, bounded retry + stale-break) — identical to fleet.ts ──
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
  if (!held) throw new HttpError(503, "agents registry busy (could not acquire lock)");
  try {
    return fn();
  } finally {
    try {
      fs.unlinkSync(lock);
    } catch {}
  }
}

export interface AgentsPatch {
  upsert?: AgentInput; // create or update one agent (by id)
  remove?: string; // remove one agent (by id)
  agents?: AgentInput[]; // replace the whole list (e.g. reorder / bulk edit)
}

/** Validate + apply a patch to the current agents and return the new list.
 *  Opus write-gate: model_default 'opus' is rejected (403) unless ALLOW_GLOBAL_OPUS=1 — exactly like
 *  the fleet.ts knob, applied to every agent that this patch creates or replaces. */
export function sanitizeAgentPatch(patch: AgentsPatch, current: AgentsFile): Agent[] {
  // Gate opus/full ONLY when the value is newly SET (vs the prior record) — re-saving an already-opus/full
  // agent (e.g. an inert skill_ids link) must not 403 on a field it isn't changing. Mirrors the route's
  // FLEET_FIELDS on-change check. A brand-new opus/full agent (no prior) is still blocked.
  const gate = (a: Agent, prior?: Agent): Agent => {
    if (a.model_default === "opus" && !ALLOW_GLOBAL_OPUS() && prior?.model_default !== "opus")
      throw new HttpError(403, `agent ${a.id}: model_default 'opus' is disabled (ALLOW_GLOBAL_OPUS)`);
    if (a.autonomy === "full" && !ALLOW_AUTO_MERGE() && prior?.autonomy !== "full")
      throw new HttpError(403, `agent ${a.id}: autonomy 'full' (self-merge) is disabled (ALLOW_AUTO_MERGE)`);
    return a;
  };
  let list = current.agents.slice();
  if (patch.agents !== undefined) {
    if (!Array.isArray(patch.agents)) throw new HttpError(400, "agents must be a list");
    const seen = new Set<string>();
    list = patch.agents.map((a) => {
      const n = gate(normalizeAgent(a), current.agents.find((x) => x.id === a.id));
      if (seen.has(n.id)) throw new HttpError(400, `duplicate agent id: ${n.id}`);
      seen.add(n.id);
      return n;
    });
    if (list.length > 200) throw new HttpError(400, "too many agents (max 200)");
  }
  if (patch.upsert !== undefined) {
    if (typeof patch.upsert.id !== "string") throw new HttpError(400, "upsert.id required");
    const i = list.findIndex((a) => a.id === patch.upsert!.id);
    // MERGE over the existing record so a partial upsert ({id, enabled} / {id, autonomy}) only changes
    // the named fields instead of resetting the agent to defaults. New id → normalize from defaults.
    const merged = (i >= 0 ? { ...list[i], ...patch.upsert } : patch.upsert) as AgentInput;
    const n = gate(normalizeAgent(merged), i >= 0 ? list[i] : undefined);
    if (i >= 0) list[i] = n;
    else list.push(n);
    if (list.length > 200) throw new HttpError(400, "too many agents (max 200)");
  }
  if (patch.remove !== undefined) {
    if (typeof patch.remove !== "string") throw new HttpError(400, "remove must be an agent id");
    list = list.filter((a) => a.id !== patch.remove);
  }
  return list;
}

/** Write the registry with CAS on rev. baseRev must equal the current rev or → 409. Returns new rev. */
export function writeAgents(patch: AgentsPatch, baseRev: number): number {
  return withLock(() => {
    const current = readAgents(); // falls back to defaults → first write seeds from the default team
    if (typeof baseRev !== "number" || baseRev !== current.rev)
      throw new HttpError(409, `stale state (rev ${baseRev} ≠ ${current.rev}) — reload`);
    const agents = sanitizeAgentPatch(patch, current);
    const next: AgentsFile = {
      schema: 1,
      rev: current.rev + 1,
      updated_at: new Date().toISOString(),
      agents,
    };
    atomicWriteSync(F_AGENTS(), JSON.stringify(next, null, 2));
    return next.rev;
  });
}

// ── read helpers (parallel to fleet_get / route_* in lib.sh, for the dashboard) ──
/** The first ENABLED agent with this role, or null. */
export function agentByRole(role: string): Agent | null {
  return readAgents().agents.find((a) => a.enabled && a.role === role) ?? null;
}
export function agentById(id: string): Agent | null {
  return readAgents().agents.find((a) => a.id === id) ?? null;
}
