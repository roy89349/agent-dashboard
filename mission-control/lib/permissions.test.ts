// Run: node --test --experimental-sqlite mission-control/lib/permissions.test.ts
// The mandatory permission MATRIX: (A) detectRisk path table + negatives, (B) the decision matrix
// (action × autonomy-level × risk × team-policy × env-gate × skill) with the never-weaker / fail-closed
// invariants, (C) enforce() side-effects (deny→403, idempotent approval, audit) under a temp FLEET_DIR.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "perm-"));
fs.mkdirSync(path.join(TMP, "control"), { recursive: true });
process.env.FLEET_DIR = TMP;
delete process.env.ALLOW_GLOBAL_OPUS;
delete process.env.ALLOW_AUTO_MERGE;

const P = await import("./permissions.ts");
const { detectRisk, evaluateAction, enforce, permissionStatusOf, RISK_ORDER } = P;

// ── fixtures ──
const agent = (p: object = {}) => ({
  id: "a", name: "A", role: "backend", skills: [], skill_ids: [], enabled: true, model_default: "sonnet",
  effort_default: "medium", depth_default: "solo", autonomy: "review", system_prompt_ref: "", allowed_tools: [],
  green_cmd: null, review_of_roles: [], blocking: false, label_scope: [], max_concurrency: 1, daily_token_budget: null, credential_ref: null, ...p,
});
const skill = (p: object = {}) => ({
  id: "s", name: "S", description: "", category: "github", risk_level: "low", required_permissions: [],
  compatible_roles: [], allowed_tools: [], approval_required: false, config_schema: null, enabled: true, archived: false, created_at: "", updated_at: "", ...p,
});
const team = (mode = "manual", blocking: string[] = [], maxRisk: "low" | "medium" | null = null) => ({
  id: "t", name: "T", description: "", enabled: true, is_template: false, lead: null, members: ["a"],
  project_scope: { repos: [], paths: [] }, labels: [], edges: [], routing_rules: [],
  approval_policy: { mode, auto_approve_max_risk: maxRisk, blocking_roles: blocking, required_reviews: 0, auto_merge: false },
  budget_caps: { daily_token_budget: null, max_concurrency: null, max_pr_per_day: null, per_agent: {} },
  layout: {}, source_project_type: null, created_at: "", updated_at: "",
});
// build a PermissionContext via the snapshot escape hatch (pure, no disk)
const ctx = (snap: object = {}) => ({
  snapshot: {
    agent: null, team: null, skills: [], gates: { allowGlobalOpus: false, allowAutoMerge: false },
    initiator: "human", trusted: false, confirmed: false, ...snap,
  },
}) as never;
const eff = (action: never, snap: object) => evaluateAction(action, ctx(snap)).effect;

// ── (A) detectRisk ──
test("detectRisk: THIS repo's real auth/secret/workflow/dep paths are caught; normal files stay low", () => {
  const f = (p: string, status = "modified") => ({ type: "modify_code", files: [{ path: p, status }] }) as never;
  assert.equal(detectRisk(f("lib/session.ts")).risk, "critical"); // real auth, not substring "auth"
  assert.ok(detectRisk(f("lib/session.ts")).categories.includes("auth_security"));
  assert.equal(detectRisk(f("lib/authorization.ts")).risk, "critical"); // word-boundary regression
  assert.equal(detectRisk(f("lib/authentication.ts")).risk, "critical");
  assert.equal(detectRisk(f("lib/oauth.ts")).risk, "critical");
  assert.equal(detectRisk(f("app/api/login/route.ts")).risk, "critical");
  assert.equal(detectRisk(f(".github/workflows/ci.yml")).risk, "critical"); // promoted to critical
  assert.equal(detectRisk(f(".env.local")).risk, "critical");
  assert.ok(detectRisk(f("server/billing/stripe.ts")).categories.includes("billing_payment"));
  assert.equal(detectRisk(f("package.json")).risk, "high"); // scripts/postinstall band
  assert.equal(detectRisk(f("supabase/migrations/001_init.sql")).risk, "high");
  assert.equal(detectRisk(f("src/components/Button.tsx")).risk, "low"); // negative
  assert.equal(detectRisk(f("README.md")).risk, "low"); // negative
  // deleting a sensitive file escalates to critical + delete_file
  const del = detectRisk({ type: "modify_code", files: [{ path: "lib/session.ts", status: "deleted" }] } as never);
  assert.equal(del.risk, "critical");
  assert.ok(del.categories.includes("delete_file"));
  // secret env key
  assert.equal(detectRisk({ type: "change_env", keys: ["STRIPE_SECRET_KEY"] } as never).risk, "critical");
  // diff-blind merge ⇒ HIGH (fail-closed unknown diff); a known benign diff ⇒ medium
  assert.equal(detectRisk({ type: "merge", pr: 1 } as never).risk, "high");
  assert.equal(detectRisk({ type: "merge", pr: 1, files: [{ path: "src/x.ts", status: "modified" }] } as never).risk, "medium");
});

// ── (B) decision matrix ──
test("INVARIANT #7: a trusted human who confirmed at the route keeps one-click merge (no second approval)", () => {
  assert.equal(eff({ type: "merge", pr: 7 } as never, { initiator: "human", trusted: true, confirmed: true }), "allow");
  // not confirmed ⇒ merge needs approval (phone-style)
  assert.equal(eff({ type: "merge", pr: 7 } as never, { initiator: "human", trusted: true, confirmed: false }), "requires_approval");
});

test("hard env gates apply to everyone and cannot be approved away", () => {
  // force_opus denied without ALLOW_GLOBAL_OPUS, even for a confirmed human
  assert.equal(eff({ type: "use_opus", scope: "global" } as never, { initiator: "human", trusted: true, confirmed: true }), "deny");
  assert.equal(eff({ type: "use_opus", scope: "global" } as never, { initiator: "human", trusted: true, confirmed: true, gates: { allowGlobalOpus: true, allowAutoMerge: false } }), "allow");
});

test("agent level gates: suggest can't modify code; review can PR but not merge; merge needs ALLOW_AUTO_MERGE", () => {
  const sugg = { agent: agent({ autonomy: "suggest" }), initiator: "agent", team: team() };
  assert.equal(eff({ type: "modify_code", files: [{ path: "src/x.ts", status: "modified" }] } as never, sugg), "deny");
  const rev = { agent: agent({ autonomy: "review" }), initiator: "agent", team: team(), skills: [skill({ category: "github" })] };
  assert.equal(eff({ type: "create_pr", files: [{ path: "src/x.ts", status: "modified" }] } as never, rev), "allow");
  assert.equal(eff({ type: "merge", pr: 1 } as never, rev), "deny"); // review eff 3 < required 4
  // a full agent still can't merge without the env gate
  const full = { agent: agent({ autonomy: "full" }), initiator: "agent", team: team("auto_below_risk", [], "medium"), skills: [skill({ category: "github" })] };
  assert.equal(eff({ type: "merge", pr: 1 } as never, full), "deny"); // ALLOW_AUTO_MERGE off
  const fullGate = { ...full, gates: { allowGlobalOpus: false, allowAutoMerge: true } };
  // a DIFF-BLIND merge is high ⇒ above the medium ceiling ⇒ approval (no auto-merge of an unknown diff)
  assert.equal(eff({ type: "merge", pr: 1 } as never, fullGate), "requires_approval");
  // a KNOWN low-risk diff ⇒ emergent level-4 auto-merge
  assert.equal(eff({ type: "merge", pr: 1, files: [{ path: "src/x.ts", status: "modified" }] } as never, fullGate), "allow");
});

test("agent capability gate: an elevated action needs a granting skill", () => {
  const noSkill = { agent: agent({ autonomy: "review" }), initiator: "agent", team: team(), skills: [] };
  assert.equal(eff({ type: "create_pr", files: [] } as never, noSkill), "deny"); // no github skill
  const wrongCat = { ...noSkill, skills: [skill({ category: "data" })] };
  assert.equal(eff({ type: "create_pr", files: [] } as never, wrongCat), "deny");
});

test("always-approve categories override team auto-policy; unknown action denied", () => {
  // a workflow file change is never auto-allowed, even by an auto_below_risk team
  const autoTeam = { agent: agent({ autonomy: "review" }), initiator: "agent", team: team("auto_below_risk", [], "medium"), skills: [skill({ category: "github" })] };
  assert.equal(eff({ type: "create_pr", files: [{ path: ".github/workflows/ci.yml", status: "modified" }] } as never, autoTeam), "requires_approval");
  // unknown action type ⇒ deny (totality)
  assert.equal(eff({ type: "bogus" } as never, { initiator: "human", trusted: true, confirmed: true }), "deny");
  // missing agent for an agent-initiated action ⇒ deny (fail-closed)
  assert.equal(eff({ type: "create_pr", files: [] } as never, { agent: null, initiator: "agent" }), "deny");
});

test("auto_below_risk: low-risk auto-allowed, above-ceiling needs approval", () => {
  const t = { agent: agent({ autonomy: "full" }), initiator: "agent", team: team("auto_below_risk", [], "low"), skills: [skill({ category: "code" })], gates: { allowGlobalOpus: false, allowAutoMerge: true } };
  assert.equal(eff({ type: "modify_code", files: [{ path: "src/x.ts", status: "modified" }] } as never, t), "allow"); // low
  assert.equal(eff({ type: "modify_code", files: [{ path: "package.json", status: "modified" }] } as never, t), "requires_approval"); // high > low ceiling
});

// ── (C) enforce side-effects (touches the durable approvals store) ──
test("enforce: deny throws PermissionError(403); allow returns allowed:true", async () => {
  await assert.rejects(
    () => enforce({ type: "use_opus", scope: "global" } as never, ctx({ initiator: "human", trusted: true, confirmed: true })),
    (e: unknown) => permissionStatusOf(e) === 403,
  );
  const r = await enforce({ type: "merge", pr: 5 } as never, ctx({ initiator: "human", trusted: true, confirmed: true }));
  assert.equal(r.allowed, true);
});

test("enforce: requires_approval creates ONE durable approval and is idempotent on re-submit", async () => {
  const { listPendingApprovals } = await import("./approvals.ts");
  const before = listPendingApprovals().length;
  const c = ctx({ initiator: "phone", trusted: true, confirmed: false, via: "telegram", actor: "6532449373" });
  const a1 = await enforce({ type: "phone_command", verb: "fleet_mode", mode: "stopped", mutates: true } as never, c, { summary: "Stop the fleet" });
  assert.equal(a1.allowed, false);
  assert.ok((a1 as { approvalId: string }).approvalId);
  const a2 = await enforce({ type: "phone_command", verb: "fleet_mode", mode: "stopped", mutates: true } as never, c, { summary: "Stop the fleet" });
  assert.equal((a2 as { approvalId: string }).approvalId, (a1 as { approvalId: string }).approvalId); // reused, not duplicated
  assert.equal(listPendingApprovals().length, before + 1);
});

test("enforce: two DIFFERENT risky sign-off actions create TWO approvals (no confused-deputy collapse)", async () => {
  const { listPendingApprovals } = await import("./approvals.ts");
  const snap = {
    agent: agent({ id: "agx", autonomy: "full" }), team: team(), skills: [skill({ category: "data" }), skill({ category: "code" })],
    gates: { allowGlobalOpus: false, allowAutoMerge: false }, initiator: "agent", trusted: false, confirmed: false, via: "fleet", actor: "agx",
  };
  const before = listPendingApprovals().length;
  const r1 = await enforce({ type: "change_database", statements: ["DROP TABLE x"] } as never, ctx(snap));
  const r2 = await enforce({ type: "add_dependency", deps: ["evil-pkg"] } as never, ctx(snap));
  assert.equal(r1.allowed, false);
  assert.equal(r2.allowed, false);
  assert.notEqual((r1 as { approvalId: string }).approvalId, (r2 as { approvalId: string }).approvalId); // distinct, not collapsed
  assert.equal(listPendingApprovals().length, before + 2);
});

test("RISK_ORDER is ascending", () => {
  assert.deepEqual(RISK_ORDER, ["low", "medium", "high", "critical"]);
});
