import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { listWorkItems, createWorkItem, httpStatusOf, type WorkItemFilter, type CreateWorkItemInput, type WorkItemState, type WorkItemPriority } from "@/lib/work-items";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}

// GET → list work items (filter by state / issue / agent / team / parent). Additive: GitHub issue cards still work.
export async function GET(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const num = (v: string | null): number | undefined => { const n = v === null ? NaN : Number(v); return Number.isFinite(n) ? n : undefined; };
  const f: WorkItemFilter = {
    state: (q.get("state") as WorkItemState) ?? undefined,
    priority: (q.get("priority") as WorkItemPriority) ?? undefined,
    assigned_agent_id: q.get("assigned_agent_id") ?? undefined,
    assigned_role: q.get("assigned_role") ?? undefined,
    team_id: q.get("team_id") ?? undefined,
    issue: num(q.get("issue")),
    parent_task_id: q.get("parent_task_id") ?? undefined,
    limit: num(q.get("limit")),
  };
  return NextResponse.json({ workItems: listWorkItems(f) });
}

// POST → create a work item (server-side validated + redacted + audited).
export async function POST(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Partial<CreateWorkItemInput>;
  if (!body.title) return NextResponse.json({ error: "title required" }, { status: 400 });
  try {
    const wi = createWorkItem({ ...body, title: body.title, created_by: body.created_by ?? "dashboard" });
    return NextResponse.json({ workItem: wi }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: httpStatusOf(e) });
  }
}
