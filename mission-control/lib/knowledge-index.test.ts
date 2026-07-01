// Run: node --test --experimental-sqlite mission-control/lib/knowledge-index.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "kn-"));
fs.mkdirSync(path.join(TMP, "data"), { recursive: true });
const VAULT = path.join(TMP, "vault");
fs.mkdirSync(path.join(VAULT, "docs"), { recursive: true });
process.env.FLEET_DIR = TMP;
process.env.VAULT_DIR = VAULT;
// a realistic vault: safe docs + secret files that must NEVER be indexed + a doc that leaks a secret
fs.writeFileSync(path.join(VAULT, "rules.md"), "# Project Rules\nMake small PRs and always run tests.");
fs.writeFileSync(path.join(VAULT, "docs", "api.md"), "# API Docs\nGET /health returns 200.");
fs.writeFileSync(path.join(VAULT, ".env"), "SECRET_KEY=abcdef0123456789abcdef\nDB_PASSWORD=hunter2hunter2");
fs.writeFileSync(path.join(VAULT, "id_rsa"), "-----BEGIN OPENSSH PRIVATE KEY-----\nMIIabcdef\n-----END OPENSSH PRIVATE KEY-----");
fs.writeFileSync(path.join(VAULT, "creds.md"), "# secrets\napi_key=SUPERSECRETVALUE1234567890ABCDEF");
fs.writeFileSync(path.join(VAULT, "leaky.md"), "# Onboarding\nUse the shared token: bearer=SUPERSECRETVALUE1234567890ABCDEF for now.");

const K = await import("./knowledge-index.ts");

test("validateKnowledgeSafety: secret paths are not indexable; secret content marks unsafe + scrubs the preview", () => {
  assert.equal(K.isIndexablePath(".env"), false);
  assert.equal(K.isIndexablePath("id_rsa"), false);
  assert.equal(K.isIndexablePath("config/credentials.md"), false);
  assert.equal(K.isIndexablePath("notes.pem"), false);
  assert.equal(K.isIndexablePath("rules.md"), true);
  const v = K.validateKnowledgeSafety("leaky.md", "bearer=SUPERSECRETVALUE1234567890ABCDEF");
  assert.equal(v.indexable, true);
  assert.equal(v.has_secret, true);
  assert.equal(v.safe_to_use, false);
  assert.ok(!v.preview.includes("SUPERSECRETVALUE"), "the secret is scrubbed out of the preview");
});

test("addKnowledgeSource folder: indexes safe docs, NEVER indexes .env/keys, flags secret-bearing docs unsafe", () => {
  const r = K.addKnowledgeSource({ kind: "folder" });
  assert.ok((r.indexed ?? 0) >= 2, `should index the safe .md files, got ${r.indexed}`);
  const items = K.listKnowledgeItems({ include_archived: true, limit: 500 });
  // the secret FILES are absent entirely
  assert.ok(!items.some((i) => i.source_path === ".env"), ".env is never indexed");
  assert.ok(!items.some((i) => i.source_path === "id_rsa"), "the private key file is never indexed");
  // a normal doc is indexed + safe
  const rules = items.find((i) => i.source_path === "rules.md");
  assert.ok(rules && rules.safe_to_use && rules.title.includes("Project Rules"));
  // a doc that CONTAINS a secret is indexed but flagged unsafe with a scrubbed preview
  const leaky = items.find((i) => i.source_path === "leaky.md");
  assert.ok(leaky && leaky.safe_to_use === false && !(leaky.content_preview ?? "").includes("SUPERSECRETVALUE"));
});

test("re-indexing is idempotent (one item per source_path)", () => {
  const before = K.listKnowledgeItems({ include_archived: true, limit: 500 }).length;
  K.addKnowledgeSource({ kind: "folder" });
  const after = K.listKnowledgeItems({ include_archived: true, limit: 500 }).length;
  assert.equal(after, before);
});

test("path traversal is blocked", () => {
  assert.throws(() => K.addKnowledgeSource({ kind: "file", source_path: "../../etc/passwd" }), (e) => K.knowledgeStatusOf(e) === 400);
});

test("default team instructions seed (the project ground rules)", () => {
  K.ensureDefaultInstructions();
  const instr = K.listKnowledgeItems({ type: "team_instruction", limit: 50 });
  assert.ok(instr.length >= 6);
  assert.ok(instr.some((i) => i.title.includes("small PRs")));
  assert.ok(instr.some((i) => i.title.includes("No new dependency")));
});

test("search + per-agent access control (allowed_agents restricts who may use an item)", () => {
  const open = K.addKnowledgeSource({ kind: "manual", title: "Deployment runbook", content: "How to deploy the service safely.", type: "docs" }).item!;
  const restricted = K.addKnowledgeSource({ kind: "manual", title: "Deployment secrets policy", content: "Only ops may read this.", type: "security_rules", allowed_agents: ["ops"] }).item!;
  // an open item is found by anyone
  assert.ok(K.searchKnowledge("deployment", { role: "frontend" }).some((h) => h.item.id === open.id));
  // the restricted item is hidden from a non-allowed role, visible to the allowed one
  assert.ok(!K.searchKnowledge("deployment", { role: "frontend" }).some((h) => h.item.id === restricted.id));
  assert.ok(K.searchKnowledge("deployment", { role: "ops" }).some((h) => h.item.id === restricted.id));
  assert.equal(K.agentMayUse(restricted, null, "ops"), true);
  assert.equal(K.agentMayUse(restricted, "someone", "frontend"), false);
});

test("search never surfaces unsafe (secret-flagged) content by default", () => {
  const hits = K.searchKnowledge("SUPERSECRETVALUE", {});
  assert.ok(!hits.some((h) => h.item.source_path === "leaky.md" || h.item.source_path === "creds.md"), "flagged-unsafe items are excluded from search");
});

test("a secret in a title/summary is scrubbed out of the STORED fields, not just the preview", () => {
  const it = K.addKnowledgeSource({ kind: "manual", title: "creds api_key=SUPERSECRETVALUE1234567890", content: "note line\npassword: SUPERSECRETVALUE1234567890 do not share" }).item!;
  assert.ok(!it.title.includes("SUPERSECRETVALUE"), "secret scrubbed from the stored title");
  assert.ok(!(it.summary ?? "").includes("SUPERSECRETVALUE"), "secret scrubbed from the stored summary");
  assert.ok(!(it.content_preview ?? "").includes("SUPERSECRETVALUE"), "secret scrubbed from the preview");
  assert.equal(it.safe_to_use, false);
});

test("a symlinked file in the vault is NEVER read/indexed (confinement — no reading through symlinks)", () => {
  const outside = path.join(TMP, "outside-secret.txt");
  fs.writeFileSync(outside, "SECRET_OUTSIDE=abc123\njust a note");
  try { fs.symlinkSync(outside, path.join(VAULT, "linked.md")); } catch { return; } // skip if the FS forbids symlinks
  K.addKnowledgeSource({ kind: "folder" });
  assert.ok(!K.listKnowledgeItems({ include_archived: true, limit: 500 }).some((i) => i.source_path === "linked.md"), "the symlink is skipped by the folder walk");
  // a direct file add of the symlink is also refused (realpath escapes the vault)
  assert.throws(() => K.addKnowledgeSource({ kind: "file", source_path: "linked.md" }), (e) => K.knowledgeStatusOf(e) === 400);
});

test("update + archive", () => {
  const it = K.addKnowledgeSource({ kind: "manual", title: "temp", content: "x" }).item!;
  const up = K.updateKnowledgeItem(it.id, { title: "renamed", tags: ["a", "b"], team_id: "t1" });
  assert.equal(up.title, "renamed");
  assert.deepEqual(up.tags, ["a", "b"]);
  const arch = K.archiveKnowledgeItem(it.id);
  assert.equal(arch.archived, true);
  assert.ok(!K.listKnowledgeItems({ limit: 500 }).some((i) => i.id === it.id), "archived items are hidden by default");
});
