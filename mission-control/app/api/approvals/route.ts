import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import {
  listApprovals,
  listPendingApprovals,
  createApproval,
  publicApproval,
  approvalErrorStatus,
  type CreateApprovalInput,
} from "@/lib/approvals";
import { getProvider, isPhoneConfigured } from "@/lib/phone";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}

export async function GET(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const pending = new URL(req.url).searchParams.get("status") === "pending";
  const list = (pending ? listPendingApprovals() : listApprovals(100)).map(publicApproval);
  return NextResponse.json({ approvals: list });
}

export async function POST(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const b = (await req.json()) as Partial<CreateApprovalInput>;
    if (!b.kind || !b.summary) return NextResponse.json({ error: "kind and summary required" }, { status: 400 });
    const { approval } = createApproval(b as CreateApprovalInput);
    // Best-effort push to the phone (the token is NOT exposed; the phone decides via verified buttons).
    if (isPhoneConfigured()) {
      const p = getProvider();
      p?.sendApprovalRequest(approval).catch(() => {});
    }
    return NextResponse.json({ approval: publicApproval(approval) }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "error" },
      { status: approvalErrorStatus(e) },
    );
  }
}
