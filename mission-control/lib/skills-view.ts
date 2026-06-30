// PURE evaluation + filtering for the Skill Library (no server imports → shared by the page + tests).
// A skill grants a CAPABILITY; whether an agent may USE it is governed by autonomy + the approval policy.
// evaluateSkillForAgent surfaces the risky combinations the goal asks us to warn about.
import type { Skill, Agent, SkillRisk, Autonomy } from "./types";

export type WarningKind = "role_incompatible" | "risk_autonomy" | "approval_required" | "disabled";
export type Severity = "high" | "medium" | "info";
export interface SkillWarning {
  kind: WarningKind;
  severity: Severity;
  message: string;
}

const RISK_RANK: Record<SkillRisk, number> = { low: 0, medium: 1, high: 2, critical: 3 };
const SEV_RANK: Record<Severity, number> = { info: 0, medium: 1, high: 2 };
const actsUnsupervised = (a: Autonomy) => a === "auto" || a === "full"; // acts without per-action human approval

/** Warnings for linking `skill` to `agent`: role fit, risk-vs-autonomy, approval, enabled/archived. */
export function evaluateSkillForAgent(skill: Skill, agent: Agent): SkillWarning[] {
  // an inert skill (archived/disabled) can't be used → no risk/role warnings, just an informational note
  if (skill.archived) return [{ kind: "disabled", severity: "info", message: "Skill is archived" }];
  if (!skill.enabled) return [{ kind: "disabled", severity: "info", message: "Skill is disabled" }];

  const w: SkillWarning[] = [];

  if (skill.compatible_roles.length > 0 && !skill.compatible_roles.includes(agent.role))
    w.push({ kind: "role_incompatible", severity: "medium", message: `Suited to ${skill.compatible_roles.join(", ")} — not "${agent.role}"` });

  if (RISK_RANK[skill.risk_level] >= RISK_RANK.high && actsUnsupervised(agent.autonomy)) {
    const gated = skill.approval_required;
    const critFull = skill.risk_level === "critical" && agent.autonomy === "full";
    w.push({
      kind: "risk_autonomy",
      severity: !gated || critFull ? "high" : "medium",
      message: `${skill.risk_level} skill on an autonomous (${agent.autonomy}) agent${gated ? " — approval-gated" : " WITHOUT an approval gate"}`,
    });
  }

  if (skill.approval_required) w.push({ kind: "approval_required", severity: "info", message: "Each use requires an approval" });

  return w;
}

/** The most severe warning across an agent's linked skills (for an at-a-glance badge). */
export function highestSeverity(skills: Skill[], agent: Agent): Severity | null {
  let top: Severity | null = null;
  for (const s of skills) {
    for (const wn of evaluateSkillForAgent(s, agent)) {
      if (wn.kind === "approval_required" || wn.kind === "disabled") continue; // only true risk warnings
      if (top === null || SEV_RANK[wn.severity] > SEV_RANK[top]) top = wn.severity;
    }
  }
  return top;
}

// ── filtering ──
export interface SkillFilter {
  category?: string | null;
  risk?: string | null;
  role?: string | null;
  status?: "enabled" | "archived" | "all" | null; // default view excludes archived
}

export function skillMatches(s: Skill, f: SkillFilter): boolean {
  if (f.category && s.category !== f.category) return false;
  if (f.risk && s.risk_level !== f.risk) return false;
  if (f.role && !(s.compatible_roles.length === 0 || s.compatible_roles.includes(f.role))) return false;
  const status = f.status ?? "enabled";
  if (status === "enabled" && (s.archived || !s.enabled)) return false;
  if (status === "archived" && !s.archived) return false;
  return true;
}

export interface SkillFacets {
  categories: string[];
  risks: string[];
  roles: string[];
}

export function skillFacets(skills: Skill[]): SkillFacets {
  const categories = new Set<string>();
  const risks = new Set<string>();
  const roles = new Set<string>();
  for (const s of skills) {
    if (s.category) categories.add(s.category);
    risks.add(s.risk_level);
    for (const r of s.compatible_roles) roles.add(r);
  }
  const RISK_ORDER: SkillRisk[] = ["low", "medium", "high", "critical"];
  return {
    categories: [...categories].sort(),
    risks: RISK_ORDER.filter((r) => risks.has(r)),
    roles: [...roles].sort(),
  };
}
