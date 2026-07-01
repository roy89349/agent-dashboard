import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { buildKpis } from "@/lib/kpis";
import type { Period } from "@/lib/analytics-shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}
export async function GET(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  return NextResponse.json(buildKpis({ period: (q.get("period") as Period) ?? undefined, team_id: q.get("team_id"), agent_id: q.get("agent_id"), workflow_id: q.get("workflow_id") }));
}
