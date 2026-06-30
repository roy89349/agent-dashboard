import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { phoneStatus, getProvider, isPhoneConfigured } from "@/lib/phone";
import { getSetting } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}

// Non-secret phone/integration status for the Config screen.
export async function GET() {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const base = (process.env.MC_PUBLIC_URL ?? "").trim().replace(/\/+$/, "");
  const st = phoneStatus();
  let lastCommand: unknown = null;
  let lastError: unknown = null;
  try { lastCommand = JSON.parse(getSetting("phone_last_command") || "null"); } catch {}
  try { lastError = JSON.parse(getSetting("phone_last_error") || "null"); } catch {}
  return NextResponse.json({
    ...st,
    webhookUrl: base ? base + st.webhookPath : st.webhookPath,
    publicUrlSet: !!base,
    allowedChatSet: !!(process.env.TELEGRAM_ALLOWED_CHAT_ID ?? "").trim(),
    lastCommand,
    lastError,
  });
}

// Send a test message to the configured chat.
export async function POST() {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isPhoneConfigured()) return NextResponse.json({ error: "phone provider not configured" }, { status: 400 });
  const r = await getProvider()!.sendMessage("✅ Mission Control test — your phone command center is connected. Send /help.");
  return NextResponse.json(r, { status: r.ok ? 200 : 502 });
}
