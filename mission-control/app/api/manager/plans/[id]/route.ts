import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { getManagerPlan } from "@/lib/manager";
import { getWorkItem, childWorkItems } from "@/lib/work-items";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}

// GET → one manager plan with its parent work item + materialised children (the parent/child overview).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const managerPlan = getManagerPlan(id);
  if (!managerPlan) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ managerPlan, workItem: getWorkItem(managerPlan.work_item_id), children: childWorkItems(managerPlan.work_item_id) });
}
