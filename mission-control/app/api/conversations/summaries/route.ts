import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { listSummaries, generateSummary, type SummaryType } from "@/lib/communication";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}
// Daily Summaries tab — surfaces the EXISTING communication_summaries (no new store). GET list, POST generate one.
export async function GET(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  return NextResponse.json({ summaries: listSummaries({ type: (q.get("type") as SummaryType) ?? undefined, limit: 50 }) });
}
export async function POST(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const type: SummaryType = ["daily_standup", "end_of_day", "live", "hourly"].includes(body.type) ? body.type : "daily_standup";
  try {
    return NextResponse.json({ summary: generateSummary({ type, notify: false, created_by: "roy" }) }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
