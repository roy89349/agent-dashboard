import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { mergePull } from "@/lib/github";
import { enforce, permissionStatusOf, type ChangedFile } from "@/lib/permissions";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const c = await cookies();
  if (!(await verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!)))
    return NextResponse.json({ merged: false, message: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { prNumber, deleteBranch, confirm, agentId, files } = body as { prNumber?: number; deleteBranch?: boolean; confirm?: unknown; agentId?: string; files?: ChangedFile[] };
  if (!prNumber || typeof prNumber !== "number") {
    return NextResponse.json({ merged: false, message: "prNumber missing" }, { status: 400 });
  }
  // Safety valve (UNCHANGED, FIRST): merging requires explicit confirmation (confirm:true or "MERGE").
  if (confirm !== true && confirm !== "MERGE") {
    return NextResponse.json({ merged: false, message: "confirmation required" }, { status: 412 });
  }
  // Central permission layer: a confirmed human keeps one-click merge (invariant #7); an agent merge is
  // gated by autonomy/skills/ALLOW_AUTO_MERGE/team policy + diff risk, and blocks on a durable approval.
  const ctx = {
    agentId: agentId ?? null,
    initiator: (agentId ? "agent" : "human") as "agent" | "human",
    trusted: !agentId, // never trust an agent-supplied caller
    confirmed: true, // the valve above passed (only the human path benefits — #7)
    via: "dashboard",
    actor: agentId ?? "dashboard",
  };
  try {
    const decision = await enforce({ type: "merge", pr: prNumber, files, checksPassed: true }, ctx, { summary: `Merge PR #${prNumber}` });
    if (!decision.allowed)
      return NextResponse.json({ merged: false, pending: true, approvalId: decision.approvalId, message: "approval required" }, { status: 202 });
    const r = await mergePull(prNumber, { deleteBranch: !!deleteBranch });
    return NextResponse.json(r, { status: r.merged ? 200 : 409 });
  } catch (e) {
    if (permissionStatusOf(e) === 403)
      return NextResponse.json({ merged: false, message: e instanceof Error ? e.message : "denied" }, { status: 403 });
    return NextResponse.json({ merged: false, message: String(e) }, { status: 502 });
  }
}
