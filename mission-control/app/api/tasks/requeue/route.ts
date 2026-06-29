import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { requeueIssue } from "@/lib/github";

export async function POST(req: Request) {
  const c = await cookies();
  if (!(await verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { issue } = await req.json().catch(() => ({}));
  if (!issue || typeof issue !== "number")
    return NextResponse.json({ error: "issue missing" }, { status: 400 });
  try {
    await requeueIssue(issue);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
