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

// GET → list all conversations (orchestrator + per-task), newest first.
export async function GET() {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ conversations: listConversations() });
}

// POST → new conversation. Default orchestrator; pass {kind:"task", issue} to discuss a build task.
// Reserves a session id up front for --resume.
export async function POST(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const isTask = body.kind === "task" && Number.isInteger(Number(body.issue));
  const issue = isTask ? Math.trunc(Number(body.issue)) : null;
  const id = crypto.randomUUID();
  createConversation({
    id,
    kind: isTask ? "task" : "orchestrator",
    issue,
    session_id: crypto.randomUUID(),
    title:
      typeof body.title === "string" && body.title.trim()
        ? body.title.trim().slice(0, 80)
        : isTask
          ? `Task #${issue}`
          : null,
    model: typeof body.model === "string" ? body.model : "sonnet",
    effort: typeof body.effort === "string" ? body.effort : "medium",
  });
  return NextResponse.json({ id });
}
