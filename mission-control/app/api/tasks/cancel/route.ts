import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { cancelQueuedIssue } from "@/lib/github";

// Withdraw a pending (not-yet-claimed) task. A RUNNING task is cancelled via
// POST /api/fleet/command {cmd:"cancel"} (which touches the process).
export async function POST(req: Request) {
  const c = await cookies();
  if (!(await verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { issue } = await req.json().catch(() => ({}));
  if (!issue || typeof issue !== "number")
    return NextResponse.json({ error: "issue missing" }, { status: 400 });
  try {
    await cancelQueuedIssue(issue);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
