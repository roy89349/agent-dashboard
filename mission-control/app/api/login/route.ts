import { NextResponse } from "next/server";
import { mintSession } from "@/lib/session";

// Naive in-memory rate limit (per server instance). For real coverage, also put a
// firewall rate-limit rule / access control in front of the app when deployed.
const hits = new Map<string, { n: number; t: number }>();
const WINDOW = 60_000;
const MAX = 8;
const MAX_KEYS = 5000; // bound the Map (memory-DoS via many distinct/spoofed IPs)

function limited(ip: string): boolean {
  const now = Date.now();
  if (hits.size > MAX_KEYS) {
    for (const [k, v] of hits) if (now - v.t > WINDOW) hits.delete(k); // sweep expired
    if (hits.size > MAX_KEYS) hits.clear(); // hard emergency brake
  }
  const cur = hits.get(ip);
  if (!cur || now - cur.t > WINDOW) {
    hits.set(ip, { n: 1, t: now });
    return false;
  }
  cur.n += 1;
  return cur.n > MAX;
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (limited(ip)) {
    return NextResponse.json(
      { ok: false, error: "Too many attempts, try again later" },
      { status: 429 },
    );
  }
  const { password } = await req.json().catch(() => ({ password: "" }));
  if (!password || password !== process.env.MC_DASHBOARD_PASSWORD) {
    return NextResponse.json({ ok: false, error: "Wrong password" }, { status: 401 });
  }
  const token = await mintSession(process.env.MC_SESSION_SECRET!);
  const res = NextResponse.json({ ok: true });
  res.cookies.set("mc_session", token, {
    httpOnly: true,
    // Safari rejects a Secure cookie over http://localhost; only enforce it in production (https).
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });
  return res;
}
