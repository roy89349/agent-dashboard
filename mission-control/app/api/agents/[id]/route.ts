import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { agentById } from "@/lib/agents";
import { teamForAgent } from "@/lib/teams";
import { buildAgentPerformance } from "@/lib/agent-performance";
import { memoryProfile, listFeedback } from "@/lib/agent-memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}

// GET → the full agent-detail bundle: identity + performance + grouped memory + feedback + recent tasks.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const agent = agentById(id);
  if (!agent) return NextResponse.json({ error: "not found" }, { status: 404 });
  const team = teamForAgent(id);
  const performance = buildAgentPerformance(id).agents[0] ?? null;
  return NextResponse.json({
    agent, team: team ? { id: team.id, name: team.name } : null,
    performance,
    memory: memoryProfile(id, team?.id ?? null),
    feedback: listFeedback(id, 50),
    recent: performance?.last_10 ?? [],
  });
}
