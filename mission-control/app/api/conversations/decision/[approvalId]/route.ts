import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { threadForApproval, convStatusOf } from "@/lib/conversations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}
// POST → get-or-create the decision thread for an approval (the "Discuss" button on the Decision Inbox). The
// approval stays the source of truth; this is the linked discussion layer.
export async function POST(_req: Request, { params }: { params: Promise<{ approvalId: string }> }) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { approvalId } = await params;
  try {
    return NextResponse.json({ thread: threadForApproval(approvalId, { create: true }) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: convStatusOf(e) });
  }
}
