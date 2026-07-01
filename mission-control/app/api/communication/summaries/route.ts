import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { listSummaries, generateSummary, httpStatusOf, type SummaryType } from "@/lib/communication";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Auth: a dashboard session OR the internal X-Agent-Token — a Communication agent in the fleet may push updates.
async function authed(req: Request): Promise<boolean> {
  const tok = (process.env.AGENT_GATEWAY_TOKEN ?? "").trim();
  if (tok && req.headers.get("x-agent-token") === tok) return true;
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}

// GET → the summaries feed (filter by type / team). POST → generate a fresh summary (optionally phone-notify).
export async function GET(req: Request) {
  if (!(await authed(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  return NextResponse.json({ summaries: listSummaries({ type: (q.get("type") as SummaryType) ?? undefined, team_id: q.get("team_id") ?? undefined }) });
}
export async function POST(req: Request) {
  if (!(await authed(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    // default authorship to the agent identity (the token path), not a human — matches the escalate route.
    return NextResponse.json({ summary: generateSummary({ type: body.type, team_id: body.team_id ?? null, created_by: body.created_by ?? "communication", notify: !!body.notify }) }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: httpStatusOf(e) });
  }
}
