import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { listMemory, addMemory, memStatusOf, type MemoryType } from "@/lib/agent-memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}

// GET → this agent's memory (include archived with ?all=1). POST → add a memory item.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const q = new URL(req.url).searchParams;
  return NextResponse.json({ memory: listMemory({ agent_id: id, type: (q.get("type") as MemoryType) ?? undefined, include_archived: q.get("all") === "1" }) });
}
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    return NextResponse.json({ memory: addMemory({ ...body, agent_id: id, created_by: "roy" }) }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: memStatusOf(e) });
  }
}
