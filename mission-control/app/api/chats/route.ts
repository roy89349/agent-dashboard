import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "node:crypto";
import { verifySession } from "@/lib/session";
import { listConversations, createConversation } from "@/lib/db";

export const dynamic = "force-dynamic";

async function authed() {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}

// GET → list orchestrator conversations (newest first).
export async function GET() {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ conversations: listConversations("orchestrator") });
}

// POST → new orchestrator conversation; reserves a session id up front for --resume.
export async function POST(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const id = crypto.randomUUID();
  createConversation({
    id,
    kind: "orchestrator",
    session_id: crypto.randomUUID(),
    title: typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 80) : null,
    model: typeof body.model === "string" ? body.model : "sonnet",
    effort: typeof body.effort === "string" ? body.effort : "medium",
  });
  return NextResponse.json({ id });
}
