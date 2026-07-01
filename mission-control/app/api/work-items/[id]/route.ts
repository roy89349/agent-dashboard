import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { getWorkItem, updateWorkItem, childWorkItems, httpStatusOf, type WorkItemPatch } from "@/lib/work-items";
import { listMessagesForWorkItem } from "@/lib/agent-messages";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}

// GET → one work item + its children + its handoff/message timeline.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const workItem = getWorkItem(id);
  if (!workItem) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ workItem, children: childWorkItems(id), messages: listMessagesForWorkItem(id) });
}

// PATCH → update state/priority/risk/assignment/etc (validated + audited). assign/complete/block are covered
// by patching the relevant fields (e.g. {state:"done", pr} / {state:"blocked"} / {assigned_agent_id,...}).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const patch = (await req.json().catch(() => ({}))) as WorkItemPatch;
  try {
    const workItem = updateWorkItem(id, { ...patch, actor: "dashboard" });
    return NextResponse.json({ workItem });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: httpStatusOf(e) });
  }
}
