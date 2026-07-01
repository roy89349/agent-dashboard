import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { postMessage, convStatusOf, MESSAGE_TYPES, type MessageType } from "@/lib/conversations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}
// POST → add a (non-Claude) message to a thread — used for decision-thread comments + notes. Team/Task CHAT keeps
// using /api/chats/[id]/message (which runs Claude). This never invokes an agent, so it's cheap + noise-free.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const content = String(body.content ?? "").trim();
  if (!content) return NextResponse.json({ error: "content required" }, { status: 400 });
  const type: MessageType = MESSAGE_TYPES.includes(body.type) ? body.type : "answer";
  try {
    const message_id = postMessage({ conversation_id: id, role: body.role === "system" ? "system" : "user", type, content, agent_id: body.agent_id ?? null });
    return NextResponse.json({ message_id }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: convStatusOf(e) });
  }
}
