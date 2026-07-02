// Run: node --test mission-control/lib/phone.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { telegramProvider } from "./phone/telegram.ts";
import { routeCommand } from "./phone/commands.ts";
import { transcribeVoice, type TranscribeDeps } from "./phone/transcribe.ts";
import { phoneStatus, getProvider } from "./phone/index.ts";
import { redact } from "./redact.ts";
import type { IncomingMessage } from "./phone/types.ts";

// Isolate the SQLite db in a temp FLEET_DIR before anything calls db() (created lazily once) —
// executeCommand's token commands + audits write through lib/db.ts.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "phone-"));
fs.mkdirSync(path.join(TMP, "data"), { recursive: true });
process.env.FLEET_DIR = TMP;
const { executeCommand } = await import("./phone/execute.ts");
const { getGlobalMode } = await import("./token-optimization/budget-manager.ts");

const ALLOWED = "424242";
function setEnv(configured: boolean) {
  process.env.PHONE_COMMAND_PROVIDER = "telegram";
  if (configured) {
    process.env.TELEGRAM_BOT_TOKEN = "test:token";
    process.env.TELEGRAM_ALLOWED_CHAT_ID = ALLOWED;
  } else {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_ALLOWED_CHAT_ID;
  }
}
const msg = (text: string, chatId = ALLOWED): IncomingMessage => ({ chatId, text, isCallback: false });
const cb = (data: string, chatId = ALLOWED): IncomingMessage => ({ chatId, text: "", isCallback: true, callbackData: data, callbackQueryId: "q" });

test("unconfigured provider: status reports it, sendMessage fails gracefully (no throw)", async () => {
  setEnv(false);
  const st = phoneStatus();
  assert.equal(st.provider, "telegram");
  assert.equal(st.configured, false);
  assert.ok(st.setupError);
  assert.equal(telegramProvider.isConfigured(), false);
  const r = await telegramProvider.sendMessage("hi");
  assert.equal(r.ok, false); // returns an error object, does not throw
});

test("verifySender: only the allowed chat id passes", () => {
  setEnv(true);
  assert.ok(telegramProvider.verifySender(ALLOWED));
  assert.ok(!telegramProvider.verifySender("999"));
});

test("parseIncomingCommand: slash, args, @botname, free text", () => {
  setEnv(true);
  assert.deepEqual(telegramProvider.parseIncomingCommand("/status"), { command: "status", args: "", raw: "/status" });
  assert.equal(telegramProvider.parseIncomingCommand("/task hello world").command, "task");
  assert.equal(telegramProvider.parseIncomingCommand("/task hello world").args, "hello world");
  assert.equal(telegramProvider.parseIncomingCommand("/cmd@MyBot x").command, "cmd");
  assert.equal(telegramProvider.parseIncomingCommand("just a message").command, null);
});

test("handleWebhook: message and callback_query normalize correctly", () => {
  setEnv(true);
  const m = telegramProvider.handleWebhook({ message: { chat: { id: 424242 }, text: "/status", message_id: 7 } });
  assert.equal(m?.chatId, "424242");
  assert.equal(m?.isCallback, false);
  const c = telegramProvider.handleWebhook({ callback_query: { id: "cq", data: "apv:abc:approve", message: { chat: { id: 424242 } } } });
  assert.equal(c?.isCallback, true);
  assert.equal(c?.callbackData, "apv:abc:approve");
});

test("routeCommand: unauthorized sender → no actionable plan", () => {
  setEnv(true);
  assert.deepEqual(routeCommand(telegramProvider, msg("/pause", "999")), { kind: "unauthorized" });
});

test("routeCommand: status / fleet control", () => {
  setEnv(true);
  assert.deepEqual(routeCommand(telegramProvider, msg("/status")), { kind: "status", what: "status" });
  assert.deepEqual(routeCommand(telegramProvider, msg("/pause")), { kind: "fleet_mode", mode: "paused", needsApproval: false });
  assert.deepEqual(routeCommand(telegramProvider, msg("/resume")), { kind: "fleet_mode", mode: "running", needsApproval: false });
  assert.deepEqual(routeCommand(telegramProvider, msg("/start")), { kind: "help" }); // Telegram welcome, not resume
  // dangerous: /stop requires confirmation/approval
  assert.deepEqual(routeCommand(telegramProvider, msg("/stop")), { kind: "fleet_mode", mode: "stopped", needsApproval: true });
  assert.deepEqual(routeCommand(telegramProvider, msg("/breaker_reset")), { kind: "breaker_reset" });
});

test("routeCommand: tasks, roles, free text, work continuation", () => {
  setEnv(true);
  assert.deepEqual(routeCommand(telegramProvider, msg("/task add dark mode")), { kind: "create_task", title: "add dark mode", role: null });
  assert.deepEqual(routeCommand(telegramProvider, msg("/frontend fix navbar")), { kind: "create_task", title: "fix navbar", role: "frontend" });
  assert.deepEqual(routeCommand(telegramProvider, msg("/assign backend add an endpoint")), { kind: "create_task", title: "add an endpoint", role: "backend" });
  assert.deepEqual(routeCommand(telegramProvider, msg("please add a settings page")), { kind: "free_text", text: "please add a settings page" });
  assert.deepEqual(routeCommand(telegramProvider, msg("/continue 42")), { kind: "continue", issue: 42 });
  assert.deepEqual(routeCommand(telegramProvider, msg("/priority 42 high")), { kind: "priority", issue: 42, level: "high" });
});

test("routeCommand: button callbacks (decision + new-task)", () => {
  setEnv(true);
  const id = "11111111-2222-3333-4444-555555555555";
  assert.deepEqual(routeCommand(telegramProvider, cb(`apv:${id}:approve`)), { kind: "decision", approvalId: id, action: "approve" });
  assert.deepEqual(routeCommand(telegramProvider, cb(`new:${id}:frontend`)), { kind: "new_task_button", approvalId: id, choice: "frontend" });
});

// ── token optimization commands ──

test("routeCommand: token commands parse (incl. usage hints)", () => {
  setEnv(true);
  assert.deepEqual(routeCommand(telegramProvider, msg("/tokens")), { kind: "tokens", costs: false });
  assert.deepEqual(routeCommand(telegramProvider, msg("/token_report")), { kind: "tokens", costs: false });
  assert.deepEqual(routeCommand(telegramProvider, msg("/costs")), { kind: "tokens", costs: true });
  assert.deepEqual(routeCommand(telegramProvider, msg("/budget")), { kind: "budget" });
  assert.deepEqual(routeCommand(telegramProvider, msg("/savings")), { kind: "savings" });
  assert.deepEqual(routeCommand(telegramProvider, msg("/expensive")), { kind: "expensive" });
  assert.deepEqual(routeCommand(telegramProvider, msg("/optimize")), { kind: "optimize" });
  assert.deepEqual(routeCommand(telegramProvider, msg("/setmode economy")), { kind: "set_token_mode", mode: "economy" });
  assert.equal(routeCommand(telegramProvider, msg("/setmode turbo")).kind, "usage"); // invalid mode → hint
  assert.equal(routeCommand(telegramProvider, msg("/approve_cost ab12")).kind, "usage"); // < 6 chars → hint
  assert.deepEqual(routeCommand(telegramProvider, msg("/approve_cost abcdef12")), { kind: "approve_cost", idPrefix: "abcdef12" });
});

test("/tokens: reply is labeled estimate when no actuals exist (and never invents a $)", async () => {
  setEnv(true);
  const r = await executeCommand(telegramProvider, { kind: "tokens", costs: false }, ALLOWED);
  assert.match(r.text, /estimate/i);
  assert.ok(!r.text.includes("$"), "must not invent a dollar figure");
});

test("/costs with no real data: says 'no real cost data — estimates only'", async () => {
  setEnv(true);
  const r = await executeCommand(telegramProvider, { kind: "tokens", costs: true }, ALLOWED);
  assert.match(r.text, /no real cost data — estimates only/);
  assert.ok(!/\$\d/.test(r.text), "must not invent a dollar figure");
});

test("/setmode economy switches the global mode", async () => {
  setEnv(true);
  const r = await executeCommand(telegramProvider, { kind: "set_token_mode", mode: "economy" }, ALLOWED);
  assert.match(r.text, /economy/);
  assert.equal(getGlobalMode(), "economy");
});

test("/setmode emergency: needs approval, mode unchanged", async () => {
  setEnv(true);
  const before = getGlobalMode();
  const r = await executeCommand(telegramProvider, { kind: "set_token_mode", mode: "emergency" }, ALLOWED);
  assert.match(r.text, /approval/i);
  assert.equal(getGlobalMode(), before); // emergency never switches directly
  assert.notEqual(getGlobalMode(), "emergency");
});

test("/budget: shows the current mode + the open emergency budget approval", async () => {
  setEnv(true);
  const r = await executeCommand(telegramProvider, { kind: "budget" }, ALLOWED);
  assert.match(r.text, /economy/);
  assert.match(r.text, /setmode/);
  assert.match(r.text, /EMERGENCY/i); // the escalation parked by the previous test
});

test("routeCommand: rec:<id>:apply|dismiss callbacks parse", () => {
  setEnv(true);
  const id = "11111111-2222-3333-4444-555555555555";
  assert.deepEqual(routeCommand(telegramProvider, cb(`rec:${id}:apply`)), { kind: "recommendation_button", id, choice: "apply" });
  assert.deepEqual(routeCommand(telegramProvider, cb(`rec:${id}:dismiss`)), { kind: "recommendation_button", id, choice: "dismiss" });
});

test("optimization loop: /optimize offers buttons; one tap applies the proven downgrade as a policy", async () => {
  setEnv(true);
  // seed the ledger: haiku PROVEN (6 ok runs) while sonnet burns the tokens → route.downgrade rule fires
  const { recordUsage } = await import("./token-optimization/ledger.ts");
  for (let i = 0; i < 6; i++)
    recordUsage({ agent_id: "phone-rec-agent", model: "haiku", estimated_input_tokens: 1000, result_status: "ok", source: "manual" });
  for (let i = 0; i < 3; i++)
    recordUsage({ agent_id: "phone-rec-agent", model: "sonnet", estimated_input_tokens: 60_000, result_status: "ok", source: "manual" });

  const r = await executeCommand(telegramProvider, { kind: "optimize" }, ALLOWED);
  assert.ok(r.buttons && r.buttons.length > 0, "expected apply/dismiss buttons on /optimize");
  const flat = r.buttons!.flat();
  assert.ok(flat.some((b) => /^rec:[0-9a-f-]+:apply$/.test(b.data ?? "")), "expected a rec:<id>:apply button");

  const { listRecommendations, getRecommendation } = await import("./token-optimization/recommendations.ts");
  const rec = listRecommendations("open").find((x) => x.rule === "route.downgrade.phone-rec-agent");
  assert.ok(rec, "expected the outcome-based downgrade recommendation");

  // one tap = apply (through enforce + budget-manager)
  const applied = await executeCommand(telegramProvider, { kind: "recommendation_button", id: rec!.id, choice: "apply" }, ALLOWED);
  assert.match(applied.text, /applied/i);
  assert.equal(getRecommendation(rec!.id)?.status, "applied");
  const { listPolicies } = await import("./token-optimization/budget-manager.ts");
  assert.ok(
    listPolicies().some((p) => p.scope === "agent" && p.scope_id === "phone-rec-agent" && p.mode === "economy"),
    "apply must write an economy agent policy via the budget-manager",
  );

  // idempotent: a re-tap never re-applies
  const again = await executeCommand(telegramProvider, { kind: "recommendation_button", id: rec!.id, choice: "apply" }, ALLOWED);
  assert.match(again.text, /already/i);

  // unknown id → friendly error
  const missing = await executeCommand(telegramProvider, { kind: "recommendation_button", id: "99999999-9999-9999-9999-999999999999", choice: "apply" }, ALLOWED);
  assert.match(missing.text, /no longer exists/i);
});

test("/approve_cost with an unknown id → not found", async () => {
  setEnv(true);
  const r = await executeCommand(telegramProvider, { kind: "approve_cost", idPrefix: "ffffff99" }, ALLOWED);
  assert.match(r.text, /no budget approval found/i);
});

test("getProvider returns telegram; redact catches a github pat", () => {
  setEnv(true);
  assert.equal(getProvider()?.name, "telegram");
  assert.ok(!redact("token github_pat_abcdefghij1234567890ZZ here").includes("github_pat_"));
});

// ── voice notes → tasks (local whisper.cpp) ──
// Real audio + a real whisper binary aren't available in CI, so we test the PURE / guardable parts with
// injected deps (fetch + process runner + logger + env). No network, no spawn, no binary needed.

test("transcribeVoice: VOICE_NOTES off ⇒ voice_disabled, and it NEVER spawns", async () => {
  let ran = false;
  const deps: Partial<TranscribeDeps> = {
    env: { TELEGRAM_BOT_TOKEN: "t", WHISPER_BIN: "/x/whisper", WHISPER_MODEL: "/x/m.bin" }, // flag deliberately absent
    run: async () => { ran = true; throw new Error("must not run"); },
    fetch: (async () => { throw new Error("must not fetch"); }) as unknown as typeof fetch,
    log: () => {},
  };
  const r = await transcribeVoice("file-123", deps);
  assert.deepEqual(r, { error: "voice_disabled" });
  assert.equal(ran, false, "the gate must short-circuit before any spawn");
});

test("transcribeVoice: missing binary/model ⇒ voice_disabled (still no spawn)", async () => {
  let ran = false;
  const r = await transcribeVoice("file-123", {
    env: { VOICE_NOTES: "on", TELEGRAM_BOT_TOKEN: "t" }, // WHISPER_BIN/MODEL missing
    run: async () => { ran = true; throw new Error("must not run"); },
    fetch: (async () => { throw new Error("must not fetch"); }) as unknown as typeof fetch,
    log: () => {},
  });
  assert.deepEqual(r, { error: "voice_disabled" });
  assert.equal(ran, false);
});

test("transcribeVoice: full stubbed pipeline returns the transcript AND redacts it before logging", async () => {
  const SECRET = "github_pat_abcdefghij1234567890ZZ";
  const TRANSCRIPT = `please add a settings page token ${SECRET} here`;
  const logs: string[] = [];

  // fetch stub: getFile → a file_path; download → fake OGG bytes. No real network.
  const fetchStub = (async (url: string) => {
    if (String(url).includes("/getFile"))
      return { ok: true, json: async () => ({ ok: true, result: { file_path: "voice/f.ogg", file_size: 2048 } }) } as unknown as Response;
    return { ok: true, arrayBuffer: async () => new TextEncoder().encode("fake-ogg-bytes").buffer } as unknown as Response;
  }) as unknown as typeof fetch;

  // run stub: ffmpeg "succeeds"; whisper writes "<-of>.txt" (exercises the real file-read path) + prints stdout.
  const runStub: TranscribeDeps["run"] = async (bin, args) => {
    if (bin.includes("ffmpeg")) return { code: 0, stdout: "", stderr: "", timedOut: false };
    const of = args[args.indexOf("-of") + 1];
    fs.writeFileSync(`${of}.txt`, TRANSCRIPT);
    return { code: 0, stdout: TRANSCRIPT, stderr: "", timedOut: false };
  };

  const r = await transcribeVoice("file-abc", {
    env: { VOICE_NOTES: "on", TELEGRAM_BOT_TOKEN: "t", WHISPER_BIN: "/x/whisper-cli", WHISPER_MODEL: "/x/ggml-base.bin", FFMPEG_BIN: "ffmpeg" },
    fetch: fetchStub,
    run: runStub,
    log: (m) => logs.push(m),
  });

  assert.ok("text" in r, "expected a transcript");
  assert.match((r as { text: string }).text, /please add a settings page/);
  // the transcript is logged, but ONLY after redaction — the planted secret must never hit the log
  assert.ok(logs.length > 0, "expected a log line");
  assert.ok(logs.every((l) => !l.includes(SECRET)), "the secret must be redacted before logging");
  assert.ok(logs.some((l) => l.includes("«REDACTED-github-pat»")), "expected the redaction marker");
});

test("voice wiring: a transcript routes to the SAME plan a typed message would (no forked logic)", () => {
  setEnv(true);
  const transcript = "please add a settings page";
  const viaText = routeCommand(telegramProvider, msg(transcript));
  const viaVoice = routeCommand(telegramProvider, { chatId: ALLOWED, text: transcript, isCallback: false });
  assert.deepEqual(viaVoice, viaText);
  assert.deepEqual(viaVoice, { kind: "free_text", text: transcript }); // → the "make this a task?" manager-confirm flow
});
