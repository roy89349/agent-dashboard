// Unit tests for the multi-repo registry — run with the Node built-in runner (Node 22.6+ strips types):
//   node --test mission-control/lib/repos.test.ts
// Covers: zero-config fallback, the synthesised PRIMARY (always present, never stored/deleted), entry
// validation (id [a-z0-9-]{1,40}, reject "primary"/bad chars/dup, owner/name, absolute repo_dir),
// overrides clamp (risk_floor/budget_mode/max_pr_per_day), CAS-on-rev (409), merge-upsert, and delete.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "repos-"));
fs.mkdirSync(path.join(TMP, "control"), { recursive: true });
process.env.FLEET_DIR = TMP;
delete process.env.CONTROL_DIR;
delete process.env.REPOS_FILE;
process.env.REPO = "roy/primary-app";
process.env.REPO_DIR = "/opt/fleet/clones/primary";
process.env.PROJECT_NAME = "Primary App";
process.env.PROJECT_DESC = "the env-configured primary";
process.env.GREEN_CMD = "npm run build";
process.env.LABEL_READY = "agent-ready";

const {
  readRepos, writeRepos, deleteRepo, normalizeRepo, listReposResolved, repoById, httpStatusOf, PRIMARY_ID,
} = await import("./repos.ts");

const F = path.join(TMP, "control", "repos.json");
const valid = (over: object = {}) => ({
  id: "tapsafe",
  repo: "roy/tapsafe",
  repo_dir: "/opt/fleet/clones/tapsafe",
  name: "TapSafe",
  project_name: "TapSafe",
  project_desc: "NL gezinsapp",
  green_cmd: "npm run build",
  label_ready: "agent-ready",
  enabled: true,
  ...over,
});
function statusOf(fn: () => void): number {
  try { fn(); return 0; } catch (e) { return httpStatusOf(e); }
}

test("read: absent file → zero-config {rev:0, repos:[]}", () => {
  const f = readRepos();
  assert.equal(f.rev, 0);
  assert.deepEqual(f.repos, []);
});

test("primary is ALWAYS present, synthesised from env, and single-repo mode = [primary]", () => {
  const list = listReposResolved();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, PRIMARY_ID);
  assert.equal(list[0].primary, true);
  assert.equal(list[0].enabled, true);
  assert.equal(list[0].repo, "roy/primary-app");
  assert.equal(list[0].repo_dir, "/opt/fleet/clones/primary");
  assert.equal(list[0].label_ready, "agent-ready");
  assert.equal(repoById(null)!.id, PRIMARY_ID);
  assert.equal(repoById(PRIMARY_ID)!.primary, true);
});

test("normalize: defaults + strips unknown fields; overrides default to null (inherit)", () => {
  const r = normalizeRepo({ ...valid({ name: "" }), evil: "x" } as never);
  assert.deepEqual(Object.keys(r).sort(), [
    "enabled", "green_cmd", "id", "label_ready", "name", "overrides", "project_desc", "project_name", "repo", "repo_dir", "vault_dir",
  ]);
  assert.equal(r.name, "tapsafe"); // name defaults to id
  assert.deepEqual(r.overrides, { budget_mode: null, max_pr_per_day: null, risk_floor: null, model: null });
});

test("id validation: reject 'primary', bad chars, and empty", () => {
  assert.equal(statusOf(() => normalizeRepo(valid({ id: "primary" }) as never)), 400);
  assert.equal(statusOf(() => normalizeRepo(valid({ id: "Bad_Slug" }) as never)), 400);
  assert.equal(statusOf(() => normalizeRepo(valid({ id: "x".repeat(41) }) as never)), 400);
  assert.equal(statusOf(() => normalizeRepo(valid({ id: "" }) as never)), 400);
  assert.equal(statusOf(() => normalizeRepo(valid({ repo: "not-owner-name" }) as never)), 400);
  assert.equal(statusOf(() => normalizeRepo(valid({ repo_dir: "relative/path" }) as never)), 400);
  assert.equal(statusOf(() => normalizeRepo(valid({ repo_dir: "/opt/../etc" }) as never)), 400);
});

test("overrides clamp: risk_floor/budget_mode enum-checked; max_pr_per_day null-or-positive-int", () => {
  const good = normalizeRepo(valid({ overrides: { risk_floor: "high", budget_mode: "economy", max_pr_per_day: 5, model: "sonnet" } }) as never);
  assert.deepEqual(good.overrides, { risk_floor: "high", budget_mode: "economy", max_pr_per_day: 5, model: "sonnet" });
  const clamped = normalizeRepo(valid({ overrides: { risk_floor: "nope", budget_mode: "emergency", max_pr_per_day: -3, model: "" } }) as never);
  assert.deepEqual(clamped.overrides, { risk_floor: null, budget_mode: null, max_pr_per_day: null, model: null });
});

test("CAS: first upsert rev 0→1, stale baseRev → 409, mode 0600, primary NOT stored", () => {
  assert.equal(writeRepos({ upsert: valid() }, 0), 1);
  assert.equal(statusOf(() => writeRepos({ upsert: valid({ id: "x2" }) }, 0)), 409);
  assert.equal(fs.statSync(F).mode & 0o777, 0o600);
  const onDisk = JSON.parse(fs.readFileSync(F, "utf8"));
  assert.equal(onDisk.repos.length, 1);
  assert.equal(onDisk.repos[0].id, "tapsafe");
  assert.ok(!onDisk.repos.some((r: { id: string }) => r.id === PRIMARY_ID)); // primary never stored
});

test("listReposResolved: primary first, then only ENABLED extras", () => {
  assert.equal(writeRepos({ upsert: valid({ enabled: false }) }, 1), 2); // disable tapsafe (merge)
  assert.equal(writeRepos({ upsert: valid({ id: "slipbase", repo: "roy/slipbase", name: "Slipbase" }) }, 2), 3);
  const ids = listReposResolved().map((r) => r.id);
  assert.deepEqual(ids, [PRIMARY_ID, "slipbase"]); // disabled tapsafe excluded
});

test("upsert merges over existing (partial {id,enabled} keeps the rest)", () => {
  const before = readRepos().repos.find((r) => r.id === "tapsafe")!;
  assert.equal(before.enabled, false);
  assert.equal(before.green_cmd, "npm run build"); // untouched by the disable upsert
});

test("delete extra works; delete primary refused (400)", () => {
  assert.equal(statusOf(() => deleteRepo(PRIMARY_ID)), 400);
  const rev = deleteRepo("tapsafe");
  assert.deepEqual(readRepos().repos.map((r) => r.id), ["slipbase"]);
  assert.equal(readRepos().rev, rev);
  // remove via patch also refuses the primary id
  assert.equal(statusOf(() => writeRepos({ remove: PRIMARY_ID }, rev)), 400);
});

test("corrupt entry on disk is dropped on read (rest survive)", () => {
  const raw = JSON.parse(fs.readFileSync(F, "utf8"));
  raw.repos.push({ id: "BAD ID", repo: "x" });
  raw.repos.push({ id: PRIMARY_ID, repo: "roy/sneaky", repo_dir: "/x" }); // a stored "primary" is ignored
  fs.writeFileSync(F, JSON.stringify(raw));
  assert.deepEqual(readRepos().repos.map((r) => r.id), ["slipbase"]);
});
