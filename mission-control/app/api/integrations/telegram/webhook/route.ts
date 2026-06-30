import { NextResponse } from "next/server";
import { getProvider } from "@/lib/phone";
import { routeCommand } from "@/lib/phone/commands";
import { executeCommand } from "@/lib/phone/execute";
import { recordAudit, setSetting } from "@/lib/db";
import { redact } from "@/lib/redact";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// PUBLIC route (Telegram has no cookie). Self-authenticates: optional webhook secret header +
// verifySender(chat id). Always returns 200 so Telegram does not retry on our errors.
export async function POST(req: Request) {
  const provider = getProvider();
  if (!provider || !provider.isConfigured()) return NextResponse.json({ ok: true }); // unconfigured → accept + ignore

  const secret = (process.env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();
  if (secret && req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ ok: true }); // wrong/missing secret → ignore silently
  }

  const body = await req.json().catch(() => null);
  const incoming = provider.handleWebhook(body);
  if (!incoming) return NextResponse.json({ ok: true });

  if (!provider.verifySender(incoming.chatId)) {
    recordAudit({
      actor: incoming.chatId,
      via: "telegram",
      action: "phone.unauthorized",
      detail: redact(String(incoming.text || incoming.callbackData || "").slice(0, 80)),
    });
    return NextResponse.json({ ok: true }); // unknown sender → no sensitive info, no reply
  }

  setSetting(
    "phone_last_command",
    JSON.stringify({
      ts: new Date().toISOString(),
      text: redact(String(incoming.text || incoming.callbackData || "").slice(0, 160)),
    }),
  );
  try {
    if (incoming.isCallback && incoming.callbackQueryId) await provider.answerCallback(incoming.callbackQueryId);
    const plan = routeCommand(provider, incoming);
    const reply = await executeCommand(provider, plan, incoming.chatId);
    await provider.sendMessage(reply.text, { buttons: reply.buttons, chatId: incoming.chatId });
  } catch (e) {
    setSetting("phone_last_error", JSON.stringify({ ts: new Date().toISOString(), error: e instanceof Error ? e.message : "error" }));
    await provider.sendMessage("⚠️ Something went wrong handling that.", { chatId: incoming.chatId }).catch(() => {});
  }
  return NextResponse.json({ ok: true });
}
