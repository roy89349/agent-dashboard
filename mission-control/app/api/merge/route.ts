import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { mergePull } from "@/lib/github";

export async function POST(req: Request) {
  const c = await cookies();
  if (!(await verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!)))
    return NextResponse.json({ merged: false, message: "unauthorized" }, { status: 401 });

  const { prNumber, deleteBranch, confirm } = await req.json().catch(() => ({}));
  if (!prNumber || typeof prNumber !== "number") {
    return NextResponse.json({ merged: false, message: "prNumber missing" }, { status: 400 });
  }
  // Safety valve: merging requires explicit confirmation (confirm:true or "MERGE").
  // Undefined/false = NOT confirmed → 412 (allow-by-explicit-confirm).
  if (confirm !== true && confirm !== "MERGE") {
    return NextResponse.json({ merged: false, message: "confirmation required" }, { status: 412 });
  }
  try {
    const r = await mergePull(prNumber, { deleteBranch: !!deleteBranch });
    return NextResponse.json(r, { status: r.merged ? 200 : 409 });
  } catch (e) {
    return NextResponse.json({ merged: false, message: String(e) }, { status: 502 });
  }
}
