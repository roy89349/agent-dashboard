// CENTRAL server-side safety/permission layer. An action is allowed only if it fits the caller's autonomy
// level, granted skills, the action's detected risk, the team approval policy, and the hard env gates —
// deny-by-default, fail-closed, never weaker than the existing merge confirm-valve / ALLOW_GLOBAL_OPUS /
// ALLOW_AUTO_MERGE write-gates. The PURE core (evaluateAction/detectRisk/effectiveLevel) does NO I/O so the
// permission MATRIX is unit-testable; enforce() is the only side-effecting entry (createApproval + best-effort
// phone notify + recordAudit, blocking via a pending result). No "server-only" so node --test can import it.
import { agentById } from "./agents.ts";
import { teamById, teamForAgent } from "./teams.ts";
import { skillById } from "./skills.ts";
import { getWorkItem, listWorkItems } from "./work-items.ts";
import { createApproval, listPendingApprovals, type CreateApprovalInput, type ApprovalKind } from "./approvals.ts";
import { recordAudit } from "./db.ts";
import { redact } from "./redact.ts";
import type { Agent, Team, Skill, Autonomy } from "./types";

// ── autonomy ladder 0-5 ──
export type AutonomyLevel = 0 | 1 | 2 | 3 | 4 | 5;
// 0 read-only · 1 suggest · 2 branch changes · 3 PR creation · 4 auto-merge low-risk · 5 full + audit.
// Map the existing string enum onto the ladder. auto→3 (NOT 4): the system only gates `full` behind
// ALLOW_AUTO_MERGE and treats `auto` as "autonomous PR, never self-merge"; mapping auto→4 would be strictly
// MORE permissive than today. Levels 4/5 are emergent (a full agent clamped by a team auto_below_risk policy).
const BASE_LEVEL: Record<Autonomy, AutonomyLevel> = { suggest: 1, review: 3, auto: 3, full: 5 };

// ── risk ──
export type Risk = "low" | "medium" | "high" | "critical";
export const RISK_ORDER: Risk[] = ["low", "medium", "high", "critical"];
const rank = (r: Risk) => RISK_ORDER.indexOf(r);
export const maxRisk = (a: Risk, b: Risk): Risk => (rank(a) >= rank(b) ? a : b);

export type RiskCategory =
  | "delete_file" | "auth_security" | "secret_access" | "env_config" | "dependency"
  | "db_schema" | "billing_payment" | "github_workflow" | "deploy_merge" | "force_opus"
  | "cap_increase" | "fleet_mutation";

const CATEGORY_RISK: Record<RiskCategory, Risk> = {
  auth_security: "critical", secret_access: "critical", billing_payment: "critical", github_workflow: "critical",
  delete_file: "high", env_config: "high", dependency: "high", db_schema: "high", force_opus: "high",
  // a merge's real risk comes from its DIFF (file categories) + checks; the bare category is medium so a
  // diff-blind/clean merge isn't over-escalated (deploy sets high/critical via its own baseline)
  deploy_merge: "medium", cap_increase: "medium", fleet_mutation: "medium",
};

// Anchored path → category rules. Conservative: over-flag beats under-flag. Tuned to THIS repo's real auth
// (lib/session.ts, app/api/login, middleware/proxy, lib/permissions itself) + broad secret/workflow coverage.
const PATH_RULES: { re: RegExp; cat: RiskCategory }[] = [
  // auth / security (critical)
  { re: /(^|\/)lib\/(session|permissions|safety)\.ts$/i, cat: "auth_security" },
  { re: /(^|\/)(middleware|proxy)\.[tj]sx?$/i, cat: "auth_security" },
  { re: /(^|\/)app\/api\/login(\/|$)/i, cat: "auth_security" },
  { re: /(^|\/)o?auth\w*/i, cat: "auth_security" }, // auth/oauth/authn/authz/authentication/authorization/authProvider…
  { re: /(^|\/)[^/]*session[^/]*\.[tj]sx?$/i, cat: "auth_security" },
  // secrets (critical)
  { re: /(^|\/)\.env(\.[^/]*)?$/i, cat: "secret_access" },
  { re: /\.(pem|key|p12|pfx|jks|crt|cert)$/i, cat: "secret_access" },
  { re: /(^|\/)(id_rsa|id_ed25519|\.npmrc|\.netrc)$/i, cat: "secret_access" },
  { re: /(credential|secret|apikey|api[-_]key|token)/i, cat: "secret_access" },
  { re: /(^|\/)serviceaccount[^/]*\.json$/i, cat: "secret_access" },
  // env / config (high) — non-secret config
  { re: /(^|\/)config\.(env|js|ts|json|local\.env)$/i, cat: "env_config" },
  { re: /(^|\/)[^/]*\.config\.([cm]?[tj]s)$/i, cat: "env_config" }, // next.config.mjs/.cjs/.ts, eslint.config.mjs…
  // dependencies (high) — package.json carries scripts/postinstall ⇒ high, same band as lockfiles
  { re: /(^|\/)package\.json$/i, cat: "dependency" },
  { re: /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb)$/i, cat: "dependency" },
  { re: /(^|\/)(requirements\.txt|Gemfile(\.lock)?|go\.(mod|sum)|Cargo\.(toml|lock)|composer\.(json|lock))$/i, cat: "dependency" },
  // db schema (high)
  { re: /(^|\/)migrations?\//i, cat: "db_schema" },
  { re: /(^|\/)supabase\/migrations\//i, cat: "db_schema" },
  { re: /\.sql$/i, cat: "db_schema" },
  { re: /(^|\/)schema\.prisma$/i, cat: "db_schema" },
  // billing / payment (critical)
  { re: /(billing|payment|stripe|invoice|subscription|pricing|checkout)/i, cat: "billing_payment" },
  // github workflow / CI / governance (critical) — can exfiltrate secrets / self-merge / deploy
  { re: /(^|\/)\.github\//i, cat: "github_workflow" },
  { re: /(^|\/)(renovate\.json|\.renovaterc(\.json)?)$/i, cat: "github_workflow" },
];

const SECRET_KEY_RE = /(secret|token|key|password|passwd|credential|private|api[-_]?key|dsn|conn)/i;
export const isSecretKey = (k: string) => SECRET_KEY_RE.test(k);

export interface ChangedFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
}

function categoriesForPath(path: string): RiskCategory[] {
  const out: RiskCategory[] = [];
  for (const r of PATH_RULES) if (r.re.test(path)) out.push(r.cat);
  return out;
}

// ── actions ──
export type ActionType =
  | "read" | "modify_code" | "create_pr" | "merge" | "deploy" | "change_env"
  | "change_database" | "add_dependency" | "use_opus" | "notify_user" | "phone_command" | "create_approval";

export type Action =
  | { type: "read"; target?: string }
  | { type: "modify_code"; files: ChangedFile[] }
  | { type: "create_pr"; files?: ChangedFile[]; title?: string; issue?: number }
  | { type: "merge"; pr: number; files?: ChangedFile[]; checksPassed?: boolean }
  | { type: "deploy"; environment?: "preview" | "production"; target?: string }
  | { type: "change_env"; keys: string[]; files?: ChangedFile[] }
  | { type: "change_database"; statements?: string[]; files?: ChangedFile[] }
  | { type: "add_dependency"; deps: string[]; files?: ChangedFile[] }
  | { type: "use_opus"; scope?: "agent" | "task" | "global"; reason?: string }
  | { type: "notify_user"; channel?: "phone" | "dashboard" }
  | { type: "phone_command"; verb: string; mode?: string; mutates?: boolean; patch?: { max_workers?: number; max_pr_per_day?: number; router?: string }; issue?: number }
  | { type: "create_approval"; kind: ApprovalKind };

// minimum autonomy LEVEL an AGENT needs to even attempt the action (humans aren't level-gated)
const REQUIRED_LEVEL: Record<ActionType, AutonomyLevel> = {
  read: 0, notify_user: 0, create_approval: 0, use_opus: 0, phone_command: 0,
  modify_code: 2, add_dependency: 2,
  create_pr: 3, deploy: 3, change_env: 3, change_database: 3,
  merge: 4,
};

// fleet-mutating phone verbs + their risk (anything else mutating ⇒ high, fail-closed)
const PHONE_VERB_RISK: Record<string, Risk> = {
  fleet_mode: "medium", // refined below (stop ⇒ high)
  breaker_reset: "medium", cancel: "medium", priority: "low", continue: "medium",
  create_task: "low", free_text: "low",
};

/** PURE: detect the risk + categories of an action from its inputs. No I/O. Conservative. */
export function detectRisk(action: Action): { risk: Risk; categories: RiskCategory[] } {
  const cats = new Set<RiskCategory>();
  let risk: Risk = "low";

  const scanFiles = (files?: ChangedFile[]) => {
    for (const f of files ?? []) {
      for (const c of categoriesForPath(f.path)) cats.add(c);
      if (f.status === "deleted") {
        cats.add("delete_file");
        // deleting a sensitive file is worse than editing it
        for (const c of categoriesForPath(f.path)) if (CATEGORY_RISK[c] === "critical") risk = "critical";
      }
    }
  };

  switch (action.type) {
    case "read": case "notify_user": case "create_approval":
      break;
    case "modify_code": case "create_pr":
      scanFiles(action.files);
      risk = maxRisk(risk, action.type === "create_pr" ? "medium" : "low");
      break;
    case "merge":
      scanFiles(action.files);
      // a KNOWN benign diff is medium; an UNKNOWN diff (no files) is fail-closed HIGH so it can never sit
      // under a team's auto_below_risk(medium) ceiling — the agent path strips caller files (gateway), so an
      // agent merge is always diff-blind ⇒ high ⇒ approval until a server-resolved diff exists.
      risk = maxRisk(risk, action.files && action.files.length ? "medium" : "high");
      if (action.checksPassed === false) risk = maxRisk(risk, "high");
      cats.add("deploy_merge");
      break;
    case "deploy":
      cats.add("deploy_merge");
      risk = maxRisk(risk, action.environment === "production" ? "critical" : "high");
      break;
    case "change_env":
      cats.add("env_config");
      scanFiles(action.files);
      risk = maxRisk(risk, "high");
      if ((action.keys ?? []).some(isSecretKey)) { cats.add("secret_access"); risk = "critical"; }
      break;
    case "change_database":
      cats.add("db_schema");
      scanFiles(action.files);
      risk = maxRisk(risk, "high");
      break;
    case "add_dependency":
      cats.add("dependency");
      scanFiles(action.files);
      risk = maxRisk(risk, "high");
      break;
    case "use_opus":
      cats.add("force_opus");
      risk = maxRisk(risk, "high");
      break;
    case "phone_command": {
      cats.add("fleet_mutation");
      let vr = PHONE_VERB_RISK[action.verb] ?? (action.mutates ? "high" : "low"); // unknown mutating verb ⇒ high
      if (action.verb === "fleet_mode" && (action as { mode?: string }).mode === "stopped") vr = "high";
      if (action.patch && (action.patch.max_workers != null || action.patch.max_pr_per_day != null)) { cats.add("cap_increase"); vr = maxRisk(vr, "high"); }
      if (action.patch?.router === "opus") { cats.add("force_opus"); vr = maxRisk(vr, "high"); }
      risk = maxRisk(risk, vr);
      break;
    }
  }
  // fold in the worst category severity
  for (const c of cats) risk = maxRisk(risk, CATEGORY_RISK[c]);
  return { risk, categories: [...cats] };
}

// ── context ──
export interface EnvGates { allowGlobalOpus: boolean; allowAutoMerge: boolean; }
const env1 = (k: string) => (process.env[k] ?? "0") === "1";
function readGates(): EnvGates {
  return { allowGlobalOpus: env1("ALLOW_GLOBAL_OPUS"), allowAutoMerge: env1("ALLOW_AUTO_MERGE") };
}

export interface ResolvedContext {
  agent: Agent | null; // null ⇒ human/system caller
  team: Team | null;
  skills: Skill[]; // granted (enabled, !archived, role-compatible) skills of the agent
  gates: EnvGates;
  initiator: "agent" | "human" | "phone";
  trusted: boolean; // an authenticated human/operator session (NEVER true for an agent)
  confirmed: boolean; // the route's own confirm-valve already passed
  checksPassed?: boolean;
  mode?: string | null; // the work item's mode (plan_only | build_after_approval | autonomous_within_limits)
  via?: string;
  actor?: string;
}
export interface PermissionContext {
  agentId?: string | null;
  teamId?: string | null;
  workItemId?: string | null; // resolves the work item's mode (plan-only enforcement)
  mode?: string | null; // explicit mode (tests / pre-resolved callers)
  initiator?: "agent" | "human" | "phone";
  trusted?: boolean;
  confirmed?: boolean;
  checksPassed?: boolean;
  via?: string;
  actor?: string;
  snapshot?: ResolvedContext; // DI escape hatch (tests / pre-resolved callers)
  env?: EnvGates;
}

/** Only an agent's enabled, non-archived, role-compatible skills count (archived/incompatible ⇒ absent). */
export function grantedSkills(agent: Agent): Skill[] {
  const out: Skill[] = [];
  for (const id of agent.skill_ids ?? []) {
    const s = skillById(id);
    if (!s || !s.enabled || s.archived) continue;
    if (s.compatible_roles.length > 0 && !s.compatible_roles.includes(agent.role)) continue;
    out.push(s);
  }
  return out;
}

// A plan_only work item stops constraining its agent once it is closed out (done/cancelled/failed).
const PLAN_ONLY_TERMINAL = new Set(["done", "cancelled", "failed"]);
/** Fail-closed: does this agent still hold an OPEN plan_only work item? (any lookup error ⇒ assume yes). */
function agentHasActivePlanOnly(agentId: string): boolean {
  try {
    return listWorkItems({ assigned_agent_id: agentId }).some((w) => w.mode === "plan_only" && !PLAN_ONLY_TERMINAL.has(w.state));
  } catch { return true; }
}

export function resolveContext(c: PermissionContext): ResolvedContext {
  if (c.snapshot) return c.snapshot;
  const agent = c.agentId ? agentById(c.agentId) : null;
  // SECURITY: an AGENT may not name a foreign, more-permissive team (cross-team policy escalation). Honor a
  // caller-supplied teamId only if the agent is actually a member; otherwise the SAFEST of its own teams.
  // Only a human/system caller may name an arbitrary team.
  let team: Team | null;
  if (agent) {
    const named = c.teamId ? teamById(c.teamId) : null;
    team = named && named.members.includes(agent.id) ? named : teamForAgent(agent.id);
  } else {
    team = c.teamId ? teamById(c.teamId) : null;
  }
  const skills = agent ? grantedSkills(agent) : [];
  const initiator = c.initiator ?? (agent ? "agent" : "human");
  // SECURITY: an agent initiator can NEVER carry trust (no agent-supplied human ceiling bypass)
  const trusted = initiator === "agent" ? false : c.trusted ?? false;
  // The work item's MODE drives plan-only enforcement. SECURITY: an AGENT must not be able to escape plan-only
  // by omitting or swapping workItemId — the mode is bound to the agent's OWN assignment, resolved server-side
  // and fail-closed. Explicit c.mode wins (test snapshots / callers that already resolved it). For an agent, a
  // caller-supplied workItemId counts only if the agent actually OWNS that item; and as a fail-closed FLOOR, an
  // agent holding ANY still-open plan_only assignment is plan-gated no matter what id it supplied. A non-agent
  // caller just reads the named item's mode (humans aren't plan-gated anyway).
  let mode = c.mode ?? null;
  if (mode == null && agent) {
    const named = c.workItemId ? getWorkItem(c.workItemId) : null;
    const owned = named && named.assigned_agent_id === agent.id ? named : null;
    mode = owned?.mode ?? null;
    if (mode !== "plan_only" && agentHasActivePlanOnly(agent.id)) mode = "plan_only";
  } else if (mode == null) {
    mode = c.workItemId ? getWorkItem(c.workItemId)?.mode ?? null : null;
  }
  return {
    agent, team, skills, gates: c.env ?? readGates(),
    initiator, trusted, confirmed: c.confirmed ?? false, checksPassed: c.checksPassed, mode, via: c.via, actor: c.actor,
  };
}

// actions an agent may NOT take while the work item is in plan_only mode (read/plan/ask stay allowed)
const PLAN_ONLY_BLOCKED = new Set<ActionType>(["modify_code", "create_pr", "merge", "deploy", "change_env", "change_database", "add_dependency", "phone_command"]);

/** Effective autonomy ceiling after env + team clamps. Fail-closed (disabled/no agent ⇒ 0). */
export function effectiveLevel(ctx: ResolvedContext): AutonomyLevel {
  if (!ctx.agent) return ctx.trusted ? 5 : 0; // trusted human ⇒ ceiling 5; untrusted/system ⇒ read-only
  if (!ctx.agent.enabled) return 0;
  let lvl: AutonomyLevel = BASE_LEVEL[ctx.agent.autonomy] ?? 1;
  if (!ctx.gates.allowAutoMerge) lvl = Math.min(lvl, 3) as AutonomyLevel; // hard env ceiling: no self/auto-merge
  const p = ctx.team?.approval_policy;
  if (p) {
    if (p.mode === "manual" || p.blocking_roles.length) lvl = Math.min(lvl, 3) as AutonomyLevel;
  } else {
    lvl = Math.min(lvl, 3) as AutonomyLevel; // an agent with no team ⇒ treat as manual (no autonomous merge)
  }
  return lvl;
}

// actions that an AGENT must hold a granting skill for
const NEEDS_CAPABILITY = new Set<ActionType>(["modify_code", "create_pr", "merge", "deploy", "change_env", "change_database", "add_dependency"]);
const ACTION_SKILL_CATEGORIES: Partial<Record<ActionType, string[]>> = {
  modify_code: ["code"], create_pr: ["github", "code"], merge: ["github"], deploy: ["ops", "control"],
  change_env: ["ops", "code"], change_database: ["data"], add_dependency: ["code"],
};
function skillGrants(ctx: ResolvedContext, type: ActionType): boolean {
  const cats = ACTION_SKILL_CATEGORIES[type];
  if (!cats) return true;
  return ctx.skills.some((s) => cats.includes(s.category));
}
function skillForcesApproval(ctx: ResolvedContext, type: ActionType): boolean {
  const cats = ACTION_SKILL_CATEGORIES[type];
  return ctx.skills.some((s) => (cats ? cats.includes(s.category) : true) && (s.approval_required || s.risk_level === "high" || s.risk_level === "critical"));
}

export type Effect = "allow" | "deny" | "requires_approval";
export interface Decision {
  effect: Effect;
  reason: string;
  risk: Risk;
  categories: RiskCategory[];
  requiredLevel: AutonomyLevel;
  effectiveLevel: AutonomyLevel;
  auditAction: string;
  approvalKind?: ApprovalKind;
}

const APPROVAL_KIND_FOR: Partial<Record<ActionType, ApprovalKind>> = {
  merge: "merge", use_opus: "force_opus", deploy: "deploy", change_env: "secret_access",
  change_database: "risky_action", add_dependency: "risky_action", modify_code: "risky_action",
  create_pr: "risky_action", phone_command: "risky_action", create_approval: "risky_action",
  read: "risky_action", notify_user: "risky_action",
};
function approvalKindFor(action: Action, categories: RiskCategory[]): ApprovalKind {
  if (action.type === "phone_command") {
    if (categories.includes("cap_increase")) return "cap_increase";
    if (categories.includes("force_opus")) return "force_opus";
  }
  return APPROVAL_KIND_FOR[action.type] ?? "risky_action";
}

/** THE chokepoint. PURE + TOTAL given a context. Deny-by-default. Never weaker than the env/confirm gates. */
export function evaluateAction(action: Action, c: PermissionContext): Decision {
  const ctx = resolveContext(c);
  const { risk, categories } = detectRisk(action);
  const eff = effectiveLevel(ctx);
  const isHuman = ctx.initiator !== "agent";
  const required = REQUIRED_LEVEL[action.type] ?? 5;
  const base = { risk, categories, requiredLevel: required, effectiveLevel: eff, auditAction: `permission.${action.type}` };
  const deny = (reason: string): Decision => ({ ...base, effect: "deny", reason });
  const approve = (reason: string): Decision => ({ ...base, effect: "requires_approval", reason, approvalKind: approvalKindFor(action, categories) });
  const allow = (reason: string): Decision => ({ ...base, effect: "allow", reason });

  // 1. totality
  if (!(action.type in REQUIRED_LEVEL)) return deny("unknown action type");

  // 1b. PLAN-ONLY MODE — a hard, server-side gate: an AGENT on a plan_only work item may read/plan/ask, but
  //     NOT mutate anything (this cannot be approved away; the plan must be approved → build_after_approval first).
  if (!isHuman && ctx.mode === "plan_only" && PLAN_ONLY_BLOCKED.has(action.type))
    return deny("plan-only mode: read/plan only — no changes until the plan is approved");

  // 2. HARD ENV GATES (apply to everyone; cannot be approved away)
  if ((action.type === "use_opus" && (action.scope ?? "global") === "global") || categories.includes("force_opus")) {
    if (!ctx.gates.allowGlobalOpus) return deny("force_opus disabled (ALLOW_GLOBAL_OPUS)");
  }

  // 3. agent-only structural gates
  if (!isHuman) {
    if (!ctx.agent || !ctx.agent.enabled) return deny("agent disabled");
    if (eff < required) return deny(`autonomy ${eff} < required ${required} for ${action.type}`);
    if (NEEDS_CAPABILITY.has(action.type) && !skillGrants(ctx, action.type)) return deny(`no skill grants '${action.type}'`);
    // an agent merge always needs the auto-merge env gate (else it can only create a PR)
    if (action.type === "merge" && !ctx.gates.allowAutoMerge) return deny("agent merge needs ALLOW_AUTO_MERGE (open a PR instead)");
  }

  // 4. INVARIANT #7 — a trusted human who already passed the route's confirm-valve keeps today's one-click
  //    behaviour (no second durable approval), regardless of risk. Hard env gates above still applied.
  if (isHuman && ctx.trusted && ctx.confirmed) return allow("trusted human, confirmed at the route");

  // 5. risk / policy → approval
  const p = ctx.team?.approval_policy;
  // github_workflow / billing / auth / secrets are ALWAYS approval-gated regardless of team policy
  const alwaysApprove = categories.some((c) => c === "github_workflow" || c === "billing_payment" || c === "auth_security" || c === "secret_access");
  if (alwaysApprove) return approve(`${categories.join(",")} always needs approval`);

  if (!isHuman && skillForcesApproval(ctx, action.type)) return approve("a governing skill requires approval");

  if (p && p.mode === "auto_below_risk" && p.auto_approve_max_risk) {
    if (rank(risk) <= rank(p.auto_approve_max_risk)) return allow(`auto-approved (risk ${risk} ≤ ${p.auto_approve_max_risk})`);
    return approve(`risk ${risk} > team auto-approve ceiling ${p.auto_approve_max_risk}`);
  }

  if (rank(risk) >= rank("high")) return approve(`high/critical risk (${risk})`);
  if (action.type === "merge" || action.type === "deploy") return approve(`${action.type} needs approval`);

  return allow(`risk ${risk} within policy`);
}

// ── the 12 checker fns (thin wrappers over evaluateAction) ──
type Files = ChangedFile[] | string[] | undefined;
function norm(files: Files, deletes?: string[]): ChangedFile[] {
  const out: ChangedFile[] = [];
  for (const f of files ?? []) out.push(typeof f === "string" ? { path: f, status: "modified" } : f);
  for (const d of deletes ?? []) out.push({ path: d, status: "deleted" });
  return out;
}
export const canRead = (c: PermissionContext, target?: string) => evaluateAction({ type: "read", target }, c);
export const canModifyCode = (c: PermissionContext, files?: Files, deletes?: string[]) => evaluateAction({ type: "modify_code", files: norm(files, deletes) }, c);
export const canCreatePR = (c: PermissionContext, files?: Files) => evaluateAction({ type: "create_pr", files: norm(files) }, c);
export const canMerge = (c: PermissionContext, pr: number, files?: Files, checksPassed?: boolean) => evaluateAction({ type: "merge", pr, files: norm(files), checksPassed }, c);
export const canDeploy = (c: PermissionContext, environment?: "preview" | "production") => evaluateAction({ type: "deploy", environment }, c);
export const canChangeEnv = (c: PermissionContext, keys: string[]) => evaluateAction({ type: "change_env", keys }, c);
export const canChangeDatabase = (c: PermissionContext, statements?: string[]) => evaluateAction({ type: "change_database", statements }, c);
export const canAddDependency = (c: PermissionContext, deps: string[]) => evaluateAction({ type: "add_dependency", deps }, c);
export const canUseOpus = (c: PermissionContext, scope?: "agent" | "task" | "global") => evaluateAction({ type: "use_opus", scope }, c);
export const canNotifyUser = (c: PermissionContext, channel?: "phone" | "dashboard") => evaluateAction({ type: "notify_user", channel }, c);
export const canCreatePhoneCommand = (
  c: PermissionContext,
  verb: string,
  opts?: { mutates?: boolean; mode?: string; patch?: { max_workers?: number; max_pr_per_day?: number; router?: string }; issue?: number },
) => evaluateAction({ type: "phone_command", verb, mode: opts?.mode, mutates: opts?.mutates, patch: opts?.patch, issue: opts?.issue }, c);
export const canCreateApproval = (c: PermissionContext, kind: ApprovalKind) => evaluateAction({ type: "create_approval", kind }, c);

// ── enforce(): the only side-effecting entry. Audits, and on requires_approval creates (or reuses) a durable
//    approval + best-effort phone notify, BLOCKING the action (allowed:false). ──
export class PermissionError extends Error {
  status: number;
  decision: Decision;
  constructor(decision: Decision) {
    super(decision.reason);
    this.status = 403;
    this.decision = decision;
  }
}
export function permissionStatusOf(e: unknown): number {
  return e instanceof PermissionError ? e.status : 500;
}

export type EnforceResult =
  | { allowed: true; decision: Decision }
  | { allowed: false; decision: Decision; approvalId: string };

/** Build the action_json that runApprovalAction understands (only the kinds that have an executor). */
function toApprovalAction(action: Action): object {
  switch (action.type) {
    case "merge": return { type: "merge", pr: action.pr };
    case "use_opus": return { type: "force_opus" };
    case "phone_command":
      if (action.verb === "fleet_mode" && action.mode) return { type: "fleet_mode", mode: action.mode }; // approving a stop actually stops
      if (action.patch && (action.patch.max_workers != null || action.patch.max_pr_per_day != null))
        return { type: "cap_increase", max_workers: action.patch.max_workers, max_pr_per_day: action.patch.max_pr_per_day };
      if (action.patch?.router === "opus") return { type: "force_opus" };
      return { type: "noop" }; // sign-off only (no automated follow-through)
    default: return { type: "noop" }; // deploy/change_env/db/add_dependency are sign-off only until a gated executor exists
  }
}

function summarize(action: Action, decision: Decision, override?: string): string {
  if (override) return override;
  const t = action.type;
  if (action.type === "merge") return `Merge PR #${action.pr}`;
  if (action.type === "phone_command") return `Fleet command: ${action.verb}`;
  return `${t} (${decision.risk})`;
}

/** Reuse a live pending approval for the SAME concrete action by the SAME requester (createApproval has no
 *  native dedupe). Scoped to agent_id + the real action_json + pr so two different risky actions can NEVER
 *  collide (confused-deputy). The lossy "noop" sign-off bucket is never deduped (its payload is ambiguous). */
function findDuplicate(kind: ApprovalKind, actionJson: string, pr: number | null, agentId: string | null): string | null {
  if (actionJson === '{"type":"noop"}') return null;
  try {
    for (const a of listPendingApprovals())
      if (a.kind === kind && a.action_json === actionJson && (a.pr ?? null) === pr && (a.agent_id ?? null) === agentId) return a.id;
  } catch {
    /* store unavailable → no dedupe */
  }
  return null;
}

export interface EnforceOpts { summary?: string; advice?: string; notify?: boolean; }

export async function enforce(action: Action, c: PermissionContext, opts: EnforceOpts = {}): Promise<EnforceResult> {
  const decision = evaluateAction(action, c);
  const ctx = resolveContext(c);
  const auditBase = {
    actor: ctx.actor ?? ctx.agent?.id ?? "system",
    via: (ctx.via ?? ctx.initiator) as string,
    kind: action.type,
    issue: (action as { issue?: number }).issue ?? null,
  };
  const detail = (s: string) => redact(s).slice(0, 200);

  if (decision.effect === "deny") {
    recordAudit({ ...auditBase, action: "permission.denied", detail: detail(decision.reason), status: "denied", risk_level: decision.risk });
    throw new PermissionError(decision);
  }

  if (decision.effect === "requires_approval") {
    const kind = decision.approvalKind ?? "risky_action";
    const actionObj = toApprovalAction(action);
    const actionJson = JSON.stringify(actionObj);
    const pr = action.type === "merge" ? action.pr : null;
    let approvalId = findDuplicate(kind, actionJson, pr, ctx.agent?.id ?? null);
    if (!approvalId) {
      const input: CreateApprovalInput = {
        kind,
        summary: summarize(action, decision, opts.summary),
        risk: `${decision.risk}${decision.categories.length ? ` · ${decision.categories.join(",")}` : ""}`,
        advice: opts.advice,
        action: actionObj,
        agent_id: ctx.agent?.id ?? null,
        pr,
        issue: (action as { issue?: number }).issue ?? null,
      };
      const { approval } = createApproval(input);
      approvalId = approval.id;
      // best-effort phone notify (an outage must NOT open the gate — the approval is durably pending)
      if (opts.notify !== false) {
        try {
          const { getProvider, isPhoneConfigured } = await import("./phone/index.ts");
          if (isPhoneConfigured()) await getProvider()?.sendApprovalRequest(approval);
        } catch {
          /* swallow */
        }
      }
    }
    recordAudit({ ...auditBase, action: "permission.approval_required", approval_id: approvalId, detail: detail(`${decision.reason} → ${kind}`), status: "pending_approval", risk_level: decision.risk });
    return { allowed: false, decision, approvalId };
  }

  // allow — risky allows are audited as approved-risky; trivial low-risk reads are skipped to reduce noise
  if (!(action.type === "read" && decision.risk === "low"))
    recordAudit({ ...auditBase, action: rank(decision.risk) >= rank("high") ? "permission.approved_risky" : "permission.allowed", detail: detail(`${decision.reason}; risk=${decision.risk}`), status: "allowed", risk_level: decision.risk });
  return { allowed: true, decision };
}
