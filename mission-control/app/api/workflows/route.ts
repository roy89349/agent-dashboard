import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { listWorkflows, createWorkflowFromTemplate, httpStatusOf, type WorkflowFilter, type WorkflowStatus } from "@/lib/workflows";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}

// GET → list workflows (filter by status / work item / team / template).
export async function GET(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const num = (v: string | null): number | undefined => { const n = v === null ? NaN : Number(v); return Number.isFinite(n) ? n : undefined; };
  const f: WorkflowFilter = {
    status: (q.get("status") as WorkflowStatus) ?? undefined,
    work_item_id: q.get("work_item_id") ?? undefined,
    team_id: q.get("team_id") ?? undefined,
    template_id: q.get("template_id") ?? undefined,
    limit: num(q.get("limit")),
  };
  return NextResponse.json({ workflows: listWorkflows(f) });
}

// POST → instantiate a workflow from a template (server-side validated + audited).
export async function POST(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!body?.template_id) return NextResponse.json({ error: "template_id required" }, { status: 400 });
  try {
    const detail = createWorkflowFromTemplate({
      template_id: String(body.template_id),
      work_item_id: body.work_item_id ?? null,
      team_id: body.team_id ?? null,
      title: body.title ?? null,
      created_by: body.created_by ?? "dashboard",
      assignments: body.assignments ?? undefined,
    });
    return NextResponse.json(detail, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: httpStatusOf(e) });
  }
}
