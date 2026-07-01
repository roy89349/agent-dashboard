import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { proposeDecomposition, httpStatusOf } from "@/lib/manager";
import { publicApproval } from "@/lib/approvals";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Auth: a dashboard session OR the internal X-Agent-Token — a Manager agent in the fleet proposes a plan here.
async function authed(req: Request): Promise<boolean> {
  const tok = (process.env.AGENT_GATEWAY_TOKEN ?? "").trim();
  if (tok && req.headers.get("x-agent-token") === tok) return true;
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}

// POST → propose a decomposition (validate + park the parent in plan_only/review + raise a plan_signoff approval).
export async function POST(req: Request) {
  if (!(await authed(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    const { workItem, managerPlan, approval } = proposeDecomposition({
      work_item_id: body.work_item_id ?? null,
      title: body.title ?? null,
      description: body.description ?? null,
      source: body.source ?? "dashboard",
      source_ref: body.source_ref ?? null,
      plan: body.plan ?? undefined,
      seed_template_id: body.seed_template_id ?? null,
      created_by: body.created_by ?? "manager",
    });
    return NextResponse.json({ workItem, managerPlan, approval: publicApproval(approval) }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: httpStatusOf(e) });
  }
}
