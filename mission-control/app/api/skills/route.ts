import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { readSkills, writeSkills, httpStatusOf, type SkillsPatchInput } from "@/lib/skills";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}

// Read the skill library (control/skills.json → deploy/skills.default.json fallback; never 500).
export async function GET() {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const file = readSkills();
  return NextResponse.json({ skills: file.skills, rev: file.rev });
}

// Write: upsert (merge) / remove / replace (confirm:true). CAS on rev. Skills are capabilities (metadata);
// linking them to agents (Agent.skill_ids) goes through POST /api/agents.
export async function POST(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const { patch, baseRev, confirm } = body as { patch?: SkillsPatchInput; baseRev?: number; confirm?: boolean };
  if (!patch || typeof patch !== "object")
    return NextResponse.json({ error: "patch missing" }, { status: 400 });
  try {
    const rev = writeSkills(patch, baseRev as number, confirm);
    return NextResponse.json({ rev });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: httpStatusOf(e) });
  }
}
