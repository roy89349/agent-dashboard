// Telegram provider (Bot API). Transport only. Reads env lazily so the dashboard never crashes when
// it is unconfigured, and so the allowed chat / token can change without a rebuild.
import type { Approval } from "../approvals";
import type {
  PhoneProvider,
  PhoneResult,
  IncomingMessage,
  ParsedCommand,
  Button,
  StatusSummary,
} from "./types";

const TOKEN = () => (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
const ALLOWED = () => (process.env.TELEGRAM_ALLOWED_CHAT_ID ?? "").trim();
const PUBLIC_URL = () => (process.env.MC_PUBLIC_URL ?? "").trim().replace(/\/+$/, "");
const API = () => `https://api.telegram.org/bot${TOKEN()}`;

async function tg(method: string, payload: object): Promise<PhoneResult> {
  if (!TOKEN()) return { ok: false, error: "TELEGRAM_BOT_TOKEN not set" };
  try {
    const res = await fetch(`${API()}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: { message_id?: number }; description?: string };
    if (!res.ok || !j.ok) return { ok: false, error: j.description ?? `telegram ${res.status}` };
    return { ok: true, messageId: j.result?.message_id != null ? String(j.result.message_id) : undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "telegram request failed" };
  }
}

function toInlineKeyboard(buttons?: Button[][]) {
  if (!buttons?.length) return undefined;
  return {
    inline_keyboard: buttons.map((row) =>
      row.map((b) => (b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.data ?? b.text })),
    ),
  };
}

export const telegramProvider: PhoneProvider = {
  name: "telegram",

  isConfigured() {
    return !!TOKEN() && !!ALLOWED();
  },

  verifySender(chatId: string) {
    const allowed = ALLOWED();
    return !!allowed && String(chatId) === allowed;
  },

  handleWebhook(body: unknown): IncomingMessage | null {
    const u = body as {
      message?: { chat?: { id?: number | string }; text?: string; message_id?: number };
      callback_query?: {
        id?: string;
        data?: string;
        message?: { chat?: { id?: number | string }; message_id?: number };
        from?: { id?: number | string };
      };
    };
    if (u?.callback_query) {
      const cq = u.callback_query;
      const chatId = cq.message?.chat?.id ?? cq.from?.id;
      if (chatId == null) return null;
      return {
        chatId: String(chatId),
        text: "",
        isCallback: true,
        callbackData: cq.data ?? "",
        callbackQueryId: cq.id,
        messageId: cq.message?.message_id,
      };
    }
    if (u?.message && typeof u.message.text === "string") {
      const chatId = u.message.chat?.id;
      if (chatId == null) return null;
      return { chatId: String(chatId), text: u.message.text, isCallback: false, messageId: u.message.message_id };
    }
    return null;
  },

  parseIncomingCommand(text: string): ParsedCommand {
    const raw = (text ?? "").trim();
    if (!raw.startsWith("/")) return { command: null, args: raw, raw };
    const m = raw.match(/^\/([A-Za-z0-9_]+)(?:@\w+)?\s*([\s\S]*)$/); // strip /cmd@botname
    if (!m) return { command: null, args: raw, raw };
    return { command: m[1].toLowerCase(), args: (m[2] ?? "").trim(), raw };
  },

  async sendMessage(text, opts) {
    return tg("sendMessage", {
      chat_id: opts?.chatId ?? ALLOWED(),
      text: text.slice(0, 4000),
      disable_web_page_preview: true,
      reply_markup: toInlineKeyboard(opts?.buttons),
    });
  },

  async sendStatusUpdate(text, opts) {
    return this.sendMessage(text, { chatId: opts?.chatId });
  },

  async sendApprovalRequest(a, opts) {
    const { text, buttons } = this.formatDecisionMessage(a);
    return this.sendMessage(text, { buttons, chatId: opts?.chatId });
  },

  async answerCallback(callbackQueryId, text) {
    if (!callbackQueryId) return;
    await tg("answerCallbackQuery", { callback_query_id: callbackQueryId, text: text?.slice(0, 200) });
  },

  formatDecisionMessage(a: Approval) {
    const lines = [
      `🔐 Approval needed: ${a.kind.replace(/_/g, " ")}`,
      a.summary ? `• ${a.summary}` : "",
      a.agent_id ? `• agent: ${a.agent_id}` : "",
      a.issue ? `• issue: #${a.issue}` : "",
      a.pr ? `• PR: #${a.pr}` : "",
      a.risk ? `• risk: ${a.risk}` : "",
      a.advice ? `• advice: ${a.advice}` : "",
      a.diff_preview ? `\ncontext:\n${a.diff_preview}` : "",
      a.expires_at ? `\nexpires: ${a.expires_at}` : "",
    ].filter(Boolean);
    const buttons: Button[][] = [
      [
        { text: "✅ Approve", data: `apv:${a.id}:approve` },
        { text: "❌ Reject", data: `apv:${a.id}:reject` },
      ],
      [
        { text: "ℹ️ More info", data: `apv:${a.id}:info` },
        { text: "👔 Let manager decide", data: `apv:${a.id}:manager` },
      ],
      [{ text: "⏸ Pause task", data: `apv:${a.id}:pause` }],
    ];
    if (PUBLIC_URL()) buttons.push([{ text: "🖥 Open dashboard", url: `${PUBLIC_URL()}/?approval=${a.id}` }]);
    return { text: lines.join("\n"), buttons };
  },

  formatStatusMessage(s: StatusSummary) {
    const head = s.online ? (s.claiming ? "🟢 running" : `🟡 ${s.pauseReason ?? "paused"}`) : "🔴 offline";
    const slots = s.slots.length
      ? s.slots.map((sl) => `  • #${sl.issue ?? "?"} ${sl.phase ?? "-"}${sl.title ? ` — ${sl.title}` : ""}`).join("\n")
      : "  • (idle)";
    return [
      `Fleet: ${head}  ·  mode=${s.mode}  ·  workers=${s.workers}`,
      `PRs today: ${s.prsToday}  ·  breaker: ${s.breakerTripped ? "TRIPPED" : "ok"}  ·  pending approvals: ${s.pendingApprovals}`,
      `workers:\n${slots}`,
    ].join("\n");
  },
};
