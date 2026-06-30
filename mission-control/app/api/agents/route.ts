import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { readAgents } from "@/lib/agents";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Read-only view of the agent registry (control/agents.json, seeded from deploy/agents.default.json).
export async function GET() {
  const c = await cookies();
  if (!(await verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const file = readAgents();
  return NextResponse.json({ agents: file.agents, rev: file.rev ?? null });
}
