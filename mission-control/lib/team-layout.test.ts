// Run: node --test mission-control/lib/team-layout.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeLayout, edgePath, layoutBounds } from "./team-layout.ts";

function team(members: string[], edges: { from: string; to: string; kind: string }[], layout = {}): never {
  return {
    id: "t", name: "t", description: "", enabled: true, is_template: false, lead: members[0] ?? null,
    members, project_scope: { repos: [], paths: [] }, labels: [], edges, routing_rules: [],
    approval_policy: { mode: "manual", auto_approve_max_risk: null, blocking_roles: [], required_reviews: 0, auto_merge: false },
    budget_caps: { daily_token_budget: null, max_concurrency: null, max_pr_per_day: null, per_agent: {} },
    layout, source_project_type: null, created_at: "", updated_at: "",
  } as never;
}

test("3-tier chart yields depths 0/1/2 (reports_to BFS from the lead)", () => {
  const t = team(
    ["mgr", "be", "qa"],
    [
      { from: "be", to: "mgr", kind: "reports_to" }, // be reports to mgr
      { from: "qa", to: "be", kind: "reports_to" }, // qa reports to be
    ],
  );
  const pos = computeLayout(t);
  assert.equal(pos.get("mgr")!.depth, 0);
  assert.equal(pos.get("be")!.depth, 1);
  assert.equal(pos.get("qa")!.depth, 2);
});

test("all members positioned incl. an orphan with no reports_to", () => {
  const t = team(["mgr", "lonely"], [{ from: "mgr", to: "mgr", kind: "reports_to" }]); // self-edge dropped upstream; here none valid
  const pos = computeLayout(t);
  assert.ok(pos.has("mgr") && pos.has("lonely"));
});

test("persisted layout coords override the auto layout", () => {
  const t = team(["mgr"], [], { mgr: { x: 999, y: 888 } });
  assert.deepEqual({ x: computeLayout(t).get("mgr")!.x, y: computeLayout(t).get("mgr")!.y }, { x: 999, y: 888 });
});

test("edgePath returns '' for a dangling edge (NaN guard), valid path otherwise", () => {
  assert.equal(edgePath(undefined, { x: 0, y: 0, depth: 0 }), "");
  assert.equal(edgePath({ x: NaN, y: 0, depth: 0 }, { x: 0, y: 0, depth: 0 }), "");
  const p = edgePath({ x: 0, y: 0, depth: 0 }, { x: 100, y: 200, depth: 1 });
  assert.ok(p.startsWith("M ") && p.includes("C ") && !p.includes("NaN"));
});

test("layoutBounds covers all nodes", () => {
  const t = team(["a", "b"], [{ from: "b", to: "a", kind: "reports_to" }]);
  const b = layoutBounds(computeLayout(t));
  assert.ok(b.w > 0 && b.h > 0);
});
