import { NextResponse, type NextRequest } from "next/server";
import { verifySession } from "@/lib/session";

// Next.js 16 Proxy (formerly Middleware): single-user gate.
// Everything except /login + /api/login requires a valid mc_session cookie.
// The phone webhook is public (no browser cookie) — it authenticates itself via the provider's
// allowed chat/user id + an optional webhook secret (see app/api/integrations/*/webhook).
const PUBLIC = ["/login", "/api/login", "/api/integrations/telegram/webhook", "/api/integrations/whatsapp/webhook"];
// Token-authenticated endpoints: these routes validate their own secret header FAIL-CLOSED
// (401 without a valid MC_WATCHDOG_TOKEN / AGENT_GATEWAY_TOKEN), so the proxy must not bounce
// their cookie-less callers (the systemd watchdog timer, the on-host agent runner) to /login.
const SELF_AUTHED = ["/api/fleet/watchdog", "/api/agent/act", "/api/fleet/pr-visual", "/api/communication/digest"];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (SELF_AUTHED.some((p) => pathname === p)) return NextResponse.next();
  const ok = await verifySession(
    req.cookies.get("mc_session")?.value,
    process.env.MC_SESSION_SECRET!,
  );
  if (ok) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg)$).*)",
  ],
};
