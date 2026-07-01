import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { buildWarRoom } from "@/lib/war-room";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ONE read-only snapshot of the whole floor — health + agent activity + a grouped event timeline. The War Room
// page polls just this endpoint (no fan-out, no GitHub/network, no shell-out). Everything is bounded + indexed.
export async function GET() {
  const c = await cookies();
  if (!(await verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(buildWarRoom());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
