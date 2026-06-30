import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { decideApproval, publicApproval, approvalErrorStatus } from "@/lib/approvals";
import { runApprovalAction } from "@/lib/phone/actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Decide an approval from the dashboard (session = trusted) or via a one-time decision token.
export async function POST(req: Request) {
  const c = await cookies();
  const sessionOk = await verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
  let b: { id?: string; action?: string; token?: string; reason?: string };
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }
  if (!b.id || (b.action !== "approve" && b.action !== "reject"))
    return NextResponse.json({ error: "id and action (approve|reject) required" }, { status: 400 });
  // auth: a valid session is trusted; otherwise a one-time token must validate inside decideApproval.
  if (!sessionOk && !b.token)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const decided = decideApproval(
      b.id,
      b.action,
      sessionOk
        ? { via: "dashboard", by: "dashboard", trusted: true, reason: b.reason }
        : { via: "api", by: "token", token: b.token, reason: b.reason },
    );
    const actionResult = b.action === "approve" ? await runApprovalAction(decided) : null;
    return NextResponse.json({ approval: publicApproval(decided), action: actionResult });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "error" },
      { status: approvalErrorStatus(e) },
    );
  }
}
