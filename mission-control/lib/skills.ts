// Skill Library registry, co-located with the fleet at $FLEET_DIR/control/skills.json. Mirrors lib/teams.ts
// / lib/agents.ts: file lock + CAS-on-rev + atomic 0600 write + clamp/enum/validate + merge-upsert + tolerant
// reads (one corrupt skill is dropped, never the whole file). ADDITIVE + INERT: a skill is a CAPABILITY, not
// a permission — nothing in the issue→agent→PR flow consumes skills yet. Dangerous skills (high/critical)
// default to approval_required so a future consumer routes their use through the durable-approvals system.
// Not importing "server-only" so skills.test.ts runs under node --test, like agents.ts/teams.ts.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { SKILL_RISKS } from "./types.ts";
import type { Skill, SkillInput, SkillsFile, SkillRisk } from "./types";

function fleetDir(): string {
  const env = process.env.FLEET_DIR;
  if (env && env.trim()) return env.trim();
  return path.resolve(process.cwd(), "..");
}
const CONTROL = () => path.join(fleetDir(), "control");
const F_SKILLS = () => path.join(CONTROL(), "skills.json");
const F_LOCK = () => path.join(CONTROL(), "skills.lock");
const F_DEFAULTS = () =>
  (process.env.SKILLS_DEFAULT_FILE && process.env.SKILLS_DEFAULT_FILE.trim()) ||
  path.join(fleetDir(), "deploy", "skills.default.json");

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

const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const strArr = (v: unknown, max = 50): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 200).slice(0, max)
    : [];

function atomicWriteSync(file: string, data: string) {
  const tmp = `${file}.tmp.${process.pid}.${crypto.randomBytes(4).toString("hex")}`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {}
}

export function normalizeSkill(input: SkillInput): Skill {
  if (!input || typeof input.id !== "string" || !SLUG.test(input.id))
    throw new HttpError(400, "skill id required (slug: letter/digit, then letters/digits/-/_)");
  const risk: SkillRisk = (SKILL_RISKS.includes(input.risk_level as SkillRisk) ? input.risk_level : "low") as SkillRisk;
  const schema = input.config_schema;
  const now = new Date().toISOString();
  return {
    id: input.id,
    name: typeof input.name === "string" && input.name ? input.name.slice(0, 120) : input.id,
    description: typeof input.description === "string" ? input.description.slice(0, 2000) : "",
    category: typeof input.category === "string" && input.category ? input.category.slice(0, 64) : "general",
    risk_level: risk,
    required_permissions: strArr(input.required_permissions),
    compatible_roles: strArr(input.compatible_roles),
    allowed_tools: strArr(input.allowed_tools),
    // dangerous skills default to approval-required (overridable); the UI warns on risky links either way
    approval_required: typeof input.approval_required === "boolean" ? input.approval_required : risk === "high" || risk === "critical",
    config_schema: schema && typeof schema === "object" && !Array.isArray(schema) ? (schema as Record<string, unknown>) : null,
    enabled: input.enabled !== false,
    archived: input.archived === true,
    created_at: typeof input.created_at === "string" && input.created_at ? input.created_at : now,
    updated_at: now,
  };
}

// ── defaults / reads (never throw) ──
function emptyFile(): SkillsFile {
  return { schema: 1, rev: 0, updated_at: null, skills: [] };
}
function safeNormalize(s: SkillInput): Skill | null {
  try {
    return normalizeSkill(s);
  } catch {
    return null;
  }
}
function coerceFile(d: unknown): SkillsFile {
  const o = (d ?? {}) as Partial<SkillsFile>;
  const skills = Array.isArray(o.skills) ? (o.skills as SkillInput[]).map(safeNormalize).filter((s): s is Skill => !!s) : [];
  return {
    schema: 1,
    rev: typeof o.rev === "number" && o.rev >= 0 ? Math.trunc(o.rev) : 0,
    updated_at: typeof o.updated_at === "string" ? o.updated_at : null,
    skills,
  };
}
export function defaultSkills(): SkillsFile {
  try {
    return coerceFile(JSON.parse(fs.readFileSync(F_DEFAULTS(), "utf8")));
  } catch {
    return emptyFile();
  }
}
export function readSkills(): SkillsFile {
  try {
    return coerceFile(JSON.parse(fs.readFileSync(F_SKILLS(), "utf8")));
  } catch {
    return defaultSkills();
  }
}

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
  if (!held) throw new HttpError(503, "skills registry busy (could not acquire lock)");
  try {
    return fn();
  } finally {
    try {
      fs.unlinkSync(lock);
    } catch {}
  }
}

export interface SkillsPatchInput {
  upsert?: SkillInput;
  remove?: string;
  skills?: SkillInput[];
}

export function sanitizeSkillPatch(patch: SkillsPatchInput, current: SkillsFile, confirm?: boolean): Skill[] {
  let list = current.skills.slice();
  if (patch.skills !== undefined) {
    if (!Array.isArray(patch.skills)) throw new HttpError(400, "skills must be a list");
    if (!confirm) throw new HttpError(400, "replacing the whole skill list needs confirm:true");
    const seen = new Set<string>();
    list = patch.skills.map((s) => {
      const n = normalizeSkill(s);
      if (seen.has(n.id)) throw new HttpError(400, `duplicate skill id: ${n.id}`);
      seen.add(n.id);
      return n;
    });
    if (list.length > 200) throw new HttpError(400, "too many skills (max 200)");
  }
  if (patch.upsert !== undefined) {
    if (typeof patch.upsert.id !== "string") throw new HttpError(400, "upsert.id required");
    const i = list.findIndex((s) => s.id === patch.upsert!.id);
    // MERGE over the existing skill so a partial upsert ({id, enabled} / {id, archived}) keeps the rest.
    const merged = (i >= 0 ? { ...list[i], ...patch.upsert } : patch.upsert) as SkillInput;
    const n = normalizeSkill(merged);
    if (i >= 0) list[i] = n;
    else list.push(n);
    if (list.length > 200) throw new HttpError(400, "too many skills (max 200)");
  }
  if (patch.remove !== undefined) {
    if (typeof patch.remove !== "string") throw new HttpError(400, "remove must be a skill id");
    list = list.filter((s) => s.id !== patch.remove);
  }
  return list;
}

export function writeSkills(patch: SkillsPatchInput, baseRev: number, confirm?: boolean): number {
  return withLock(() => {
    const current = readSkills();
    if (typeof baseRev !== "number" || baseRev !== current.rev)
      throw new HttpError(409, `stale state (rev ${baseRev} ≠ ${current.rev}) — reload`);
    const skills = sanitizeSkillPatch(patch, current, confirm);
    const next: SkillsFile = { schema: 1, rev: current.rev + 1, updated_at: new Date().toISOString(), skills };
    atomicWriteSync(F_SKILLS(), JSON.stringify(next, null, 2));
    return next.rev;
  });
}

export function skillById(id: string): Skill | null {
  return readSkills().skills.find((s) => s.id === id) ?? null;
}
