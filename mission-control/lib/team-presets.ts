// Config-driven agent TEMPLATES for "add agent from template" — generic role presets (no slipbase/owner
// logic, no secrets/credential_ref). Pure + client-safe. New agents created from a template default to
// enabled:false with empty label_scope (set in the dialog) so adding one can NEVER silently re-route the
// live fleet or disable the security gate until you explicitly configure + enable it.
import type { AgentModel, Effort, Depth, Autonomy } from "./types";

export interface AgentTemplate {
  role: string;
  name: string;
  description: string;
  skills: string[];
  model_default: AgentModel;
  effort_default: Effort;
  depth_default: Depth;
  autonomy: Autonomy;
  blocking: boolean;
  allowed_tools: string[];
  review_of_roles: string[];
}

const FULL = ["Read", "Grep", "Glob", "Edit", "Write", "Bash"];
const READ = ["Read", "Grep", "Glob"];

export const AGENT_TEMPLATES: AgentTemplate[] = [
  { role: "manager", name: "Manager", description: "Plans + coordinates the team; opens issues, never builds.", skills: ["planning", "coordination"], model_default: "sonnet", effort_default: "medium", depth_default: "orchestrate", autonomy: "suggest", blocking: false, allowed_tools: READ, review_of_roles: [] },
  { role: "frontend", name: "Frontend", description: "Builds UI / client code.", skills: ["react", "css", "ui"], model_default: "sonnet", effort_default: "medium", depth_default: "solo", autonomy: "review", blocking: false, allowed_tools: FULL, review_of_roles: [] },
  { role: "backend", name: "Backend", description: "Builds APIs, services, data access.", skills: ["api", "node", "db"], model_default: "sonnet", effort_default: "medium", depth_default: "solo", autonomy: "review", blocking: false, allowed_tools: FULL, review_of_roles: [] },
  { role: "qa", name: "QA", description: "Reviews PRs + writes tests. Advisory by default.", skills: ["testing", "review"], model_default: "sonnet", effort_default: "medium", depth_default: "solo", autonomy: "review", blocking: false, allowed_tools: FULL, review_of_roles: ["frontend", "backend"] },
  { role: "security", name: "Security", description: "Blocking security review of the staged diff.", skills: ["security", "owasp"], model_default: "sonnet", effort_default: "high", depth_default: "solo", autonomy: "suggest", blocking: true, allowed_tools: READ, review_of_roles: ["backend", "frontend"] },
  { role: "devops", name: "DevOps", description: "CI/CD, containers, deploys.", skills: ["ci", "docker", "deploy"], model_default: "sonnet", effort_default: "medium", depth_default: "solo", autonomy: "review", blocking: false, allowed_tools: FULL, review_of_roles: [] },
  { role: "documentation", name: "Docs", description: "Writes + maintains documentation.", skills: ["docs", "markdown"], model_default: "haiku", effort_default: "low", depth_default: "solo", autonomy: "suggest", blocking: false, allowed_tools: FULL, review_of_roles: [] },
  { role: "kpi", name: "KPI", description: "Metrics, analytics, dashboards.", skills: ["metrics", "analytics"], model_default: "haiku", effort_default: "low", depth_default: "solo", autonomy: "suggest", blocking: false, allowed_tools: READ, review_of_roles: [] },
  { role: "communication", name: "Communication", description: "Copy, outreach, release notes.", skills: ["copy", "outreach"], model_default: "haiku", effort_default: "low", depth_default: "solo", autonomy: "suggest", blocking: false, allowed_tools: READ, review_of_roles: [] },
  { role: "data", name: "Excel / Data", description: "Spreadsheets, data pipelines, ETL.", skills: ["excel", "data", "etl"], model_default: "sonnet", effort_default: "medium", depth_default: "solo", autonomy: "review", blocking: false, allowed_tools: FULL, review_of_roles: [] },
  { role: "designer", name: "Designer", description: "UX/UI design + hand-off.", skills: ["design", "ui", "ux"], model_default: "sonnet", effort_default: "medium", depth_default: "solo", autonomy: "suggest", blocking: false, allowed_tools: READ, review_of_roles: [] },
  { role: "architect", name: "Architect", description: "System design + technical direction.", skills: ["architecture", "planning"], model_default: "sonnet", effort_default: "high", depth_default: "orchestrate", autonomy: "suggest", blocking: false, allowed_tools: READ, review_of_roles: [] },
];

export function templateForRole(role: string): AgentTemplate | null {
  return AGENT_TEMPLATES.find((t) => t.role === role) ?? null;
}
