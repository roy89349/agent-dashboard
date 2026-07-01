import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { listManagerPlans, type ManagerPlan } from "@/lib/manager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}

// GET → list manager plans (filter by status / work item).
export async function GET(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  return NextResponse.json({
    plans: listManagerPlans({ status: (q.get("status") as ManagerPlan["status"]) ?? undefined, work_item_id: q.get("work_item_id") ?? undefined }),
  });
}
