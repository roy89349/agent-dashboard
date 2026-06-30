// Run: node --test mission-control/lib/agent-view.test.ts
// Covers the who-does-what layer: role→team derivation, slot/card normalization (incl. OLD data with no
// metadata — backward compatibility), and the filter / facet / group helpers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { teamForRole, roleTone, initials, TEAMS } from "./team.ts";
import { slotMeta, cardMeta, matches, facets, groupKey } from "./agent-view.ts";

// ── team.ts ──
test("teamForRole groups roles; unknown/empty → null", () => {
  assert.equal(teamForRole("frontend")?.id, "build");
  assert.equal(teamForRole("security")?.id, "platform");
  assert.equal(teamForRole("manager")?.id, "command");
  assert.equal(teamForRole("does-not-exist"), null);
  assert.equal(teamForRole(null), null);
  assert.equal(TEAMS.length, 3);
});

test("roleTone is stable + deterministic; initials handle names/roles", () => {
  assert.equal(roleTone("frontend"), "indigo");
  assert.equal(roleTone("unknown-role"), roleTone("unknown-role")); // deterministic
  assert.equal(roleTone(null), "slate");
  assert.equal(initials("Frontend-agent"), "FA");
  assert.equal(initials("qa"), "QA");
  assert.equal(initials(""), "·");
});

// ── backward compatibility: a slot/card with NO agent/role/team still normalizes ──
test("slotMeta: old slot without metadata renders (status from phase)", () => {
  const old = { slot: 0, pid: 1, issue: 7, title: "x", model: "sonnet", effort: null, depth: null,
    phase: "building", started_at: null, elapsed_s: 10, phase_age_s: 1, stale: false, log: "" };
  const m = slotMeta(old as never);
  assert.equal(m.role, null);
  assert.equal(m.agentId, null);
  assert.equal(m.teamId, null);
  assert.equal(m.status, "building"); // falls back to the phase
});

test("slotMeta: enriched slot exposes agent/role/team; status reflects waiting/stalled", () => {
  const base = { slot: 0, pid: 1, issue: 7, title: "x", model: "opus", effort: null, depth: null,
    phase: "building", started_at: null, elapsed_s: 10, phase_age_s: 1, stale: false, log: "",
    role: "frontend", agent_id: "fe", agent_name: "Frontend-agent", team_id: "build", team_name: "Build" };
  assert.equal(slotMeta(base as never).role, "frontend");
  assert.equal(slotMeta(base as never).status, "building");
  assert.equal(slotMeta({ ...base, stale: true } as never).status, "stalled");
  assert.equal(slotMeta({ ...base, awaiting_approval: true } as never).status, "waiting");
});

test("cardMeta: old card without metadata uses column; new card exposes role/team + waiting", () => {
  const old = { issue: 1, title: "t", column: "backlog", labels: [], issueUrl: "", state: null,
    model: null, branch: null, prUrl: null, prNumber: null, reviewVerdict: null, error: null, updatedAt: "" };
  assert.equal(cardMeta(old as never).role, null);
  assert.equal(cardMeta(old as never).status, "backlog");
  const enriched = { ...old, role: "backend", teamId: "build", teamName: "Build", awaitingApproval: true };
  assert.equal(cardMeta(enriched as never).role, "backend");
  assert.equal(cardMeta(enriched as never).status, "waiting");
});

// ── filter + facets + group ──
const metas = [
  { role: "frontend", agentId: "fe", agentName: "Frontend-agent", teamId: "build", teamName: "Build", status: "building", risk: null },
  { role: "backend", agentId: "be", agentName: "Backend-agent", teamId: "build", teamName: "Build", status: "waiting", risk: "high" },
  { role: "security", agentId: "sec", agentName: "Security-agent", teamId: "platform", teamName: "Platform", status: "security", risk: null },
  { role: null, agentId: null, agentName: null, teamId: null, teamName: null, status: "backlog", risk: null },
];

test("matches: each set dimension narrows; empty filter passes everything", () => {
  assert.equal(metas.filter((m) => matches(m, {})).length, 4);
  assert.equal(metas.filter((m) => matches(m, { teamId: "build" })).length, 2);
  assert.equal(metas.filter((m) => matches(m, { role: "frontend" })).length, 1);
  assert.equal(metas.filter((m) => matches(m, { status: "waiting" })).length, 1);
  assert.equal(metas.filter((m) => matches(m, { teamId: "build", role: "backend" })).length, 1);
});

test("facets: only values that exist; group keys (unassigned → _none)", () => {
  const f = facets(metas);
  assert.deepEqual(f.roles, ["backend", "frontend", "security"]);
  assert.equal(f.agents.length, 3);
  assert.equal(f.teams.length, 2);
  assert.ok(f.statuses.includes("waiting"));
  assert.equal(groupKey(metas[0], "team").key, "build");
  assert.equal(groupKey(metas[3], "role").key, "_none");
  assert.equal(groupKey(metas[3], "role").label, "Unassigned");
});
