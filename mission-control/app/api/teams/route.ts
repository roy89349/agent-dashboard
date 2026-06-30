import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { readTeams, writeTeams, httpStatusOf, type TeamsPatchInput } from "@/lib/teams";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}

// Read teams (control/teams.json → deploy/teams.default.json fallback; never 500).
export async function GET() {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const file = readTeams();
  return NextResponse.json({ teams: file.teams, rev: file.rev });
}

// Write teams: upsert (merge) / remove / replace (confirm:true). CAS on rev. All dangerous settings
// (referential integrity, reports_to cycle, auto-merge gate, per-agent budget) validated server-side.
export async function POST(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const { patch, baseRev, confirm } = body as { patch?: TeamsPatchInput; baseRev?: number; confirm?: boolean };
  if (!patch || typeof patch !== "object")
    return NextResponse.json({ error: "patch missing" }, { status: 400 });
  try {
    const rev = writeTeams(patch, baseRev as number, confirm);
    return NextResponse.json({ rev });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: httpStatusOf(e) });
  }
}
