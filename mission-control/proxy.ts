import { NextResponse, type NextRequest } from "next/server";
import { verifySession } from "@/lib/session";

// Next.js 16 Proxy (formerly Middleware): single-user gate.
// Everything except /login + /api/login requires a valid mc_session cookie.
const PUBLIC = ["/login", "/api/login"];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();
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
