import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { getApproval, publicApproval } from "@/lib/approvals";
import { listAuditForApproval } from "@/lib/db";
import { isPhoneConfigured, providerName } from "@/lib/phone";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Full (redacted) detail for ONE approval: the row, its audit trail, and phone-notification status.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await cookies();
  if (!(await verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const approval = getApproval(id);
  if (!approval) return NextResponse.json({ error: "not found" }, { status: 404 });

  let notified: string[] = [];
  try {
    const p = JSON.parse(approval.notification_ids_json ?? "null");
    if (Array.isArray(p)) notified = p.map(String);
  } catch {
    /* ignore */
  }

  return NextResponse.json({
    approval: publicApproval(approval),
    audit: listAuditForApproval(id),
    notification: {
      provider: providerName(),
      phoneConfigured: isPhoneConfigured(),
      // if it was pushed we have message ids; otherwise it's deliverable iff the phone is configured.
      delivered: notified.length > 0,
      messageIds: notified,
    },
  });
}
