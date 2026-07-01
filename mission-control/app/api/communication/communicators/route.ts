import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { listCommunicators, setCommunicator } from "@/lib/communication";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}

// GET → each team's communication agent. POST {team_id, agent_id} → set it (agent_id null = default to the lead).
export async function GET() {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ communicators: listCommunicators() });
}
export async function POST(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!body?.team_id) return NextResponse.json({ error: "team_id required" }, { status: 400 });
  setCommunicator(String(body.team_id), body.agent_id ?? null, "dashboard");
  return NextResponse.json({ communicators: listCommunicators() });
}
