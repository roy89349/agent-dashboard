import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { decideApproval, getApproval, publicApproval, approvalErrorStatus } from "@/lib/approvals";
import { runApprovalAction } from "@/lib/phone/actions";
import { handlePlanRejection } from "@/lib/plans";
import { recordAudit } from "@/lib/db";
import { appendCommand } from "@/lib/fleet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The same decision verbs the phone uses. approve/reject/pause all go through decideApproval();
// pause additionally cancels the underlying task; manager defers (no state change, audited).
const ACTIONS = new Set(["approve", "reject", "pause", "manager"]);
// only these may ever be authorized by a bare one-time token (no session) — the safe phone verbs:
const TOKEN_ACTIONS = new Set(["approve", "reject"]);

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
  if (!b.id || !b.action || !ACTIONS.has(b.action))
    return NextResponse.json({ error: "id and action (approve|reject|pause|manager) required" }, { status: 400 });

  // auth: a valid session is trusted; otherwise only the safe token verbs are allowed (and only with a token).
  const tokenOnly = !sessionOk;
  if (tokenOnly && (!b.token || !TOKEN_ACTIONS.has(b.action)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    // ── defer to the manager: no decision, just an audited note; the row stays pending ──
    if (b.action === "manager") {
      const a = getApproval(b.id);
      if (!a) return NextResponse.json({ error: "approval not found" }, { status: 404 });
      if (a.status !== "pending")
        return NextResponse.json({ error: `already ${a.status}` }, { status: 409 });
      recordAudit({
        actor: "dashboard", via: "dashboard", action: "approval.defer_manager",
        kind: a.kind, approval_id: a.id, issue: a.issue, detail: "deferred to manager via dashboard",
      });
      return NextResponse.json({
        approval: publicApproval(getApproval(b.id)!),
        action: { ok: true, detail: "deferred to manager" },
      });
    }

    // ── pause: reject the approval AND cancel the underlying task (same as the phone's Pause button) ──
    if (b.action === "pause") {
      const pre = getApproval(b.id); // capture the PRE-decision status: only side-effect on the real transition
      const decided = decideApproval(b.id, "reject", {
        via: "dashboard", by: "dashboard", trusted: true, reason: b.reason ?? "paused via dashboard",
      });
      let detail = "paused (approval dismissed)";
      if (decided.issue != null) {
        appendCommand({ cmd: "cancel", issue: decided.issue });
        detail = `paused and cancelled #${decided.issue}`;
      }
      if (pre?.status === "pending") handlePlanRejection(decided, "dashboard"); // a paused plan → block the work item + feedback
      return NextResponse.json({ approval: publicApproval(decided), action: { ok: true, detail } });
    }

    // ── approve / reject (token OR session) ──
    // decideApproval is idempotent (re-deciding returns the row without throwing), so guard the SIDE EFFECTS on
    // the actual pending→decided transition — a re-tapped Approve must not re-run runApprovalAction (which would
    // replay approve_plan / open a duplicate task) and a re-tapped Reject must not re-block.
    const pre = getApproval(b.id);
    const firstDecision = pre?.status === "pending";
    const decided = decideApproval(
      b.id,
      b.action as "approve" | "reject",
      sessionOk
        ? { via: "dashboard", by: "dashboard", trusted: true, reason: b.reason }
        : { via: "api", by: "token", token: b.token, reason: b.reason },
    );
    const actionResult = b.action === "approve" && firstDecision ? await runApprovalAction(decided) : null;
    if (b.action === "reject" && firstDecision) handlePlanRejection(decided, "dashboard"); // a rejected plan → block + feedback
    return NextResponse.json({ approval: publicApproval(decided), action: actionResult });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "error" },
      { status: approvalErrorStatus(e) },
    );
  }
}
