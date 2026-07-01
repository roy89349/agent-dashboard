import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { escalate, httpStatusOf } from "@/lib/communication";
import { publicApproval } from "@/lib/approvals";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Auth: a dashboard session OR the internal X-Agent-Token — the Communication agent escalates a real choice.
async function authed(req: Request): Promise<boolean> {
  const tok = (process.env.AGENT_GATEWAY_TOKEN ?? "").trim();
  if (tok && req.headers.get("x-agent-token") === tok) return true;
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}

// POST → turn a real choice into a durable Decision-Inbox approval (kind escalation) + phone notify.
export async function POST(req: Request) {
  if (!(await authed(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    const { approval } = escalate({
      question: body.question, advice: body.advice ?? null,
      work_item_id: body.work_item_id ?? null, issue: body.issue ?? null, pr: body.pr ?? null,
      team_id: body.team_id ?? null, created_by: body.created_by ?? "communication",
    });
    return NextResponse.json({ approval: publicApproval(approval) }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: httpStatusOf(e) });
  }
}
