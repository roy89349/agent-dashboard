import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { readStatus } from "@/lib/fleet";

export const dynamic = "force-dynamic";

// Live view: who's doing what + effective knobs + breaker/day-cap/budget. Server-side behind the cookie.
export async function GET() {
  const c = await cookies();
  if (!(await verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ status: readStatus() });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
