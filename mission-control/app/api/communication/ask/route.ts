import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { askTeam } from "@/lib/communication";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}

// POST → ask the team a question; the Communication Agent searches the floor and answers short, with links.
export async function POST(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!body?.question || typeof body.question !== "string") return NextResponse.json({ error: "question required" }, { status: 400 });
  return NextResponse.json(askTeam(body.question, body.team_id ?? null));
}
