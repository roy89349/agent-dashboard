import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { listFeedback, recordFeedback, memStatusOf } from "@/lib/agent-memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}

// GET → this agent's feedback history. POST → record feedback (mints a visible memory item).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  return NextResponse.json({ feedback: listFeedback(id) });
}
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    return NextResponse.json(recordFeedback({ ...body, agent_id: id, created_by: "roy" }), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: memStatusOf(e) });
  }
}
