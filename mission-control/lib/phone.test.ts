// Run: node --test mission-control/lib/phone.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { telegramProvider } from "./phone/telegram.ts";
import { routeCommand } from "./phone/commands.ts";
import { phoneStatus, getProvider } from "./phone/index.ts";
import { redact } from "./redact.ts";
import type { IncomingMessage } from "./phone/types.ts";

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

test("getProvider returns telegram; redact catches a github pat", () => {
  setEnv(true);
  assert.equal(getProvider()?.name, "telegram");
  assert.ok(!redact("token github_pat_abcdefghij1234567890ZZ here").includes("github_pat_"));
});
