// Run: node --test --experimental-sqlite mission-control/lib/project-templates.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ptpl-"));
fs.mkdirSync(path.join(TMP, "data"), { recursive: true });
fs.mkdirSync(path.join(TMP, "control"), { recursive: true });
process.env.FLEET_DIR = TMP;
const ROLES = ["manager", "architect", "frontend", "backend", "qa", "security", "devops", "documentation", "kpi", "communication", "data", "designer"];
fs.writeFileSync(path.join(TMP, "control", "agents.json"), JSON.stringify({
  schema: 1, rev: 0, updated_at: null,
  agents: ROLES.map((r) => ({ id: r, role: r, name: r[0].toUpperCase() + r.slice(1), enabled: true, autonomy: "review", skill_ids: [] })),
}));

const P = await import("./project-templates.ts");

test("12 templates exist + lookup", () => {
  assert.equal(P.listProjectTemplates().length, 12);
  assert.ok(P.getProjectTemplate("saas_webapp"));
  assert.equal(P.getProjectTemplate("nope"), null);
});

test("every template recommends a valid, resolvable team", () => {
  for (const t of P.listProjectTemplates()) {
    const rec = P.recommendTeamForProject({ project_name: `Proj ${t.id}`, template_id: t.id });
    const v = P.validateTemplateRecommendation(rec);
    assert.ok(v.ok, `${t.id} should validate: ${v.errors.join("; ")}`);
    assert.ok((rec.draft_team.members ?? []).length >= 2, `${t.id} resolves members`);
    assert.equal(rec.draft_team.lead, rec.lead_agent_id);
    assert.ok(rec.workflows.length >= 1);
    assert.ok(rec.budget.daily_token_budget! > 0);
  }
});

test("recommendTeamForProject: unknown template → 400", () => {
  assert.throws(() => P.recommendTeamForProject({ project_name: "x", template_id: "bogus" }), (e) => P.ptStatusOf(e) === 400);
});

test("HARD RULE: no auto-merge at high/critical risk (even when requested)", () => {
  const rec = P.recommendTeamForProject({ project_name: "Audit", template_id: "security_audit", auto_merge: true }); // default risk high
  assert.equal(rec.risk_level, "high");
  assert.equal(rec.approval_policy.auto_merge, false);
  assert.equal(rec.auto_merge, false);
  assert.equal(rec.approval_policy.mode, "manual");
  assert.ok(rec.warnings.some((w) => /auto-merge/i.test(w)));
  // autonomy capped at review — no auto/full anywhere
  assert.ok(rec.roles.every((r) => r.autonomy !== "auto" && r.autonomy !== "full"), "no role exceeds review at high risk");
  assert.ok(P.validateTemplateRecommendation(rec).ok);
});

test("auto-merge allowed only at low risk; medium keeps human merge", () => {
  const low = P.recommendTeamForProject({ project_name: "Bugs", template_id: "bugfix_sprint", auto_merge: true }); // risk low
  assert.equal(low.risk_level, "low");
  assert.equal(low.auto_merge, true);
  assert.equal(low.approval_policy.mode, "auto_below_risk");
  const med = P.recommendTeamForProject({ project_name: "API", template_id: "backend_api_sprint", auto_merge: true }); // risk medium
  assert.equal(med.auto_merge, false);
  assert.equal(med.approval_policy.mode, "auto_below_risk");
});

test("speed vs quality shifts autonomy + review strictness", () => {
  const fast = P.recommendTeamForProject({ project_name: "Fast", template_id: "bugfix_sprint", speed_vs_quality: "speed" });
  assert.equal(fast.review_rules.strictness, "light");
  assert.ok(fast.roles.some((r) => r.autonomy === "auto"), "speed + low risk allows auto");
  const careful = P.recommendTeamForProject({ project_name: "Careful", template_id: "saas_webapp", speed_vs_quality: "quality" });
  assert.equal(careful.review_rules.strictness, "strict");
  assert.ok(careful.roles.every((r) => r.autonomy !== "auto" && r.autonomy !== "full"), "quality caps autonomy at review");
  assert.equal(careful.budget.high_effort_mode, true);
});

test("validateTemplateRecommendation rejects a tampered high-risk auto-merge", () => {
  const rec = P.recommendTeamForProject({ project_name: "Audit", template_id: "security_audit" });
  rec.approval_policy.auto_merge = true; // hand-edit attempt
  const v = P.validateTemplateRecommendation(rec);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /auto-merge/i.test(e)));
});

test("createTeamFromRecommendation persists a real team + honours is_template; rejects invalid", async () => {
  const rec = P.recommendTeamForProject({ project_name: "My SaaS", template_id: "saas_webapp", repo: "acme/app", goal: "Ship MVP" });
  const res = P.createTeamFromRecommendation(rec, { asTemplate: false });
  assert.ok(res.team_id && res.rev >= 1);
  assert.equal(res.applied.is_template, false);
  assert.ok(res.advisory.skills_by_role.frontend?.length >= 1, "per-agent skills returned as advisory");
  const { readTeams } = await import("./teams.ts");
  const saved = readTeams().teams.find((t) => t.id === res.team_id);
  assert.ok(saved, "team is persisted");
  assert.equal(saved.source_project_type, "saas_webapp");
  assert.deepEqual(saved.project_scope.repos, ["acme/app"]);
  // a tampered high-risk auto-merge must NOT persist
  const bad = P.recommendTeamForProject({ project_name: "Bad", template_id: "security_audit" });
  bad.approval_policy.auto_merge = true;
  assert.throws(() => P.createTeamFromRecommendation(bad), (e) => P.ptStatusOf(e) === 400);
});

test("id collision does NOT silently overwrite an existing team (409)", () => {
  const rec = P.recommendTeamForProject({ project_name: "Collide Me", template_id: "bugfix_sprint" });
  P.createTeamFromRecommendation(rec); // first create OK
  const again = P.recommendTeamForProject({ project_name: "Collide Me", template_id: "saas_webapp" }); // same slug
  assert.throws(() => P.createTeamFromRecommendation(again), (e) => P.ptStatusOf(e) === 409);
  // explicit overwrite is allowed
  assert.ok(P.createTeamFromRecommendation(again, { overwrite: true }).team_id);
});

test("dropping members prunes stale edges + reconciles the lead (persists cleanly)", async () => {
  const rec = P.recommendTeamForProject({ project_name: "Drop Test", template_id: "saas_webapp" });
  // simulate the wizard dropping the lead (manager) + backend: filter members, null the lead, keep STALE edges
  const keep = (rec.draft_team.members ?? []).filter((m) => m !== rec.lead_agent_id && m !== "backend");
  const tampered = { ...rec, draft_team: { ...rec.draft_team, members: keep, lead: null /* edges left stale on purpose */ } };
  const res = P.createTeamFromRecommendation(tampered);
  const { readTeams } = await import("./teams.ts");
  const saved = readTeams().teams.find((t) => t.id === res.team_id)!;
  assert.equal(saved.lead, null);
  assert.ok(saved.edges.every((e) => saved.members.includes(e.from) && saved.members.includes(e.to)), "no edge references a dropped member");
});

test("missing role surfaces a warning + missing_roles", () => {
  const agents = JSON.parse(fs.readFileSync(path.join(TMP, "control", "agents.json"), "utf8"));
  agents.agents.find((a) => a.id === "security").enabled = false; // disable security
  fs.writeFileSync(path.join(TMP, "control", "agents.json"), JSON.stringify(agents));
  const rec = P.recommendTeamForProject({ project_name: "Sec", template_id: "security_audit" });
  assert.ok(rec.missing_roles.includes("security"));
  assert.ok(rec.warnings.some((w) => /security/i.test(w)));
});
