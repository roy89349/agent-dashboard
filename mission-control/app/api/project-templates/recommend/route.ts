import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { recommendTeamForProject, validateTemplateRecommendation, ptStatusOf, type WizardInput } from "@/lib/project-templates";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}
// POST → a full team recommendation for the wizard inputs (rule-based) + its validation.
export async function POST(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as WizardInput;
  try {
    const recommendation = recommendTeamForProject(body);
    return NextResponse.json({ recommendation, validation: validateTemplateRecommendation(recommendation) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: ptStatusOf(e) });
  }
}
