// Run: node --test mission-control/lib/teams.test.ts
// Teams persistence: CAS, server-side referential integrity, reports_to DAG, the ALLOW_AUTO_MERGE gate,
// blocking_roles filtering, per-agent "only lower" budget, merge-upsert (partial-safe), ghost tolerance,
// and the config-driven recommend engine.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "teams-"));
fs.mkdirSync(path.join(TMP, "control"), { recursive: true });
process.env.FLEET_DIR = TMP;
process.env.ALLOW_AUTO_MERGE = "0";
// point the recommend engine at the real committed blueprint (resolved from mission-control cwd)
process.env.TEAM_RULES_DEFAULT_FILE = path.resolve(process.cwd(), "..", "deploy", "team-rules.default.json");

// seed a small agent registry (manager + frontend + qa; qa has a budget for the only-lower test)
fs.writeFileSync(
  path.join(TMP, "control", "agents.json"),
  JSON.stringify({
    schema: 1, rev: 0, updated_at: null,
    agents: [
      { id: "mgr", role: "manager", name: "Manager", enabled: true },
      { id: "fe", role: "frontend", name: "Frontend", enabled: true },
      { id: "qa", role: "qa", name: "QA", enabled: true, daily_token_budget: 1000 },
    ],
  }),
);

const { writeTeams, readTeams, normalizeTeam, httpStatusOf } = await import("./teams.ts");
const { buildRecommendedTeam } = await import("./team-rules.ts");
const { readAgents } = await import("./agents.ts");

const upsert = (t: object, rev: number, confirm?: boolean) => writeTeams({ upsert: t as never }, rev, confirm);
function statusOf(fn: () => void): number {
  try { fn(); return 0; } catch (e) { return httpStatusOf(e); }
}

test("normalize: defaults + non-manual mode forces required_reviews >= 1", () => {
  const t = normalizeTeam({ id: "t", approval_policy: { mode: "auto_below_risk", required_reviews: 0 } as never });
  assert.equal(t.approval_policy.mode, "auto_below_risk");
  assert.equal(t.approval_policy.required_reviews, 1); // 0 is bumped to 1 for non-manual (no zero-human auto-approve)
  assert.equal(t.enabled, true);
  assert.equal(t.approval_policy.auto_merge, false);
});

test("CAS: first write rev 0->1, stale baseRev -> 409", () => {
  const rev1 = upsert({ id: "alpha", name: "Alpha", members: ["mgr", "fe"], lead: "mgr" }, 0);
  assert.equal(rev1, 1);
  assert.equal(statusOf(() => upsert({ id: "alpha", name: "x" }, 0)), 409); // baseRev 0 != 1
});

test("referential integrity: unknown member / bad lead / dangling edge / bad routing -> 400", () => {
  const rev = readTeams().rev;
  assert.equal(statusOf(() => upsert({ id: "b1", members: ["ghostnew"] }, rev)), 400); // new member not in registry
  assert.equal(statusOf(() => upsert({ id: "b2", members: ["mgr"], lead: "fe" }, rev)), 400); // lead not a member
  assert.equal(statusOf(() => upsert({ id: "b3", members: ["mgr"], edges: [{ from: "mgr", to: "fe", kind: "reports_to" }] }, rev)), 400); // edge to non-member
  assert.equal(statusOf(() => upsert({ id: "b4", members: ["mgr"], routing_rules: [{ id: "r", assign_to: "nobody" }] }, rev)), 400); // unknown ref
  // a known ROLE is a valid routing target even if not a member id
  assert.equal(statusOf(() => upsert({ id: "b5", members: ["mgr"], routing_rules: [{ id: "r", assign_to: "frontend" }] }, rev)), 0);
});

test("reports_to cycle -> 400", () => {
  const rev = readTeams().rev;
  const code = statusOf(() => upsert({
    id: "cyc", members: ["mgr", "fe", "qa"],
    edges: [
      { from: "mgr", to: "fe", kind: "reports_to" },
      { from: "fe", to: "qa", kind: "reports_to" },
      { from: "qa", to: "mgr", kind: "reports_to" },
    ],
  }, rev));
  assert.equal(code, 400);
});

test("auto-merge gate: mode 'auto' / auto_merge -> 403 without ALLOW_AUTO_MERGE", () => {
  const rev = readTeams().rev;
  assert.equal(statusOf(() => upsert({ id: "am1", members: ["mgr"], lead: "mgr", approval_policy: { mode: "auto" } }, rev)), 403);
  assert.equal(statusOf(() => upsert({ id: "am2", members: ["mgr"], lead: "mgr", approval_policy: { auto_merge: true } }, rev)), 403);
});

test("blocking_roles filtered to member roles (not rejected); per-agent budget only lowers", () => {
  const rev = readTeams().rev;
  const r2 = upsert({
    id: "team2", members: ["mgr", "qa"], lead: "mgr",
    approval_policy: { mode: "manual", blocking_roles: ["security", "qa"] }, // security not a member role -> dropped
    budget_caps: { per_agent: { qa: { daily_token_budget: 5000 } } }, // qa registry budget is 1000 -> clamped down
  }, rev);
  const team = readTeams().teams.find((t) => t.id === "team2")!;
  assert.deepEqual(team.approval_policy.blocking_roles, ["qa"]);
  assert.equal(team.budget_caps.per_agent.qa.daily_token_budget, 1000); // only lowered, never raised
});

test("merge-upsert: a layout-only partial upsert preserves members + edges", () => {
  let rev = readTeams().rev;
  rev = upsert({ id: "keep", name: "Keep", members: ["mgr", "fe"], lead: "mgr", edges: [{ from: "fe", to: "mgr", kind: "reports_to" }] }, rev);
  rev = upsert({ id: "keep", layout: { mgr: { x: 10, y: 20 } } }, rev); // partial: only layout
  const team = readTeams().teams.find((t) => t.id === "keep")!;
  assert.deepEqual(team.members, ["mgr", "fe"]); // NOT wiped
  assert.equal(team.edges.length, 1);
  assert.deepEqual(team.layout.mgr, { x: 10, y: 20 });
});

test("ghost tolerance: a member whose agent is gone survives a later partial save", () => {
  let rev = readTeams().rev;
  rev = upsert({ id: "ghost", members: ["mgr", "qa"], lead: "mgr" }, rev);
  // simulate the qa agent being deleted from the registry
  fs.writeFileSync(path.join(TMP, "control", "agents.json"), JSON.stringify({
    schema: 1, rev: 0, updated_at: null,
    agents: [{ id: "mgr", role: "manager", name: "Manager", enabled: true }, { id: "fe", role: "frontend", name: "Frontend", enabled: true }],
  }));
  // a layout-only save must NOT 400 on the now-ghost qa member
  const code = statusOf(() => upsert({ id: "ghost", layout: { mgr: { x: 1, y: 2 } } }, rev));
  assert.equal(code, 0);
  assert.ok(readTeams().teams.find((t) => t.id === "ghost")!.members.includes("qa")); // preserved
  // restore registry for later tests
  fs.writeFileSync(path.join(TMP, "control", "agents.json"), JSON.stringify({
    schema: 1, rev: 0, updated_at: null,
    agents: [{ id: "mgr", role: "manager", name: "Manager", enabled: true }, { id: "fe", role: "frontend", name: "Frontend", enabled: true }, { id: "qa", role: "qa", name: "QA", enabled: true, daily_token_budget: 1000 }],
  }));
});

test("readTeams never throws on a corrupt file", () => {
  fs.writeFileSync(path.join(TMP, "control", "teams.json"), "{ not json");
  const f = readTeams();
  assert.ok(Array.isArray(f.teams)); // falls back, does not throw
});

test("ghost clone: save-as-template (NEW id) of a team containing a ghost member succeeds", () => {
  let rev = readTeams().rev;
  rev = upsert({ id: "src", members: ["mgr", "fe"], lead: "mgr" }, rev);
  // fe is referenced by team 'src' but gets deleted from the registry → ghost
  fs.writeFileSync(path.join(TMP, "control", "agents.json"), JSON.stringify({
    schema: 1, rev: 0, updated_at: null,
    agents: [{ id: "mgr", role: "manager", name: "Manager", enabled: true }, { id: "qa", role: "qa", name: "QA", enabled: true, daily_token_budget: 1000 }],
  }));
  // cloning to a NEW id with the same (ghost-containing) members must NOT 400 — fe is in the ghost universe
  assert.equal(statusOf(() => upsert({ id: "src-template", members: ["mgr", "fe"], lead: "mgr", is_template: true }, readTeams().rev)), 0);
  // but a brand-new, never-referenced id is still rejected
  assert.equal(statusOf(() => upsert({ id: "bad", members: ["totally-new"] }, readTeams().rev)), 400);
  // restore registry
  fs.writeFileSync(path.join(TMP, "control", "agents.json"), JSON.stringify({
    schema: 1, rev: 0, updated_at: null,
    agents: [{ id: "mgr", role: "manager", name: "Manager", enabled: true }, { id: "fe", role: "frontend", name: "Frontend", enabled: true }, { id: "qa", role: "qa", name: "QA", enabled: true, daily_token_budget: 1000 }],
  }));
});

test("per-agent budget override for a non-member is dropped server-side", () => {
  const rev = readTeams().rev;
  upsert({ id: "po", members: ["mgr"], lead: "mgr", budget_caps: { per_agent: { qa: { daily_token_budget: 100 } } } }, rev); // qa not a member
  const team = readTeams().teams.find((t) => t.id === "po")!;
  assert.equal(team.budget_caps.per_agent.qa, undefined); // orphan override removed
});

test("recommend: resolves roles -> agents, drops edges with an unresolved side, lists missingRoles", () => {
  const { draftTeam, missingRoles } = buildRecommendedTeam("saas_webapp", readAgents().agents);
  assert.deepEqual(draftTeam.members!.sort(), ["fe", "mgr", "qa"]); // only resolvable roles
  assert.equal(draftTeam.lead, "mgr");
  assert.ok(missingRoles.includes("backend") && missingRoles.includes("security"));
  // every edge endpoint is a resolved member
  for (const e of draftTeam.edges ?? []) {
    assert.ok(draftTeam.members!.includes(e.from) && draftTeam.members!.includes(e.to));
  }
});
