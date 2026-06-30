import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { enforce, permissionStatusOf, type Action } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// THE enforcement chokepoint for AGENT-initiated actions. The agent runner (issue→agent→PR→merge) calls
// this BEFORE touching git/GitHub/db/env/deploy; the permission layer decides allow / block-on-approval /
// deny against the agent's autonomy level, granted skills, the action's diff risk, and its team policy.
//   allow            → { allowed:true, decision }                 (caller proceeds)
//   needs approval   → { allowed:false, approvalId, decision }    202 (caller waits for the durable approval)
//   deny             → { allowed:false, denied:true, reason }     403 (caller aborts)
// Auth: a dashboard session OR an internal X-Agent-Token (AGENT_GATEWAY_TOKEN) so the on-host runner can call it.
async function authed(req: Request): Promise<boolean> {
  const tok = (process.env.AGENT_GATEWAY_TOKEN ?? "").trim();
  if (tok && req.headers.get("x-agent-token") === tok) return true;
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}

export async function POST(req: Request) {
  if (!(await authed(req))) return NextResponse.json({ allowed: false, error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const { agentId, teamId, action } = body as { agentId?: string; teamId?: string; action?: Action };
  if (!agentId || typeof agentId !== "string")
    return NextResponse.json({ allowed: false, error: "agentId required" }, { status: 400 });
  if (!action || typeof action !== "object" || typeof (action as { type?: string }).type !== "string")
    return NextResponse.json({ allowed: false, error: "action required" }, { status: 400 });
  // SECURITY: an agent cannot self-attest its own merge diff — drop caller-supplied files so a merge is
  // diff-blind (⇒ high risk ⇒ approval) until a server-resolved PR diff exists. (Other action types keep
  // their files; those are inputs the agent is acting on, not a self-attestation of safety.)
  if ((action as { type?: string }).type === "merge") delete (action as { files?: unknown }).files;
  try {
    const d = await enforce(action, { agentId, teamId, initiator: "agent", via: "fleet", actor: agentId }, { notify: true });
    if (!d.allowed)
      return NextResponse.json({ allowed: false, approvalId: d.approvalId, decision: d.decision }, { status: 202 });
    return NextResponse.json({ allowed: true, decision: d.decision });
  } catch (e) {
    if (permissionStatusOf(e) === 403)
      return NextResponse.json({ allowed: false, denied: true, reason: e instanceof Error ? e.message : "denied" }, { status: 403 });
    return NextResponse.json({ allowed: false, error: String(e) }, { status: 500 });
  }
}
