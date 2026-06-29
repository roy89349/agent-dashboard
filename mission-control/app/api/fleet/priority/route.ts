import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { prioritizeIssue, httpStatusOf } from "@/lib/fleet";

export const dynamic = "force-dynamic";

// POST {issue, toFront?} → shift the claim order. Server does the locked read-modify-write.
export async function POST(req: Request) {
  const c = await cookies();
  if (!(await verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { issue, toFront } = await req.json().catch(() => ({}));
  if (!issue || typeof issue !== "number")
    return NextResponse.json({ error: "issue missing" }, { status: 400 });
  try {
    const rev = prioritizeIssue(issue, toFront !== false);
    return NextResponse.json({ rev });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: httpStatusOf(e) },
    );
  }
}
