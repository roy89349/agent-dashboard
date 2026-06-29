import { NextResponse } from "next/server";
import { verifySession } from "@/lib/session";
import { cookies } from "next/headers";
import { getBoard } from "@/lib/board";

// Telemetrie + GitHub-snapshot, server-side achter de mc_session-cookie.
// Het bord pollt dit endpoint (SWR). Geen directe Supabase-toegang in de browser.
export async function GET() {
  const c = await cookies();
  const ok = await verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const cards = await getBoard();
    return NextResponse.json({ cards });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
