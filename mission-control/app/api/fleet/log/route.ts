import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { tailLog, httpStatusOf } from "@/lib/fleet";

export const dynamic = "force-dynamic";

// GET ?issue=<int>&from=<int> → getailde, secret-geredacteerde live agent-log.
export async function GET(req: Request) {
  const c = await cookies();
  if (!(await verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  try {
    const chunk = tailLog(url.searchParams.get("issue"), url.searchParams.get("from"));
    return NextResponse.json(chunk);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: httpStatusOf(e) },
    );
  }
}
