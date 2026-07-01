import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { getKnowledgeItem, updateKnowledgeItem, archiveKnowledgeItem, knowledgeStatusOf } from "@/lib/knowledge-index";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}

// GET → one item. PATCH → edit metadata (type/tags/team/allowed_agents/…). DELETE → archive (soft).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const item = getKnowledgeItem(id);
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ item });
}
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    return NextResponse.json({ item: updateKnowledgeItem(id, { ...body, actor: "dashboard" }) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: knowledgeStatusOf(e) });
  }
}
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    return NextResponse.json({ item: archiveKnowledgeItem(id, "dashboard") });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: knowledgeStatusOf(e) });
  }
}
