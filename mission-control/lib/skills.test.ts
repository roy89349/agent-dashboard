// Run: node --test mission-control/lib/skills.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "skills-"));
fs.mkdirSync(path.join(TMP, "control"), { recursive: true });
process.env.FLEET_DIR = TMP;

const { writeSkills, readSkills, normalizeSkill, httpStatusOf } = await import("./skills.ts");
const upsert = (s: object, rev: number, confirm?: boolean) => writeSkills({ upsert: s as never }, rev, confirm);
const statusOf = (fn: () => void): number => { try { fn(); return 0; } catch (e) { return httpStatusOf(e); } };

test("normalize: risk enum + dangerous defaults to approval_required + config_schema object/null", () => {
  const crit = normalizeSkill({ id: "x", risk_level: "critical" });
  assert.equal(crit.risk_level, "critical");
  assert.equal(crit.approval_required, true); // high/critical default ON
  assert.equal(crit.enabled, true);
  assert.equal(crit.archived, false);
  const low = normalizeSkill({ id: "y", risk_level: "low" });
  assert.equal(low.approval_required, false);
  // explicit override wins
  assert.equal(normalizeSkill({ id: "z", risk_level: "critical", approval_required: false }).approval_required, false);
  // bad risk → low; array/garbage config_schema → null; object kept
  assert.equal(normalizeSkill({ id: "w", risk_level: "nope" as never }).risk_level, "low");
  assert.equal(normalizeSkill({ id: "a", config_schema: [1, 2] as never }).config_schema, null);
  assert.deepEqual(normalizeSkill({ id: "b", config_schema: { k: 1 } }).config_schema, { k: 1 });
});

test("CAS: first write rev 0->1, stale baseRev -> 409, bad id -> 400", () => {
  assert.equal(upsert({ id: "read-codebase", name: "Read", risk_level: "low" }, 0), 1);
  assert.equal(statusOf(() => upsert({ id: "x", name: "y" }, 0)), 409);
  assert.equal(statusOf(() => upsert({ id: "Bad Id!", name: "n" }, readSkills().rev)), 400);
});

test("merge-upsert: archiving keeps the rest of the skill intact", () => {
  let rev = readSkills().rev;
  rev = upsert({ id: "edit", name: "Edit", description: "modify", category: "code", risk_level: "medium", allowed_tools: ["Edit", "Write"] }, rev);
  rev = upsert({ id: "edit", archived: true }, rev); // partial
  const s = readSkills().skills.find((x) => x.id === "edit")!;
  assert.equal(s.archived, true);
  assert.equal(s.name, "Edit"); // not wiped
  assert.deepEqual(s.allowed_tools, ["Edit", "Write"]);
  assert.equal(s.risk_level, "medium");
});

test("whole-list replace needs confirm; remove deletes", () => {
  const rev = readSkills().rev;
  assert.equal(statusOf(() => writeSkills({ skills: [{ id: "only", risk_level: "low" }] as never }, rev)), 400); // no confirm
  assert.equal(writeSkills({ skills: [{ id: "only", risk_level: "low" }] as never }, rev, true) > rev, true);
  const rev2 = readSkills().rev;
  writeSkills({ remove: "only" }, rev2);
  assert.equal(readSkills().skills.find((s) => s.id === "only"), undefined);
});

test("readSkills never throws on a corrupt file (drops the bad skill, keeps the rest)", () => {
  fs.writeFileSync(path.join(TMP, "control", "skills.json"), JSON.stringify({ schema: 1, rev: 5, updated_at: null, skills: [{ id: "good", risk_level: "low" }, { notanid: true }, { id: "BAD ID" }] }));
  const f = readSkills();
  assert.equal(f.rev, 5);
  assert.equal(f.skills.length, 1); // only "good" survives
  assert.equal(f.skills[0].id, "good");
});
