import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { createTaskFromChat, createDecisionFromChat, assignToAgent, sendToManager, convStatusOf } from "@/lib/conversations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}
// POST → a chat action: create_task | create_decision | assign | send_to_manager. Bridges to the real services.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  try {
    switch (b.action) {
      case "create_task": return NextResponse.json(createTaskFromChat({ conversation_id: id, title: b.title, description: b.description, team_id: b.team_id, created_by: "roy" }), { status: 201 });
      case "create_decision": return NextResponse.json(createDecisionFromChat({ conversation_id: id, question: b.question, advice: b.advice, work_item_id: b.work_item_id, created_by: "roy" }), { status: 201 });
      case "assign": return NextResponse.json(assignToAgent({ conversation_id: id, to_agent_id: b.to_agent_id, to_role: b.to_role, title: b.title, note: b.note, created_by: "roy" }), { status: 201 });
      case "send_to_manager": return NextResponse.json(sendToManager({ conversation_id: id, note: b.note, work_item_id: b.work_item_id, created_by: "roy" }), { status: 201 });
      default: return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: convStatusOf(e) });
  }
}
