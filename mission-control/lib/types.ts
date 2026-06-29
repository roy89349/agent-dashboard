// Mirror of the fleet telemetry (lib.sh emit -> state/issue-<n>.json).
// One-to-one with the fields the fleet writes out.
export type FleetState =
  | "claimed" | "building" | "gating" | "pr-open" | "reviewed" | "failed";

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
    state === "gating" ||
    state === "claimed"
  )
    return "building";
  return "backlog";
}
