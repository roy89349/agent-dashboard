// "Build My Team for this project": rule-based (no LLM) project templates + a recommendation engine that turns a
// project type + wizard inputs into a full team proposal (agents · skills · workflows · autonomy · review rules ·
// budgets · approval/safety/phone settings), then persists a real team via the existing teams write path.
// Design: RULE-BASED now, but recommendTeamForProject is the single seam an LLM recommender can later replace.
// Invariants (validateTemplateRecommendation enforces them, defence-in-depth): NO auto-merge at high/critical risk,
// autonomy is capped by risk (never exceeds "review" at high risk), no hardcoded owner/project logic — everything
// resolves through the real agent/skill/workflow registries. Node-testable (no "server-only").
import { readAgents } from "./agents.ts";
import { skillById } from "./skills.ts";
import { getTemplate } from "./workflows.ts";
import { readTeams, writeTeams } from "./teams.ts";
import { recordAudit } from "./db.ts";
import type { Agent, TeamInput, TeamEdge, EdgeKind, ApprovalPolicy, BudgetCaps, Autonomy, ProjectType } from "./types";

export class ProjectTemplateError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export const ptStatusOf = (e: unknown): number => (e instanceof ProjectTemplateError ? e.status : 500);

export type ProjectTemplateId =
  | "saas_webapp" | "mobile_app" | "ai_automation" | "data_automation" | "bugfix_sprint" | "ui_redesign"
  | "security_audit" | "documentation_sprint" | "launch_prep" | "legacy_cleanup" | "performance_sprint" | "backend_api_sprint";

export type RiskLevel = "low" | "medium" | "high" | "critical";
export const RISK_ORDER: RiskLevel[] = ["low", "medium", "high", "critical"];
export type SpeedQuality = "speed" | "balanced" | "quality";
export type ReviewStrictness = "light" | "standard" | "strict";
export type UpdateFrequency = "off" | "daily" | "milestones" | "realtime";
export type SafetyMode = "standard" | "strict";

// One template blueprint. skills_by_role / autonomy_by_role use REAL skill ids + roles from the registries.
export interface ProjectTemplate {
  id: ProjectTemplateId;
  label: string;
  description: string;
  project_type: ProjectType | null; // maps to the existing 6-set for Team.source_project_type provenance (else null)
  lead_role: string;
  roles: string[]; // ordered; resolved to the first ENABLED registry agent for that role
  skills_by_role: Record<string, string[]>;
  workflow_template_ids: string[];
  autonomy_by_role: Record<string, Autonomy>;
  default_risk: RiskLevel;
  default_labels: string[];
  knowledge_hints: string[];
  phone_commands: string[];
  base_review: ReviewStrictness;
  safety_mode: SafetyMode;
  default_update: UpdateFrequency;
}

const REVIEWER_ROLES = new Set(["security", "qa", "architect"]);

// ── the 12 templates (rule data only; no owner/project names) ──
export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: "saas_webapp", label: "SaaS webapp", description: "Full-stack SaaS product team — build features end to end.",
    project_type: "saas_webapp", lead_role: "manager",
    roles: ["manager", "architect", "frontend", "backend", "qa", "security", "devops", "documentation"],
    skills_by_role: { manager: ["read-github-issue", "kpi-reporting"], architect: ["read-codebase", "review-pr"], frontend: ["read-codebase", "edit-code", "create-pr", "browser-review"], backend: ["read-codebase", "edit-code", "create-pr", "db-queries"], qa: ["run-tests", "review-pr", "browser-review"], security: ["security-audit", "review-pr"], devops: ["deploy-logs"], documentation: ["write-docs"] },
    workflow_template_ids: ["tpl_build_feature", "tpl_launch_saas"],
    autonomy_by_role: { manager: "review", architect: "review", frontend: "review", backend: "review", qa: "review", security: "review", devops: "review", documentation: "auto" },
    default_risk: "medium", default_labels: ["feature"], knowledge_hints: ["Product spec", "Architecture overview", "API reference"], phone_commands: ["status", "decisions", "summary"], base_review: "standard", safety_mode: "standard", default_update: "milestones",
  },
  {
    id: "mobile_app", label: "Mobile app", description: "Cross-platform mobile app team with design + delivery.",
    project_type: "mobile_app", lead_role: "manager",
    roles: ["manager", "designer", "frontend", "backend", "qa", "devops"],
    skills_by_role: { manager: ["read-github-issue", "kpi-reporting"], designer: ["browser-review"], frontend: ["read-codebase", "edit-code", "create-pr", "browser-review"], backend: ["read-codebase", "edit-code", "create-pr", "db-queries"], qa: ["run-tests", "browser-review", "review-pr"], devops: ["deploy-logs"] },
    workflow_template_ids: ["tpl_build_feature"],
    autonomy_by_role: { manager: "review", designer: "review", frontend: "review", backend: "review", qa: "review", devops: "review" },
    default_risk: "medium", default_labels: ["mobile"], knowledge_hints: ["Design system", "App store guidelines"], phone_commands: ["status", "decisions", "summary"], base_review: "standard", safety_mode: "standard", default_update: "milestones",
  },
  {
    id: "ai_automation", label: "AI automation", description: "AI/LLM automation pipeline — data + backend + guardrails.",
    project_type: null, lead_role: "manager",
    roles: ["manager", "architect", "backend", "data", "qa", "security"],
    skills_by_role: { manager: ["read-github-issue", "kpi-reporting"], architect: ["read-codebase", "review-pr"], backend: ["read-codebase", "edit-code", "create-pr", "db-queries"], data: ["excel-csv", "pdf-word", "db-queries"], qa: ["run-tests", "review-pr"], security: ["security-audit", "review-pr"] },
    workflow_template_ids: ["tpl_build_feature"],
    autonomy_by_role: { manager: "review", architect: "review", backend: "review", data: "review", qa: "review", security: "review" },
    default_risk: "high", default_labels: ["ai", "automation"], knowledge_hints: ["Model / prompt docs", "Data schema", "Eval criteria"], phone_commands: ["status", "decisions", "summary"], base_review: "strict", safety_mode: "strict", default_update: "milestones",
  },
  {
    id: "data_automation", label: "Data / Excel automation", description: "Spreadsheet & data pipeline automation team.",
    project_type: "excel_automation", lead_role: "manager",
    roles: ["manager", "data", "backend", "qa"],
    skills_by_role: { manager: ["read-github-issue"], data: ["excel-csv", "pdf-word", "db-queries", "edit-code"], backend: ["read-codebase", "edit-code", "db-queries"], qa: ["run-tests", "review-pr"] },
    workflow_template_ids: ["tpl_excel_automation"],
    autonomy_by_role: { manager: "review", data: "review", backend: "review", qa: "review" },
    default_risk: "medium", default_labels: ["data"], knowledge_hints: ["Data dictionary", "Source file samples"], phone_commands: ["status", "summary"], base_review: "standard", safety_mode: "standard", default_update: "milestones",
  },
  {
    id: "bugfix_sprint", label: "Bugfix sprint", description: "Fast triage-and-fix squad for a backlog of bugs.",
    project_type: "bugfix_sprint", lead_role: "manager",
    roles: ["manager", "backend", "frontend", "qa"],
    skills_by_role: { manager: ["read-github-issue"], backend: ["read-codebase", "edit-code", "create-pr"], frontend: ["read-codebase", "edit-code", "create-pr"], qa: ["run-tests", "review-pr"] },
    workflow_template_ids: ["tpl_fix_bug"],
    autonomy_by_role: { manager: "review", backend: "auto", frontend: "auto", qa: "review" },
    default_risk: "low", default_labels: ["bug"], knowledge_hints: ["Recent changelog", "Known-issues list"], phone_commands: ["status", "tasks"], base_review: "light", safety_mode: "standard", default_update: "daily",
  },
  {
    id: "ui_redesign", label: "UI redesign", description: "Design-led UI refresh with visual QA.",
    project_type: "ui_redesign", lead_role: "manager",
    roles: ["manager", "designer", "frontend", "qa"],
    skills_by_role: { manager: ["read-github-issue"], designer: ["browser-review"], frontend: ["read-codebase", "edit-code", "create-pr", "browser-review"], qa: ["browser-review", "review-pr"] },
    workflow_template_ids: ["tpl_improve_ui"],
    autonomy_by_role: { manager: "review", designer: "review", frontend: "review", qa: "review" },
    default_risk: "low", default_labels: ["ui", "design"], knowledge_hints: ["Design system", "Brand guidelines"], phone_commands: ["status", "summary"], base_review: "standard", safety_mode: "standard", default_update: "milestones",
  },
  {
    id: "security_audit", label: "Security audit", description: "Read-mostly security review with blocking sign-off.",
    project_type: "security_audit", lead_role: "manager",
    roles: ["manager", "security", "backend", "qa"],
    skills_by_role: { manager: ["read-github-issue"], security: ["security-audit", "review-pr", "read-codebase"], backend: ["read-codebase"], qa: ["run-tests", "review-pr"] },
    workflow_template_ids: ["tpl_audit_project"],
    autonomy_by_role: { manager: "review", security: "review", backend: "suggest", qa: "review" },
    default_risk: "high", default_labels: ["security"], knowledge_hints: ["Threat model", "Previous audit reports", "Compliance requirements"], phone_commands: ["status", "decisions", "summary"], base_review: "strict", safety_mode: "strict", default_update: "milestones",
  },
  {
    id: "documentation_sprint", label: "Documentation sprint", description: "Docs & user-facing content team.",
    project_type: null, lead_role: "manager",
    roles: ["manager", "documentation", "communication"],
    skills_by_role: { manager: ["read-github-issue"], documentation: ["write-docs", "read-codebase"], communication: ["write-docs", "user-communication"] },
    workflow_template_ids: ["tpl_build_feature"],
    autonomy_by_role: { manager: "review", documentation: "auto", communication: "review" },
    default_risk: "low", default_labels: ["docs"], knowledge_hints: ["Existing docs", "Style guide"], phone_commands: ["status", "summary"], base_review: "light", safety_mode: "standard", default_update: "daily",
  },
  {
    id: "launch_prep", label: "Launch preparation", description: "Release-readiness team — QA, security, ops, comms.",
    project_type: null, lead_role: "manager",
    roles: ["manager", "qa", "devops", "security", "communication", "kpi"],
    skills_by_role: { manager: ["read-github-issue", "kpi-reporting"], qa: ["run-tests", "browser-review", "review-pr"], devops: ["deploy-logs"], security: ["security-audit", "review-pr"], communication: ["user-communication"], kpi: ["kpi-reporting"] },
    workflow_template_ids: ["tpl_launch_saas"],
    autonomy_by_role: { manager: "review", qa: "review", devops: "review", security: "review", communication: "review", kpi: "auto" },
    default_risk: "high", default_labels: ["launch"], knowledge_hints: ["Launch checklist", "Runbook", "Rollback plan"], phone_commands: ["status", "decisions", "summary", "prs"], base_review: "strict", safety_mode: "strict", default_update: "realtime",
  },
  {
    id: "legacy_cleanup", label: "Legacy code cleanup", description: "Careful refactor of legacy code with regression guards.",
    project_type: null, lead_role: "manager",
    roles: ["manager", "architect", "backend", "qa"],
    skills_by_role: { manager: ["read-github-issue"], architect: ["read-codebase", "review-pr"], backend: ["read-codebase", "edit-code", "create-pr"], qa: ["run-tests", "review-pr"] },
    workflow_template_ids: ["tpl_fix_bug"],
    autonomy_by_role: { manager: "review", architect: "review", backend: "review", qa: "review" },
    default_risk: "high", default_labels: ["refactor", "tech-debt"], knowledge_hints: ["Architecture overview", "Test coverage report"], phone_commands: ["status", "decisions", "summary"], base_review: "strict", safety_mode: "strict", default_update: "milestones",
  },
  {
    id: "performance_sprint", label: "Performance sprint", description: "Latency & throughput optimisation squad.",
    project_type: null, lead_role: "manager",
    roles: ["manager", "backend", "frontend", "qa", "devops"],
    skills_by_role: { manager: ["read-github-issue", "kpi-reporting"], backend: ["read-codebase", "edit-code", "create-pr", "db-queries"], frontend: ["read-codebase", "edit-code", "create-pr", "browser-review"], qa: ["run-tests", "browser-review"], devops: ["deploy-logs"] },
    workflow_template_ids: ["tpl_build_feature"],
    autonomy_by_role: { manager: "review", backend: "review", frontend: "review", qa: "review", devops: "review" },
    default_risk: "medium", default_labels: ["performance"], knowledge_hints: ["Performance baselines", "Profiling reports"], phone_commands: ["status", "summary"], base_review: "standard", safety_mode: "standard", default_update: "milestones",
  },
  {
    id: "backend_api_sprint", label: "Backend / API sprint", description: "API & service build with schema + security review.",
    project_type: null, lead_role: "manager",
    roles: ["manager", "backend", "architect", "qa", "security"],
    skills_by_role: { manager: ["read-github-issue"], backend: ["read-codebase", "edit-code", "create-pr", "db-queries"], architect: ["read-codebase", "review-pr"], qa: ["run-tests", "review-pr"], security: ["security-audit", "review-pr"] },
    workflow_template_ids: ["tpl_build_feature"],
    autonomy_by_role: { manager: "review", backend: "review", architect: "review", qa: "review", security: "review" },
    default_risk: "medium", default_labels: ["api", "backend"], knowledge_hints: ["API spec", "DB schema"], phone_commands: ["status", "decisions", "summary"], base_review: "standard", safety_mode: "standard", default_update: "milestones",
  },
];
const TEMPLATE_BY_ID = new Map(PROJECT_TEMPLATES.map((t) => [t.id, t]));
export const getProjectTemplate = (id: string): ProjectTemplate | null => TEMPLATE_BY_ID.get(id as ProjectTemplateId) ?? null;
export const listProjectTemplates = (): Pick<ProjectTemplate, "id" | "label" | "description" | "default_risk" | "roles">[] =>
  PROJECT_TEMPLATES.map((t) => ({ id: t.id, label: t.label, description: t.description, default_risk: t.default_risk, roles: t.roles }));

// ── wizard input + recommendation output ──
export interface WizardInput {
  project_name: string;
  template_id: string;
  repo?: string | null;
  tech_stack?: string | null;
  goal?: string | null;
  risk_level?: RiskLevel;
  budget_tokens?: number | null;
  speed_vs_quality?: SpeedQuality;
  available_tools?: string[];
  auto_merge?: boolean;
  phone_updates?: boolean;
  review_strictness?: ReviewStrictness;
  knowledge_sources?: string[];
  preferred_workflow?: string | null;
}
export interface RoleRecommendation {
  role: string;
  agent_id: string | null;
  agent_name: string | null;
  autonomy: Autonomy;
  blocking: boolean;
  skills: { id: string; name: string }[];
}
export interface Recommendation {
  template: { id: ProjectTemplateId; label: string; description: string };
  project: { name: string; repo: string | null; tech_stack: string | null; goal: string | null };
  risk_level: RiskLevel;
  speed_vs_quality: SpeedQuality;
  lead_role: string;
  lead_agent_id: string | null;
  roles: RoleRecommendation[];
  missing_roles: string[];
  workflows: { id: string; name: string }[];
  review_rules: { strictness: ReviewStrictness; required_reviews: number; blocking_roles: string[] };
  approval_policy: ApprovalPolicy;
  auto_merge: boolean;
  budget: { daily_token_budget: number | null; per_agent_tokens: number; warning_pct: number; cheap_mode: boolean; high_effort_mode: boolean };
  update_frequency: UpdateFrequency;
  safety_mode: SafetyMode;
  knowledge_sources: string[];
  phone: { updates: boolean; commands: string[] };
  warnings: string[];
  draft_team: TeamInput;
}

// ── helpers ──
const riskAtLeast = (r: RiskLevel, min: RiskLevel) => RISK_ORDER.indexOf(r) >= RISK_ORDER.indexOf(min);
function slug(name: string, fallback: string): string {
  const base = String(name ?? "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  // a valid slug must start with an alnum; empty/symbol/emoji names get a unique fallback so they never collide
  return /^[a-z0-9]/.test(base) ? base : `${fallback}-${Math.random().toString(36).slice(2, 6)}`;
}
/** Cap an autonomy suggestion by risk + speed/quality — respects safety defaults; never exceeds ceiling. */
function capAutonomy(base: Autonomy, risk: RiskLevel, sq: SpeedQuality): Autonomy {
  const order: Autonomy[] = ["suggest", "review", "auto", "full"];
  let ceil: Autonomy = "full";
  if (riskAtLeast(risk, "high")) ceil = "review";       // high/critical → never above review
  else if (sq === "quality") ceil = "review";           // quality-first → cap at review
  else if (sq === "speed" && risk === "low") ceil = "auto"; // fast + low risk → allow auto
  const bi = order.indexOf(base), ci = order.indexOf(ceil);
  return order[Math.min(bi < 0 ? 1 : bi, ci)];
}
function reviewCountFor(s: ReviewStrictness): number { return s === "strict" ? 2 : 1; }

/** THE recommendation seam (rule-based today; swap for an LLM later). Pure aside from reading the registries. */
export function recommendTeamForProject(input: WizardInput): Recommendation {
  const tpl = getProjectTemplate(input.template_id);
  if (!tpl) throw new ProjectTemplateError(400, `unknown template: ${input.template_id}`);
  const agents: Agent[] = (() => { try { return readAgents().agents; } catch { return []; } })();
  const risk = input.risk_level ?? tpl.default_risk;
  const sq = input.speed_vs_quality ?? "balanced";
  const highRisk = riskAtLeast(risk, "high");
  const warnings: string[] = [];

  // resolve roles → enabled agents
  const idForRole = new Map<string, string>();
  const missing_roles: string[] = [];
  const roles: RoleRecommendation[] = tpl.roles.map((role) => {
    const a = agents.find((x) => x.enabled && x.role === role) ?? null;
    if (a) idForRole.set(role, a.id); else if (!missing_roles.includes(role)) missing_roles.push(role);
    const skillIds = tpl.skills_by_role[role] ?? [];
    const skills = skillIds.map((sid) => { const sk = skillById(sid); return { id: sid, name: sk?.name ?? sid }; });
    return { role, agent_id: a?.id ?? null, agent_name: a?.name ?? null, autonomy: capAutonomy(tpl.autonomy_by_role[role] ?? "review", risk, sq), blocking: REVIEWER_ROLES.has(role) && (role === "security" || risk !== "low"), skills };
  });
  if (missing_roles.length) warnings.push(`No enabled agent for: ${missing_roles.join(", ")} — add or enable one before creating.`);

  const members = [...new Set(idForRole.values())];
  const lead_agent_id = idForRole.get(tpl.lead_role) ?? null;

  // edges: everyone reports to the lead; reviewer roles review the builders
  const edges: TeamEdge[] = [];
  for (const [role, id] of idForRole) if (id !== lead_agent_id && lead_agent_id) edges.push({ from: id, to: lead_agent_id, kind: "reports_to" as EdgeKind });
  for (const rev of ["security", "qa", "architect"]) {
    const rid = idForRole.get(rev); if (!rid) continue;
    for (const b of ["frontend", "backend", "data"]) { const bid = idForRole.get(b); if (bid && bid !== rid) edges.push({ from: rid, to: bid, kind: "reviews" as EdgeKind }); }
  }

  // review rules
  const strictness: ReviewStrictness = input.review_strictness ?? (sq === "quality" || highRisk ? "strict" : sq === "speed" ? "light" : tpl.base_review);
  const memberRoles = new Set(roles.filter((r) => r.agent_id).map((r) => r.role));
  const blocking_roles = (strictness === "strict" ? ["security", "qa"] : ["security"]).filter((r) => memberRoles.has(r));
  const required_reviews = reviewCountFor(strictness);

  // approval policy — HARD RULE: no auto-merge at high/critical risk
  const autoMergeWanted = !!input.auto_merge;
  let approval_policy: ApprovalPolicy;
  let auto_merge = false;
  if (highRisk) {
    if (autoMergeWanted) warnings.push("Auto-merge requested but disabled: risk is high/critical (manual sign-off required).");
    approval_policy = { mode: "manual", auto_approve_max_risk: null, blocking_roles, required_reviews, auto_merge: false };
  } else if (autoMergeWanted) {
    auto_merge = risk === "low"; // self-merge only allowed at low risk (still env-gated by ALLOW_AUTO_MERGE)
    approval_policy = { mode: "auto_below_risk", auto_approve_max_risk: "low", blocking_roles, required_reviews: Math.max(1, required_reviews), auto_merge };
    if (!auto_merge) warnings.push("Auto-merge limited to auto-approving low-risk actions only (medium risk keeps human merge).");
  } else {
    approval_policy = { mode: "manual", auto_approve_max_risk: null, blocking_roles, required_reviews, auto_merge: false };
  }

  // budget (estimated tokens; scales with team size unless overridden)
  const daily_token_budget = input.budget_tokens != null && input.budget_tokens > 0 ? Math.trunc(input.budget_tokens) : Math.max(50_000, members.length * 50_000);
  const budget = { daily_token_budget, per_agent_tokens: 50_000, warning_pct: 80, cheap_mode: sq === "speed", high_effort_mode: sq === "quality" };

  // workflows (preferred overrides the template set), resolved to names best-effort
  const wfIds = input.preferred_workflow ? [input.preferred_workflow] : tpl.workflow_template_ids;
  const workflows = wfIds.map((id) => { let name = id; try { name = getTemplate(id)?.name ?? id; } catch { /* db not seeded */ } return { id, name }; });

  const update_frequency: UpdateFrequency = input.phone_updates === false ? "off" : input.phone_updates === true ? tpl.default_update : "off";
  const safety_mode: SafetyMode = highRisk ? "strict" : tpl.safety_mode;
  const knowledge_sources = (input.knowledge_sources && input.knowledge_sources.length ? input.knowledge_sources : tpl.knowledge_hints).map((s) => String(s).slice(0, 200)).slice(0, 20);

  const budget_caps: BudgetCaps = { daily_token_budget, max_concurrency: null, max_pr_per_day: highRisk ? 3 : null, per_agent: {} };
  const draft_team: TeamInput = {
    id: slug(input.project_name, tpl.id.replace(/_/g, "-")),
    name: input.project_name?.trim() || tpl.label,
    description: (input.goal?.trim() ? `${input.goal.trim()} — ` : "") + `${tpl.label} team`,
    enabled: true,
    is_template: false,
    lead: lead_agent_id,
    members,
    project_scope: { repos: input.repo?.trim() ? [input.repo.trim()] : [], paths: [] },
    labels: tpl.default_labels,
    edges,
    approval_policy,
    budget_caps,
    source_project_type: tpl.project_type,
  };

  return {
    template: { id: tpl.id, label: tpl.label, description: tpl.description },
    project: { name: input.project_name?.trim() || tpl.label, repo: input.repo?.trim() || null, tech_stack: input.tech_stack?.trim() || null, goal: input.goal?.trim() || null },
    risk_level: risk, speed_vs_quality: sq, lead_role: tpl.lead_role, lead_agent_id,
    roles, missing_roles, workflows,
    review_rules: { strictness, required_reviews, blocking_roles },
    approval_policy, auto_merge,
    budget, update_frequency, safety_mode, knowledge_sources,
    phone: { updates: update_frequency !== "off", commands: tpl.phone_commands },
    warnings, draft_team,
  };
}

// ── validation (defence-in-depth: enforced again on create, so hand-edits can't bypass safety) ──
export interface ValidationResult { ok: boolean; errors: string[]; warnings: string[] }
export function validateTemplateRecommendation(rec: Recommendation): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [...(rec.warnings ?? [])];
  const highRisk = riskAtLeast(rec.risk_level, "high");
  // authoritative over what ACTUALLY persists — validate the draft team's policy (a hand-edited draft can't bypass)
  const ap = rec.draft_team.approval_policy ?? rec.approval_policy;
  // HARD invariant — no auto-merge / auto-approve at high or critical risk
  if (highRisk && (ap.auto_merge || rec.auto_merge)) errors.push("auto-merge must be OFF at high/critical risk");
  if (highRisk && ap.mode !== "manual") errors.push("approval mode must be 'manual' at high/critical risk");
  if (ap.mode !== "manual" && ap.required_reviews < 1) errors.push("required_reviews must be ≥1 when approvals are not manual");
  if ((rec.budget.daily_token_budget ?? 0) < 0 || rec.budget.per_agent_tokens < 0) errors.push("budget cannot be negative");
  // autonomy must never exceed 'review' at high risk (safety default)
  for (const r of rec.roles) if (highRisk && (r.autonomy === "auto" || r.autonomy === "full")) errors.push(`autonomy for ${r.role} must not exceed 'review' at high/critical risk`);
  // the PERSISTED lead (draft_team.lead) must be a member — so dropping the lead in the wizard (lead→null) is fine
  const lead = rec.draft_team.lead ?? null;
  if (lead && !(rec.draft_team.members ?? []).includes(lead)) errors.push("lead must be a team member");
  if (!(rec.draft_team.members ?? []).length) errors.push("team has no resolvable members");
  if (rec.missing_roles.length) warnings.push(`${rec.missing_roles.length} role(s) unresolved: ${rec.missing_roles.join(", ")}`);
  // blocking_roles must be present among member roles
  const memberRoles = new Set(rec.roles.filter((x) => x.agent_id).map((x) => x.role));
  for (const b of rec.approval_policy.blocking_roles) if (!memberRoles.has(b)) warnings.push(`blocking role '${b}' has no member and will be dropped`);
  return { ok: errors.length === 0, errors, warnings };
}

// ── persist ──
export interface CreateResult { team_id: string; rev: number; applied: { members: number; is_template: boolean }; advisory: { safety_mode: SafetyMode; update_frequency: UpdateFrequency; phone_commands: string[]; knowledge_sources: string[]; skills_by_role: Record<string, string[]> } }
/** Persist the (possibly hand-edited) recommendation as a real team via the CAS-guarded teams write path. Non-
 *  destructive: it does NOT mutate the shared agent registry (per-agent skills/autonomy stay advisory) or global
 *  budget settings — those are returned as `advisory` for the UI to surface. */
export function createTeamFromRecommendation(rec: Recommendation, opts: { asTemplate?: boolean; overwrite?: boolean; actor?: string } = {}): CreateResult {
  const v = validateTemplateRecommendation(rec);
  if (!v.ok) throw new ProjectTemplateError(400, `invalid recommendation: ${v.errors.join("; ")}`);
  const teams = readTeams();
  const id = rec.draft_team.id;
  // never silently clobber an existing team — id collides ⇒ 409 (the user renames the project) unless overwrite is explicit
  if (teams.teams.some((t) => t.id === id) && !opts.overwrite) throw new ProjectTemplateError(409, `a team with id '${id}' already exists — pick a different project name`);
  // keep the persisted team self-consistent after any member edits: prune edges to surviving members, drop a non-member lead
  const members = new Set(rec.draft_team.members ?? []);
  const edges = (rec.draft_team.edges ?? []).filter((e) => members.has(e.from) && members.has(e.to));
  const lead = rec.draft_team.lead && members.has(rec.draft_team.lead) ? rec.draft_team.lead : null;
  const upsert: TeamInput = { ...rec.draft_team, lead, edges, is_template: !!opts.asTemplate };
  const rev = writeTeams({ upsert }, teams.rev);
  recordAudit({ actor: opts.actor ?? "roy", via: "dashboard", action: "team.create_from_template", detail: `${rec.template.id} → ${upsert.id}${opts.asTemplate ? " (template)" : ""}`.slice(0, 200) });
  return {
    team_id: upsert.id!, rev,
    applied: { members: (upsert.members ?? []).length, is_template: !!opts.asTemplate },
    advisory: { safety_mode: rec.safety_mode, update_frequency: rec.update_frequency, phone_commands: rec.phone.commands, knowledge_sources: rec.knowledge_sources, skills_by_role: Object.fromEntries(rec.roles.map((r) => [r.role, r.skills.map((s) => s.id)])) },
  };
}
