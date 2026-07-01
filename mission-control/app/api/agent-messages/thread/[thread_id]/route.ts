import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { listThread } from "@/lib/agent-messages";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET → the full ordered message thread.
export async function GET(_req: Request, { params }: { params: Promise<{ thread_id: string }> }) {
  const c = await cookies();
  if (!(await verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { thread_id } = await params;
  return NextResponse.json({ messages: listThread(thread_id) });
}
