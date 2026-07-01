import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { listRecentAgentMessages, listMessagesForWorkItem } from "@/lib/agent-messages";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}
// Agent Logs tab — surfaces the EXISTING agent_messages timeline (no new store), optionally scoped to an agent or
// work item. Read-only, deliberately less prominent than Team Chat.
export async function GET(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const workItem = q.get("work_item_id");
  const agentId = q.get("agent_id");
  let logs = workItem ? listMessagesForWorkItem(workItem) : listRecentAgentMessages(150);
  if (agentId) logs = logs.filter((m) => m.from_agent_id === agentId || m.to_agent_id === agentId);
  return NextResponse.json({ logs });
}
