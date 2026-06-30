// Unit tests for the agents registry — run with the Node built-in runner (Node 22.6+ strips types):
//   node --test mission-control/lib/agents.test.ts
// Covers: fallback (missing/absent registry), CAS + stale-rev (409), and the opus write-gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readAgents,
  writeAgents,
  normalizeAgent,
  httpStatusOf,
} from "./agents.ts";

// agents.ts reads process.env (FLEET_DIR / ALLOW_GLOBAL_OPUS / AGENTS_DEFAULT_FILE) lazily on every
// call, so we just point it at a fresh temp dir before each test.
function freshDir(seed?: unknown): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "agents-"));
  fs.mkdirSync(path.join(d, "control"), { recursive: true });
  fs.mkdirSync(path.join(d, "deploy"), { recursive: true });
  if (seed !== undefined)
    fs.writeFileSync(path.join(d, "deploy", "agents.default.json"), JSON.stringify(seed));
  process.env.FLEET_DIR = d;
  delete process.env.AGENTS_DEFAULT_FILE;
  delete process.env.ALLOW_GLOBAL_OPUS;
  process.env.HARD_MAX_WORKERS = "8";
  return d;
}

const SEED = {
  schema: 1,
  rev: 0,
  updated_at: null,
  agents: [
    { id: "frontend", role: "frontend", model_default: "sonnet", label_scope: ["frontend"] },
    { id: "qa", role: "qa", model_default: "sonnet", review_of_roles: ["frontend"] },
  ],
};

test("fallback: missing control/agents.json → committed default team", () => {
  freshDir(SEED);
  const a = readAgents();
  assert.equal(a.agents.length, 2);
  assert.equal(a.agents[0].id, "frontend");
  assert.equal(a.agents[0].enabled, true); // default filled
});

test("fallback: no registry at all → empty registry, never throws (flow not broken)", () => {
  const d = freshDir(); // no seed written
  process.env.AGENTS_DEFAULT_FILE = path.join(d, "does-not-exist.json");
  const a = readAgents();
  assert.equal(a.agents.length, 0);
  assert.equal(a.rev, 0);
});

test("CAS on rev: matching baseRev writes (rev→1); a stale baseRev → 409", () => {
  freshDir(SEED);
  assert.equal(readAgents().rev, 0);
  const rev1 = writeAgents({ upsert: { id: "backend", role: "backend" } }, 0);
  assert.equal(rev1, 1);
  const after = readAgents();
  assert.equal(after.rev, 1);
  assert.ok(after.agents.some((x) => x.id === "backend"));
  // re-using the old baseRev must be rejected with 409
  assert.throws(
    () => writeAgents({ remove: "backend" }, 0),
    (e: unknown) => httpStatusOf(e) === 409,
  );
});

test("opus write-gate: model_default 'opus' rejected unless ALLOW_GLOBAL_OPUS=1", () => {
  freshDir(SEED);
  delete process.env.ALLOW_GLOBAL_OPUS;
  assert.throws(
    () => writeAgents({ upsert: { id: "architect", role: "architect", model_default: "opus" } }, 0),
    (e: unknown) => httpStatusOf(e) === 403,
  );
  process.env.ALLOW_GLOBAL_OPUS = "1";
  assert.equal(
    writeAgents({ upsert: { id: "architect", role: "architect", model_default: "opus" } }, 0),
    1,
  );
});

test("normalizeAgent: fills defaults, clamps, validates id", () => {
  freshDir();
  const a = normalizeAgent({
    id: "x",
    role: "backend",
    max_concurrency: 999,
    model_default: "nope" as never,
    effort_default: "bogus" as never,
  });
  assert.equal(a.model_default, "sonnet");
  assert.equal(a.effort_default, "medium");
  assert.equal(a.depth_default, "solo");
  assert.equal(a.enabled, true);
  assert.equal(a.max_concurrency, 8); // clamped to HARD_MAX_WORKERS
  assert.equal(a.daily_token_budget, null);
  assert.throws(() => normalizeAgent({ id: "", role: "x" }), (e: unknown) => httpStatusOf(e) === 400);
  assert.throws(() => normalizeAgent({ id: "ok" }), (e: unknown) => httpStatusOf(e) === 400); // role required
});
