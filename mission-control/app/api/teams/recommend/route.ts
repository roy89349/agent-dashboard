import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { readAgents } from "@/lib/agents";
import { buildRecommendedTeam } from "@/lib/team-rules";
import { PROJECT_TYPES, type ProjectType } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Read-only compute: turn a project type into a draft team (NOT persisted). The UI previews/edits it,
// then saves via POST /api/teams. No agents.json writes here (Recommend never re-routes the live fleet).
export async function POST(req: Request) {
  const c = await cookies();
  if (!(await verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const projectType = body?.projectType as ProjectType;
  if (!PROJECT_TYPES.includes(projectType))
    return NextResponse.json({ error: "unknown projectType" }, { status: 400 });
  const { draftTeam, missingRoles } = buildRecommendedTeam(projectType, readAgents().agents);
  return NextResponse.json({ draftTeam, missingRoles });
}
