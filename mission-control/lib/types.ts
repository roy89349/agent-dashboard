// Mirror of the fleet telemetry (lib.sh emit -> state/issue-<n>.json).
// One-to-one with the fields the fleet writes out.
export type FleetState =
  | "claimed" | "building" | "security" | "gating" | "pr-open" | "reviewed" | "failed";

export type ReviewVerdict = "approve" | "caution" | "reject" | "reviewed";

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
