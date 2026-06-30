// Config-driven recommended-team engine. The 6 project-type blueprints live in JSON
// ($FLEET_DIR/deploy/team-rules.default.json, overridable by control/team-rules.json) — NO hardcoded
// project/owner logic here, only resolution. buildRecommendedTeam() turns a blueprint into a draft
// TeamInput by resolving each role to the first ENABLED registry agent, and reports any unresolved roles.
// Reads fs lazily (like agents.ts defaultAgents) so this stays node --test-friendly.
import fs from "node:fs";
import path from "node:path";
import type { Agent, TeamInput, TeamRule, TeamRulesFile, ProjectType, EdgeKind, ApprovalPolicy, BudgetCaps } from "./types";

const DEFAULT_APPROVAL: ApprovalPolicy = { mode: "manual", auto_approve_max_risk: null, blocking_roles: [], required_reviews: 0, auto_merge: false };
const DEFAULT_BUDGET: Omit<BudgetCaps, "per_agent"> = { daily_token_budget: null, max_concurrency: null, max_pr_per_day: null };

function fleetDir(): string {
  const env = process.env.FLEET_DIR;
  if (env && env.trim()) return env.trim();
  return path.resolve(process.cwd(), "..");
}
const F_RULES_DEFAULT = () =>
  (process.env.TEAM_RULES_DEFAULT_FILE && process.env.TEAM_RULES_DEFAULT_FILE.trim()) ||
  path.join(fleetDir(), "deploy", "team-rules.default.json");
const F_RULES_OVERRIDE = () => path.join(fleetDir(), "control", "team-rules.json");

/** Load the rule set: control/team-rules.json override wins, else the committed seed, else empty. */
export function readTeamRules(): TeamRulesFile {
  for (const f of [F_RULES_OVERRIDE(), F_RULES_DEFAULT()]) {
    try {
      const d = JSON.parse(fs.readFileSync(f, "utf8"));
      if (d && Array.isArray(d.rules)) return { schema: 1, rules: d.rules as TeamRule[] };
    } catch {
      /* try the next source */
    }
  }
  return { schema: 1, rules: [] };
}

export function ruleFor(projectType: ProjectType): TeamRule | null {
  return readTeamRules().rules.find((r) => r.project_type === projectType) ?? null;
}

/** Resolve a blueprint into an editable draft team (NOT persisted) + the roles with no enabled agent. */
export function buildRecommendedTeam(
  projectType: ProjectType,
  agents: Agent[],
): { draftTeam: TeamInput; missingRoles: string[] } {
  const base: TeamInput = { id: projectType.replace(/_/g, "-") };
  const rule = ruleFor(projectType);
  if (!rule) return { draftTeam: base, missingRoles: [] };

  const idForRole = new Map<string, string>();
  const missingRoles: string[] = [];
  for (const role of rule.roles) {
    const a = agents.find((x) => x.enabled && x.role === role) ?? null;
    if (a) idForRole.set(role, a.id);
    else if (!missingRoles.includes(role)) missingRoles.push(role);
  }

  const members = [...new Set(idForRole.values())];
  const lead = idForRole.get(rule.lead_role) ?? null;
  const edges = rule.edges
    .map((e) => {
      const from = idForRole.get(e.from_role);
      const to = idForRole.get(e.to_role);
      return from && to ? { from, to, kind: e.kind as EdgeKind } : null;
    })
    .filter((e): e is { from: string; to: string; kind: EdgeKind } => !!e);

  // merge the (possibly partial / hand-edited override) blueprint over complete defaults so the editable
  // draft always has well-formed policy + budget objects (the Approval/Budget tabs read them directly).
  const draftTeam: TeamInput = {
    id: base.id,
    name: rule.label,
    description: `Recommended ${rule.label} team`,
    enabled: true,
    is_template: false,
    lead,
    members,
    labels: rule.default_labels ?? [],
    edges,
    // blocking_roles for unresolved roles are filtered out server-side on save (validateTeam).
    approval_policy: { ...DEFAULT_APPROVAL, ...(rule.approval_policy ?? {}) },
    budget_caps: { ...DEFAULT_BUDGET, ...(rule.budget_caps ?? {}), per_agent: {} },
    source_project_type: projectType,
  };
  return { draftTeam, missingRoles };
}
