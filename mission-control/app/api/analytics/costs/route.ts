import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { estimateUsage, budgetStatus, type UsageGroup } from "@/lib/costs";
import type { Period } from "@/lib/analytics-shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}
// GET → estimated usage (grouped) + the budget dashboard. Everything is flagged is_estimate.
export async function GET(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const usage = estimateUsage({ period: (q.get("period") as Period) ?? undefined, groupBy: (q.get("groupBy") as UsageGroup) ?? undefined });
  return NextResponse.json({ usage, budget: budgetStatus() });
}
