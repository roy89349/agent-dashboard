// Run: node --test mission-control/lib/skills-view.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateSkillForAgent, highestSeverity, skillMatches, skillFacets } from "./skills-view.ts";
import type { Skill, Agent } from "./types";

const skill = (p: Partial<Skill>): Skill => ({
  id: "s", name: "S", description: "", category: "code", risk_level: "low", required_permissions: [],
  compatible_roles: [], allowed_tools: [], approval_required: false, config_schema: null, enabled: true, archived: false, created_at: "", updated_at: "", ...p,
});
const agent = (p: Partial<Agent>): Agent => ({
  id: "a", name: "A", role: "frontend", skills: [], skill_ids: [], enabled: true, model_default: "sonnet",
  effort_default: "medium", depth_default: "solo", autonomy: "review", system_prompt_ref: "", allowed_tools: [],
  green_cmd: null, review_of_roles: [], blocking: false, label_scope: [], max_concurrency: 1, daily_token_budget: null, credential_ref: null, ...p,
});

test("role incompatibility warns; empty compatible_roles = all roles", () => {
  const s = skill({ compatible_roles: ["backend", "data"] });
  assert.ok(evaluateSkillForAgent(s, agent({ role: "frontend" })).some((w) => w.kind === "role_incompatible"));
  assert.ok(!evaluateSkillForAgent(s, agent({ role: "backend" })).some((w) => w.kind === "role_incompatible"));
  assert.ok(!evaluateSkillForAgent(skill({ compatible_roles: [] }), agent({ role: "frontend" })).some((w) => w.kind === "role_incompatible"));
});

test("risk-vs-autonomy: high/critical skill on an autonomous agent warns (high when ungated)", () => {
  const high = skill({ risk_level: "high", approval_required: false });
  // review agent acts WITH per-PR approval → no risk_autonomy warning
  assert.ok(!evaluateSkillForAgent(high, agent({ autonomy: "review" })).some((w) => w.kind === "risk_autonomy"));
  // auto agent + ungated high skill → high-severity warning
  const wAuto = evaluateSkillForAgent(high, agent({ autonomy: "auto" })).find((w) => w.kind === "risk_autonomy");
  assert.equal(wAuto?.severity, "high");
  // gated high skill on auto agent → still flagged but milder (medium)
  const gated = skill({ risk_level: "high", approval_required: true });
  assert.equal(evaluateSkillForAgent(gated, agent({ autonomy: "auto" })).find((w) => w.kind === "risk_autonomy")?.severity, "medium");
  // critical + full is always high severity even if gated
  assert.equal(evaluateSkillForAgent(skill({ risk_level: "critical", approval_required: true }), agent({ autonomy: "full" })).find((w) => w.kind === "risk_autonomy")?.severity, "high");
});

test("approval + archived warnings; highestSeverity ignores info-level", () => {
  assert.ok(evaluateSkillForAgent(skill({ approval_required: true }), agent({})).some((w) => w.kind === "approval_required" && w.severity === "info"));
  assert.ok(evaluateSkillForAgent(skill({ archived: true }), agent({})).some((w) => w.kind === "disabled"));
  // an approval-required, role-fine skill yields no true-risk severity
  assert.equal(highestSeverity([skill({ approval_required: true })], agent({})), null);
  // a role-incompatible skill bubbles up medium
  assert.equal(highestSeverity([skill({ compatible_roles: ["backend"] })], agent({ role: "frontend" })), "medium");
});

test("filters: status default excludes archived; category/risk/role narrow; facets list present values", () => {
  const skills = [
    skill({ id: "a", category: "code", risk_level: "low", compatible_roles: ["frontend"] }),
    skill({ id: "b", category: "data", risk_level: "high", compatible_roles: ["backend"], approval_required: true }),
    skill({ id: "c", category: "code", risk_level: "critical", archived: true, approval_required: true }),
  ];
  assert.equal(skills.filter((s) => skillMatches(s, {})).length, 2); // archived excluded by default
  assert.equal(skills.filter((s) => skillMatches(s, { status: "archived" })).length, 1);
  assert.equal(skills.filter((s) => skillMatches(s, { status: "all" })).length, 3);
  assert.equal(skills.filter((s) => skillMatches(s, { category: "code" })).length, 1); // c is archived → excluded by default status
  assert.equal(skills.filter((s) => skillMatches(s, { role: "frontend" })).length, 1);
  const f = skillFacets(skills);
  assert.deepEqual(f.categories, ["code", "data"]);
  assert.deepEqual(f.risks, ["low", "high", "critical"]); // risk-ordered
  assert.ok(f.roles.includes("frontend") && f.roles.includes("backend"));
});
