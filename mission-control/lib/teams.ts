// User-defined teams registry, co-located with the fleet at $FLEET_DIR/control/teams.json. Mirrors
// lib/agents.ts: file lock + CAS-on-rev + atomic 0600 write + clamp/enum/validate, plus cross-file
// referential integrity against the agent registry, a reports_to DAG check, and the ALLOW_AUTO_MERGE
// write-gate (parallel to ALLOW_GLOBAL_OPUS). ADDITIVE + INERT: no part of the issue→agent→PR flow reads
// this; a missing/corrupt teams.json falls back to the committed default (deploy/teams.default.json) and
// reads NEVER throw (missing agents survive as "ghost" members). Not importing "server-only" so the unit
// tests (teams.test.ts) run under node --test, exactly like agents.ts.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { readAgents } from "./agents.ts";
import { EDGE_KINDS } from "./types.ts";
import type {
  Agent, Team, TeamInput, TeamsFile, TeamEdge, EdgeKind,
  ApprovalPolicy, ApprovalMode, BudgetCaps, RoutingRule, ProjectType,
} from "./types";

// ── paths (same resolution as agents.ts / fleet.ts) ──
function fleetDir(): string {
  const env = process.env.FLEET_DIR;
  if (env && env.trim()) return env.trim();
  return path.resolve(process.cwd(), "..");
}
const CONTROL = () => path.join(fleetDir(), "control");
const F_TEAMS = () => path.join(CONTROL(), "teams.json");
const F_LOCK = () => path.join(CONTROL(), "teams.lock");
const F_DEFAULTS = () =>
  (process.env.TEAMS_DEFAULT_FILE && process.env.TEAMS_DEFAULT_FILE.trim()) ||
  path.join(fleetDir(), "deploy", "teams.default.json");

// ── server-side gates / hard caps (self-contained; mirror fleet.ts envs) ──
const ALLOW_AUTO_MERGE = () => (process.env.ALLOW_AUTO_MERGE ?? "0") === "1";
const HARD_MAX_WORKERS = () => {
  const v = parseInt(process.env.HARD_MAX_WORKERS ?? "", 10);
  return Number.isFinite(v) ? v : 8;
};
const HARD_MAX_PR_PER_DAY = () => {
  const v = parseInt(process.env.HARD_MAX_PR_PER_DAY ?? "", 10);
  return Number.isFinite(v) ? v : 50;
};

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

// ── shared validators (mirror agents.ts) ──
const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const clampInt = (v: unknown, lo: number, hi: number, dflt: number): number => {
  const n = typeof v === "number" ? Math.trunc(v) : NaN;
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
};
const strArr = (v: unknown, max = 50): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 200).slice(0, max)
    : [];
/** Path-traversal-safe: drop any segment with ".." or a leading "/". */
const pathArr = (v: unknown, max = 50): string[] =>
  strArr(v, max).filter((s) => !s.includes("..") && !s.startsWith("/"));
const uniq = (xs: string[]): string[] => [...new Set(xs)];

function atomicWriteSync(file: string, data: string) {
  const tmp = `${file}.tmp.${process.pid}.${crypto.randomBytes(4).toString("hex")}`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {}
}

// ── normalize ONE team: shape/clamp/enum only (NO registry cross-checks — those are in validateTeam) ──
function normApproval(v: unknown): ApprovalPolicy {
  const o = (v ?? {}) as Partial<ApprovalPolicy>;
  const mode: ApprovalMode = (["manual", "auto_below_risk", "auto"].includes(o.mode as string) ? o.mode : "manual") as ApprovalMode;
  // safety: any non-manual mode needs at least one human review (closes the "0 reviewers" auto-approve hole)
  const reviews = clampInt(o.required_reviews, mode === "manual" ? 0 : 1, 10, mode === "manual" ? 0 : 1);
  const risk = ["low", "medium"].includes(o.auto_approve_max_risk as string) ? (o.auto_approve_max_risk as "low" | "medium") : null;
  return {
    mode,
    auto_approve_max_risk: risk,
    blocking_roles: strArr(o.blocking_roles),
    required_reviews: reviews,
    auto_merge: o.auto_merge === true,
  };
}
function normBudget(v: unknown): BudgetCaps {
  const o = (v ?? {}) as Partial<BudgetCaps>;
  const per: BudgetCaps["per_agent"] = {};
  if (o.per_agent && typeof o.per_agent === "object") {
    for (const [id, ov] of Object.entries(o.per_agent)) {
      if (!SLUG.test(id)) continue;
      const b = (ov as { daily_token_budget?: number | null })?.daily_token_budget;
      per[id] = { daily_token_budget: b === null || b === undefined ? null : clampInt(b, 0, 1_000_000_000, 0) };
    }
  }
  return {
    daily_token_budget: o.daily_token_budget == null ? null : clampInt(o.daily_token_budget, 0, 1_000_000_000, 0),
    max_concurrency: o.max_concurrency == null ? null : clampInt(o.max_concurrency, 1, HARD_MAX_WORKERS(), 1),
    max_pr_per_day: o.max_pr_per_day == null ? null : clampInt(o.max_pr_per_day, 0, HARD_MAX_PR_PER_DAY(), 0),
    per_agent: per,
  };
}
function normRules(v: unknown): RoutingRule[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((r): r is Partial<RoutingRule> => !!r && typeof r === "object")
    .map((r) => {
      const m = (r.match ?? {}) as Partial<RoutingRule["match"]>;
      return {
        id: typeof r.id === "string" && SLUG.test(r.id) ? r.id : crypto.randomUUID().slice(0, 8),
        enabled: r.enabled !== false,
        priority: clampInt(r.priority, 0, 999, 100),
        match: { labels: strArr(m.labels), path_globs: pathArr(m.path_globs), repos: pathArr(m.repos) },
        assign_to: typeof r.assign_to === "string" ? r.assign_to.slice(0, 64) : "",
        fallback_to: typeof r.fallback_to === "string" && r.fallback_to ? r.fallback_to.slice(0, 64) : null,
      };
    })
    .slice(0, 100);
}
function normEdges(v: unknown, ts: string): TeamEdge[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: TeamEdge[] = [];
  for (const e of v as Partial<TeamEdge>[]) {
    if (!e || typeof e.from !== "string" || typeof e.to !== "string") continue;
    if (e.from === e.to || !EDGE_KINDS.includes(e.kind as EdgeKind)) continue;
    const key = `${e.from}|${e.to}|${e.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ from: e.from, to: e.to, kind: e.kind as EdgeKind });
    if (out.length >= 200) break;
  }
  void ts;
  return out;
}

export function normalizeTeam(input: TeamInput): Team {
  if (!input || typeof input.id !== "string" || !SLUG.test(input.id))
    throw new HttpError(400, "team id required (slug: letter/digit, then letters/digits/-/_)");
  const members = uniq(strArr(input.members)).slice(0, 50);
  const lead = typeof input.lead === "string" && input.lead ? input.lead : null;
  const scope = (input.project_scope ?? {}) as { repos?: unknown; paths?: unknown };
  const layout: Team["layout"] = {};
  if (input.layout && typeof input.layout === "object") {
    for (const [id, p] of Object.entries(input.layout)) {
      const pt = p as { x?: unknown; y?: unknown };
      if (typeof pt?.x === "number" && typeof pt?.y === "number" && Number.isFinite(pt.x) && Number.isFinite(pt.y))
        layout[id] = { x: pt.x, y: pt.y };
    }
  }
  const now = new Date().toISOString();
  const ptypes: ProjectType[] = ["saas_webapp", "mobile_app", "excel_automation", "security_audit", "ui_redesign", "bugfix_sprint"];
  return {
    id: input.id,
    name: typeof input.name === "string" && input.name ? input.name.slice(0, 120) : input.id,
    description: typeof input.description === "string" ? input.description.slice(0, 2000) : "",
    enabled: input.enabled !== false,
    is_template: input.is_template === true,
    lead,
    members,
    project_scope: { repos: pathArr(scope.repos), paths: pathArr(scope.paths) },
    labels: strArr(input.labels),
    edges: normEdges(input.edges, now),
    routing_rules: normRules(input.routing_rules),
    approval_policy: normApproval(input.approval_policy),
    budget_caps: normBudget(input.budget_caps),
    layout,
    source_project_type: ptypes.includes(input.source_project_type as ProjectType) ? (input.source_project_type as ProjectType) : null,
    created_at: typeof input.created_at === "string" && input.created_at ? input.created_at : now,
    updated_at: now,
  };
}

// ── cross-file integrity + dangerous-setting gates (needs a fresh agent snapshot) ──
/** Validate (and lightly mutate) a normalized team against the registry. `prior` = the team's previous
 *  version (for ghost tolerance: members that were already present survive even if their agent is gone). */
function validateTeam(team: Team, prior: Team | null, agents: Agent[]): Team {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const knownRoles = new Set(agents.map((a) => a.role));
  const priorMembers = new Set(prior?.members ?? []);
  const memberSet = new Set(team.members);

  // (a) a NEWLY added member must exist in the registry; pre-existing members may be ghosts (tolerated)
  for (const m of team.members)
    if (!byId.has(m) && !priorMembers.has(m))
      throw new HttpError(400, `team ${team.id}: unknown agent '${m}'`);

  // (b) lead must be a member
  if (team.lead && !memberSet.has(team.lead))
    throw new HttpError(400, `team ${team.id}: lead '${team.lead}' is not a member`);

  // (c) edges must connect members
  for (const e of team.edges)
    if (!memberSet.has(e.from) || !memberSet.has(e.to))
      throw new HttpError(400, `team ${team.id}: edge ${e.from}→${e.to} references a non-member`);

  // (d) routing assign_to/fallback_to must be a member id OR a known role
  const refOk = (r: string) => memberSet.has(r) || knownRoles.has(r);
  for (const r of team.routing_rules) {
    if (r.assign_to && !refOk(r.assign_to))
      throw new HttpError(400, `team ${team.id}: routing rule ${r.id} assign_to '${r.assign_to}' is not a member or known role`);
    if (r.fallback_to && !refOk(r.fallback_to))
      throw new HttpError(400, `team ${team.id}: routing rule ${r.id} fallback_to '${r.fallback_to}' is not a member or known role`);
  }

  // (e) reports_to must be a DAG
  if (hasCycle(team.edges.filter((e) => e.kind === "reports_to")))
    throw new HttpError(400, `team ${team.id}: reports_to has a cycle`);

  // (f) blocking_roles → filter to roles actually present among members (don't 400)
  const memberRoles = new Set(team.members.map((m) => byId.get(m)?.role).filter((x): x is string => !!x));
  team.approval_policy.blocking_roles = uniq(team.approval_policy.blocking_roles.filter((role) => memberRoles.has(role)));

  // (g) per-agent budget: drop overrides for non-members; the rest may only LOWER the registry value
  for (const id of Object.keys(team.budget_caps.per_agent)) {
    if (!memberSet.has(id)) { delete team.budget_caps.per_agent[id]; continue; }
    const ov = team.budget_caps.per_agent[id];
    const agentBudget = byId.get(id)?.daily_token_budget;
    if (ov.daily_token_budget != null && typeof agentBudget === "number")
      ov.daily_token_budget = Math.min(ov.daily_token_budget, agentBudget);
  }

  // (h) AUTO-MERGE GATE — parallel to ALLOW_GLOBAL_OPUS. Fires when 'auto'/auto_merge is newly introduced
  // (prior is null/ghost-universe for a new id → an imported template can NEVER bypass it); benign edits
  // to an already-auto team still save.
  const priorAuto = prior?.approval_policy?.mode === "auto" || prior?.approval_policy?.auto_merge === true;
  const nowAuto = team.approval_policy.mode === "auto" || team.approval_policy.auto_merge;
  if (nowAuto && !priorAuto && !ALLOW_AUTO_MERGE())
    throw new HttpError(403, `team ${team.id}: auto-merge / approval mode 'auto' is disabled (ALLOW_AUTO_MERGE)`);

  return team;
}

function hasCycle(edges: TeamEdge[]): boolean {
  const adj = new Map<string, string[]>();
  for (const e of edges) (adj.get(e.from) ?? adj.set(e.from, []).get(e.from)!).push(e.to);
  const state = new Map<string, number>(); // 0=unvisited,1=in-stack,2=done
  const dfs = (n: string): boolean => {
    state.set(n, 1);
    for (const m of adj.get(n) ?? []) {
      const s = state.get(m) ?? 0;
      if (s === 1) return true;
      if (s === 0 && dfs(m)) return true;
    }
    state.set(n, 2);
    return false;
  };
  for (const n of adj.keys()) if ((state.get(n) ?? 0) === 0 && dfs(n)) return true;
  return false;
}

// ── defaults / reads (never throw) ──
function emptyFile(): TeamsFile {
  return { schema: 1, rev: 0, updated_at: null, teams: [] };
}
function coerceFile(d: unknown): TeamsFile {
  const o = (d ?? {}) as Partial<TeamsFile>;
  // tolerate ghosts: normalize shape but do NOT cross-check the registry on READ
  const teams = Array.isArray(o.teams) ? (o.teams as TeamInput[]).map((t) => safeNormalize(t)).filter((t): t is Team => !!t) : [];
  return {
    schema: 1,
    rev: typeof o.rev === "number" && o.rev >= 0 ? Math.trunc(o.rev) : 0,
    updated_at: typeof o.updated_at === "string" ? o.updated_at : null,
    teams,
  };
}
function safeNormalize(t: TeamInput): Team | null {
  try {
    return normalizeTeam(t);
  } catch {
    return null; // a single corrupt team is dropped; the rest survive
  }
}
export function defaultTeams(): TeamsFile {
  try {
    return coerceFile(JSON.parse(fs.readFileSync(F_DEFAULTS(), "utf8")));
  } catch {
    return emptyFile();
  }
}
export function readTeams(): TeamsFile {
  try {
    return coerceFile(JSON.parse(fs.readFileSync(F_TEAMS(), "utf8")));
  } catch {
    return defaultTeams();
  }
}

// ── lock (identical to agents.ts) ──
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
  if (!held) throw new HttpError(503, "teams registry busy (could not acquire lock)");
  try {
    return fn();
  } finally {
    try {
      fs.unlinkSync(lock);
    } catch {}
  }
}

export interface TeamsPatchInput {
  upsert?: TeamInput;
  remove?: string;
  teams?: TeamInput[];
}

/** Apply a patch to the current teams + validate against a fresh agent snapshot. Returns the new list. */
export function sanitizeTeamPatch(patch: TeamsPatchInput, current: TeamsFile, agents: Agent[], confirm?: boolean): Team[] {
  const priorById = new Map(current.teams.map((t) => [t.id, t]));
  // ghost universe: ids already referenced by ANY current team are tolerated on a clone/new-id upsert
  // (so "Save as template" of a team containing a deleted agent still saves); a genuinely new, unreferenced
  // id is not in here, so it still 400s if it isn't in the registry.
  const ghostUniverse = { members: [...new Set(current.teams.flatMap((t) => t.members))] } as Team;
  let list = current.teams.slice();

  if (patch.teams !== undefined) {
    if (!Array.isArray(patch.teams)) throw new HttpError(400, "teams must be a list");
    if (!confirm) throw new HttpError(400, "replacing the whole team list needs confirm:true");
    const seen = new Set<string>();
    list = patch.teams.map((t) => {
      const n = validateTeam(normalizeTeam(t), priorById.get(t.id) ?? ghostUniverse, agents);
      if (seen.has(n.id)) throw new HttpError(400, `duplicate team id: ${n.id}`);
      seen.add(n.id);
      return n;
    });
    if (list.length > 50) throw new HttpError(400, "too many teams (max 50)");
  }
  if (patch.upsert !== undefined) {
    if (typeof patch.upsert.id !== "string") throw new HttpError(400, "upsert.id required");
    const i = list.findIndex((t) => t.id === patch.upsert!.id);
    // MERGE over the existing team so a partial upsert ({id, layout} / {id, enabled}) never wipes the chart.
    const merged = (i >= 0 ? { ...list[i], ...patch.upsert } : patch.upsert) as TeamInput;
    const n = validateTeam(normalizeTeam(merged), i >= 0 ? list[i] : ghostUniverse, agents);
    if (i >= 0) list[i] = n;
    else list.push(n);
    if (list.length > 50) throw new HttpError(400, "too many teams (max 50)");
  }
  if (patch.remove !== undefined) {
    if (typeof patch.remove !== "string") throw new HttpError(400, "remove must be a team id");
    list = list.filter((t) => t.id !== patch.remove);
  }
  return list;
}

/** Write with CAS on rev. baseRev must equal the current rev or → 409. Returns the new rev. */
export function writeTeams(patch: TeamsPatchInput, baseRev: number, confirm?: boolean): number {
  return withLock(() => {
    const current = readTeams();
    if (typeof baseRev !== "number" || baseRev !== current.rev)
      throw new HttpError(409, `stale state (rev ${baseRev} ≠ ${current.rev}) — reload`);
    const agents = readAgents().agents; // fresh registry snapshot for cross-file checks
    const teams = sanitizeTeamPatch(patch, current, agents, confirm);
    const next: TeamsFile = { schema: 1, rev: current.rev + 1, updated_at: new Date().toISOString(), teams };
    atomicWriteSync(F_TEAMS(), JSON.stringify(next, null, 2));
    return next.rev;
  });
}

export function teamById(id: string): Team | null {
  return readTeams().teams.find((t) => t.id === id) ?? null;
}

/** The SAFEST enabled, non-template team the agent belongs to, so the permission layer applies the most
 *  restrictive approval policy when an agent is in several teams. Safer = manual < auto_below_risk < auto,
 *  and a team with blocking_roles is safer than one without. Reads only, never throws. */
export function teamForAgent(agentId: string): Team | null {
  const teams = readTeams().teams.filter((t) => t.enabled && !t.is_template && t.members.includes(agentId));
  if (teams.length === 0) return null;
  const modeRank: Record<string, number> = { manual: 0, auto_below_risk: 1, auto: 2 };
  const safety = (t: Team) => (modeRank[t.approval_policy.mode] ?? 0) * 2 - (t.approval_policy.blocking_roles.length ? 1 : 0); // lower = safer
  return teams.slice().sort((a, b) => safety(a) - safety(b))[0];
}
