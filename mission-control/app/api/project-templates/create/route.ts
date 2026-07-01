import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { createTeamFromRecommendation, validateTemplateRecommendation, type Recommendation } from "@/lib/project-templates";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}
// map any error carrying a numeric .status (ProjectTemplateError 400/409 · teams.ts HttpError CAS 409 / gate 403 /
// validation 400) to that code; unknown → 500.
const errStatus = (e: unknown): number => (e && typeof (e as { status?: unknown }).status === "number" ? (e as { status: number }).status : 500);

// POST → create a real team (or reusable template) from the (possibly hand-edited) recommendation. Re-validates
// server-side so a tampered draft can't bypass the no-auto-merge-at-high-risk rule. All parsing/validation is in
// the try so a malformed body returns a clean 400, not a 500.
export async function POST(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { recommendation?: Recommendation; asTemplate?: boolean; overwrite?: boolean };
  if (!body?.recommendation?.draft_team) return NextResponse.json({ error: "recommendation required" }, { status: 400 });
  try {
    const validation = validateTemplateRecommendation(body.recommendation);
    if (!validation.ok) return NextResponse.json({ error: validation.errors.join("; "), validation }, { status: 400 });
    const result = createTeamFromRecommendation(body.recommendation, { asTemplate: !!body.asTemplate, overwrite: !!body.overwrite, actor: "roy" });
    return NextResponse.json({ result, validation }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: errStatus(e) });
  }
}
