import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { readStatus } from "@/lib/fleet";
import { listPendingApprovals } from "@/lib/approvals";
import { riskLevel } from "@/lib/approvals-view";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Live view: who's doing what + effective knobs + breaker/day-cap/budget. Server-side behind the cookie.
// Slots are enriched in one shot with the "waiting for approval" flag + risk level (no extra client poll).
export async function GET() {
  const c = await cookies();
  if (!(await verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const status = readStatus();
    if (status) {
      let pendByIssue: Map<number, { kind: string; risk: string | null }> | null = null;
      try {
        pendByIssue = new Map(
          listPendingApprovals()
            .filter((a) => a.issue != null)
            .map((a) => [a.issue as number, { kind: a.kind, risk: a.risk }]),
        );
      } catch {
        /* approvals store unavailable → skip enrichment, slots still render */
      }
      if (pendByIssue && pendByIssue.size) {
        status.slots = status.slots.map((s) => {
          const a = s.issue != null ? pendByIssue!.get(s.issue) : undefined;
          return a ? { ...s, awaiting_approval: true, risk_level: riskLevel(a) } : s;
        });
      }
    }
    return NextResponse.json({ status });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
