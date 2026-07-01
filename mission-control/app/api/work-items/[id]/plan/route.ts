import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { submitPlan, httpStatusOf, type Plan } from "@/lib/plans";
import { publicApproval } from "@/lib/approvals";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Auth: a dashboard session OR the internal X-Agent-Token — an agent in plan_only mode submits its plan here
// (submitting a plan is a SANCTIONED plan-only action; it mutates nothing but the work item's plan fields).
async function authed(req: Request): Promise<boolean> {
  const tok = (process.env.AGENT_GATEWAY_TOKEN ?? "").trim();
  if (tok && req.headers.get("x-agent-token") === tok) return true;
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}

// POST → submit a structured plan for the work item → raises a plan_signoff approval (Decision Inbox + phone).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await authed(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const plan = (body?.plan ?? body) as Partial<Plan>;
  const actor = typeof body?.actor === "string" ? body.actor : "dashboard";
  try {
    const { workItem, approval } = submitPlan(id, plan, actor);
    return NextResponse.json({ workItem, approval: publicApproval(approval) }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: httpStatusOf(e) });
  }
}
