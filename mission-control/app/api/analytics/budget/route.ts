import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { getBudgetConfig, getCostModel, setBudgetConfig, checkBudgetsAndEscalate } from "@/lib/costs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}
// GET → the budget + cost-model config. POST → update it, and (if `check`) escalate any exceeded budgets.
export async function GET() {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ budget: getBudgetConfig(), model: getCostModel() });
}
export async function POST(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const saved = setBudgetConfig(body, "dashboard");
  const escalated = body.check ? checkBudgetsAndEscalate("dashboard").escalated : [];
  return NextResponse.json({ ...saved, escalated });
}
