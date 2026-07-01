import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { postAgentMessage, listMessagesForWorkItem, listThread, resolveMessage, httpStatusOf, type PostAgentMessageInput, type AgentMessageStatus } from "@/lib/agent-messages";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}

// GET → messages for a work item (?work_item_id=) or a thread (?thread_id=).
export async function GET(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const wi = q.get("work_item_id");
  const thread = q.get("thread_id");
  if (thread) return NextResponse.json({ messages: listThread(thread) });
  if (wi) return NextResponse.json({ messages: listMessagesForWorkItem(wi) });
  return NextResponse.json({ error: "work_item_id or thread_id required" }, { status: 400 });
}

// POST → post a handoff/review/question/etc, OR resolve one ({id, resolve}). requires_human → a durable approval.
export async function POST(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    if (body.id && body.resolve) {
      const message = resolveMessage(body.id as string, body.resolve as AgentMessageStatus, "dashboard");
      return NextResponse.json({ message });
    }
    const input = body as Partial<PostAgentMessageInput>;
    if (!input.type) return NextResponse.json({ error: "type required" }, { status: 400 });
    const message = postAgentMessage({ ...input, type: input.type });
    return NextResponse.json({ message }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: httpStatusOf(e) });
  }
}
