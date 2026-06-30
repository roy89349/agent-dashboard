// Mirror of the fleet telemetry (lib.sh emit -> state/issue-<n>.json).
// One-to-one with the fields the fleet writes out.
export type FleetState =
  | "claimed" | "building" | "security" | "gating" | "pr-open" | "reviewed" | "failed";

export type ReviewVerdict = "approve" | "caution" | "reject" | "reviewed";

/** Coarse risk for a card/lane — derived from a pending approval (or null when unknown). */
export type RiskLevel = "high" | "medium" | "low" | "none";

/** One row in Supabase `fleet_tasks` (live layer). */
export interface FleetTask {
  issue: number;
  state: FleetState;
  title: string | null;
  branch: string | null;
  model: string | null;
  pr_url: string | null;
  review_verdict: ReviewVerdict | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  labels: string[];
  html_url: string;
  created_at: string;
  state: "open" | "closed";
}

export interface GitHubPull {
  number: number;
  issue: number | null;
  title: string;
  html_url: string;
  head: string;
  draft: boolean;
  created_at: string;
}

// ── control-plane (UI ⇄ fleet via $FLEET_DIR/control) ──
export type FleetMode = "running" | "paused" | "stopped";
export type RouterMode = "auto" | "sonnet" | "opus";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type Depth = "solo" | "orchestrate";
export type PauseReason = "paused" | "stopped" | "breaker" | "daycap" | "budget" | null;

/** Desired state as the UI writes it to control/fleet.json (null knob = config default). */
export interface FleetDesired {
  schema: number;
  rev: number;
  updated_at: string | null;
  mode: FleetMode;
  max_workers: number | null;
  max_pr_per_day: number | null;
  fail_break: number | null;
  router: RouterMode | null;
  effort: Effort | null;
  depth: Depth | null;
  review: "on" | "off" | null;
  priority: number[];
  tasks: Record<string, { model?: "sonnet" | "opus"; effort?: Effort; depth?: Depth }>;
}

/** One active worker slot in status.json (the "who-does-what" lane). */
export interface SlotStatus {
  slot: number | null;
  pid: number | null;
  issue: number | null;
  title: string | null;
  model: string | null;
  effort: string | null;
  depth: string | null;
  phase: FleetState | null;
  started_at: string | null;
  elapsed_s: number | null;
  phase_age_s: number | null;
  stale: boolean;
  log: string;
  // ── who-does-what (all optional; old status.json without these still renders) ──
  agent_id?: string | null; // registry agent slug responsible for this work
  agent_name?: string | null; // display name (e.g. "Frontend-agent")
  role?: string | null; // routed role (route_role: per-task > label_scope > default)
  team_id?: string | null; // derived from role (lib/team.ts)
  team_name?: string | null;
  current_phase?: FleetState | null; // alias of `phase`, set in readStatus for clarity
  risk_level?: RiskLevel | null; // from a pending approval for this issue, if any
  awaiting_approval?: boolean; // a pending approval is blocking/waiting on this issue
}

/** Live state the supervisor mirrors to control/status.json every tick. */
export interface FleetStatus {
  schema: number;
  supervisor_pid: number | null;
  heartbeat: string | null;
  mode: FleetMode;
  claiming: boolean;
  pause_reason: PauseReason;
  knobs: {
    max_workers: number | null;
    max_pr_per_day: number | null;
    fail_break: number | null;
    router: string | null;
    review: string | null;
    effort: string | null;
    depth: string | null;
  };
  breaker: { consecutive_fails: number; tripped: boolean };
  prs_today: number;
  attempts_today: number;
  applied_rev: number;
  slots: SlotStatus[];
  /** Computed by the server: is the supervisor still alive? (pid + fresh heartbeat) */
  online?: boolean;
}

export type FleetCommandName = "kill" | "cancel" | "breaker-reset";
export interface FleetCommand {
  cmd: FleetCommandName;
  issue?: number;
  slot?: number;
  reason?: string;
}

export type Column = "backlog" | "building" | "review" | "done";

/** One card on the board = GitHub issue enriched with live Supabase phase + PR. */
export interface BoardCard {
  issue: number;
  title: string;
  column: Column;
  labels: string[];
  issueUrl: string;
  state: FleetState | null;
  model: string | null;
  branch: string | null;
  prUrl: string | null;
  prNumber: number | null;
  reviewVerdict: ReviewVerdict | null;
  error: string | null;
  updatedAt: string;
  // ── who-does-what (optional; borrowed from the live slot / registry when available) ──
  role?: string | null;
  agentId?: string | null;
  agentName?: string | null;
  teamId?: string | null;
  teamName?: string | null;
  riskLevel?: RiskLevel | null;
  awaitingApproval?: boolean;
}

/** Map labels + live state to a column. The GitHub label is authoritative. */
export function deriveColumn(
  labels: string[],
  state: FleetState | null,
  hasOpenPr: boolean,
): Column {
  if (labels.includes("agent-done") || hasOpenPr || state === "pr-open" || state === "reviewed")
    return "review";
  if (labels.includes("agent-failed") || state === "failed") return "review";
  if (
    labels.includes("agent-wip") ||
    state === "building" ||
    state === "security" ||
    state === "gating" ||
    state === "claimed"
  )
    return "building";
  return "backlog";
}

// ── agents registry (control/agents.json — config-driven team identities) ──
// A worker is no longer an anonymous slot: it can run as a configured Agent with a role, skills,
// model/effort/depth defaults, tools, budget and review behaviour. Additive: nothing consumes the
// registry in the build flow yet, and a missing control/agents.json falls back to the committed
// default team (deploy/agents.default.json) — see mission-control/lib/agents.ts.

export type AgentModel = "haiku" | "sonnet" | "opus";

/** How much the agent may do on its own. DEFAULT "review" == today's issue→agent→PR behaviour.
 *  "full" (self-merge) is DANGEROUS and server-gated by ALLOW_AUTO_MERGE (like opus / ALLOW_GLOBAL_OPUS).
 *  v1 = a stored preference; no run-time consumer self-merges yet (a future consumer must re-check the gate). */
export type Autonomy = "suggest" | "review" | "auto" | "full";
export const AUTONOMY_LEVELS: Autonomy[] = ["suggest", "review", "auto", "full"];

/** Role is an OPEN string by design — the team is config-driven, never a hardcoded enum.
 *  Conventional default roles: manager · frontend · backend · qa · security · devops ·
 *  documentation · kpi · communication · data · designer · architect. */
export type AgentRole = string;

export interface Agent {
  id: string; // stable slug, unique within the registry
  name: string;
  role: AgentRole;
  skills: string[];
  enabled: boolean;
  model_default: AgentModel; // opus only honoured when ALLOW_GLOBAL_OPUS=1 (write-gated + downstream)
  effort_default: Effort;
  depth_default: Depth;
  autonomy: Autonomy; // "review" (default) = opens a PR for human approval; "full" gated by ALLOW_AUTO_MERGE
  system_prompt_ref: string; // path to a prompt template file (NOT an inline prompt)
  allowed_tools: string[]; // e.g. ["Read","Grep","Glob","Edit","Write","Bash"]
  green_cmd: string | null; // per-role override of GREEN_CMD; null = use the global one
  review_of_roles: string[]; // roles whose work this agent reviews
  blocking: boolean; // true = its reject blocks the PR; false = advisory
  label_scope: string[]; // issue labels this agent claims; empty = none (uses global LABEL_READY)
  max_concurrency: number;
  daily_token_budget: number | null; // null = fall back to the fleet-wide cap
  credential_ref: string | null; // future: a scoped credential NAME (never a secret value)
}

/** Partial agent as the UI submits it: id required, everything else optional → filled with defaults. */
export type AgentInput = Partial<Agent> & { id: string };

/** The registry file (control/agents.json), CAS-guarded by `rev` like control/fleet.json. */
export interface AgentsFile {
  schema: number;
  rev: number;
  updated_at: string | null;
  agents: Agent[];
}

// ── user-defined TEAMS (control/teams.json) — a visual overlay over the agent registry ──────────────
// Additive + INERT: nothing in the issue→agent→PR flow reads teams.json. It references agents only by id,
// adds an org-chart (edges), routing rules, an approval policy and budget caps — all validated SERVER-SIDE
// (lib/teams.ts). Reads never throw; missing agents render as "ghost" nodes. Distinct from lib/team.ts
// (the coarse Build/Platform/Command presentation grouping derived from a role).

export type EdgeKind = "reports_to" | "reviews" | "hands_off_to" | "asks";
export const EDGE_KINDS: EdgeKind[] = ["reports_to", "reviews", "hands_off_to", "asks"];

export type ProjectType =
  | "saas_webapp" | "mobile_app" | "excel_automation"
  | "security_audit" | "ui_redesign" | "bugfix_sprint";
export const PROJECT_TYPES: ProjectType[] = [
  "saas_webapp", "mobile_app", "excel_automation", "security_audit", "ui_redesign", "bugfix_sprint",
];

/** One directed connection on the org-chart. from/to are AGENT IDs that must be team members. */
export interface TeamEdge {
  from: string;
  to: string;
  kind: EdgeKind;
}

export type ApprovalMode = "manual" | "auto_below_risk" | "auto"; // "auto" gated by ALLOW_AUTO_MERGE

export interface ApprovalPolicy {
  mode: ApprovalMode; // "manual" (DEFAULT) = every PR needs a human
  auto_approve_max_risk: "low" | "medium" | null; // only meaningful when mode === "auto_below_risk"
  blocking_roles: string[]; // roles whose reject hard-blocks (filtered to roles present among members)
  required_reviews: number; // approvals before merge; forced ≥1 when mode !== "manual"
  auto_merge: boolean; // DANGEROUS self-merge — rejected unless ALLOW_AUTO_MERGE=1
}

export interface BudgetCaps {
  daily_token_budget: number | null; // team pool; null = inherit
  max_concurrency: number | null; // null = inherit; clamped 1..HARD_MAX_WORKERS
  max_pr_per_day: number | null; // null = inherit; clamped 0..HARD_MAX_PR_PER_DAY
  per_agent: Record<string, { daily_token_budget?: number | null }>; // overrides may only LOWER an agent's value
}

export interface RoutingRule {
  id: string; // slug, unique within the team
  enabled: boolean;
  priority: number; // lower evaluated first; clamp 0..999
  match: { labels: string[]; path_globs: string[]; repos: string[] }; // empty clause = match-all
  assign_to: string; // member agent id OR a role string (resolved via agentByRole)
  fallback_to: string | null; // used when assign_to is disabled/absent
}

export interface Team {
  id: string; // slug — same regex as Agent.id
  name: string;
  description: string;
  enabled: boolean;
  is_template: boolean; // "Save as template" → true; excluded from active routing
  lead: string | null; // agent id; must be in members (the Manager on top)
  members: string[]; // agent ids (includes lead); de-duped; each must exist in the registry
  project_scope: { repos: string[]; paths: string[] }; // "owner/repo" + path globs (path-traversal-safe)
  labels: string[]; // issue labels this team claims
  edges: TeamEdge[]; // org-chart connections (from/to are members)
  routing_rules: RoutingRule[];
  approval_policy: ApprovalPolicy;
  budget_caps: BudgetCaps;
  layout: Record<string, { x: number; y: number }>; // persisted canvas coords; empty = auto-layout
  source_project_type: ProjectType | null; // provenance when built via the rule engine
  created_at: string;
  updated_at: string;
}

/** Partial as the UI submits it (id required, rest merged over the existing record then defaulted). */
export type TeamInput = Partial<Team> & { id: string };

/** control/teams.json — CAS-guarded by rev, identical envelope to AgentsFile. */
export interface TeamsFile {
  schema: number;
  rev: number;
  updated_at: string | null;
  teams: Team[];
}

/** Patch verbs mirror AgentsPatch. upsert = MERGE over the existing record (partial-safe). */
export interface TeamsPatch {
  upsert?: TeamInput; // create/update one team by id (merge)
  remove?: string; // remove one team by id
  teams?: TeamInput[]; // replace the whole list — requires confirm:true
}

// ── recommended-team rule engine (deploy/team-rules.default.json → control/team-rules.json) ──
export interface TeamRule {
  project_type: ProjectType;
  label: string;
  lead_role: string; // resolved to an enabled agent via agentByRole
  roles: string[]; // ordered; each resolved to an enabled agent (else listed in missingRoles)
  edges: { from_role: string; to_role: string; kind: EdgeKind }[];
  default_labels: string[];
  approval_policy: ApprovalPolicy;
  budget_caps: Omit<BudgetCaps, "per_agent">;
  member_autonomy_hint?: Autonomy; // UI hint (still gated server-side)
}
export interface TeamRulesFile {
  schema: number;
  rules: TeamRule[];
}
