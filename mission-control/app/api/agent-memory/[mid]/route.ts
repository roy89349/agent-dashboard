import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { updateMemory, archiveMemory, memStatusOf } from "@/lib/agent-memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}

// PATCH → edit a memory item (title/content/type/enable). DELETE → archive it (visible, reversible-by-design soft delete).
export async function PATCH(req: Request, { params }: { params: Promise<{ mid: string }> }) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { mid } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    return NextResponse.json({ memory: updateMemory(mid, { ...body, actor: "roy" }) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: memStatusOf(e) });
  }
}
export async function DELETE(_req: Request, { params }: { params: Promise<{ mid: string }> }) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { mid } = await params;
  try {
    return NextResponse.json({ memory: archiveMemory(mid, "roy") });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: memStatusOf(e) });
  }
}
