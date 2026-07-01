import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { listAuditEvents } from "@/lib/audit";
import { filterFromParams } from "@/lib/audit-query";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}
// GET → a filtered, paginated page of audit events + the matching total.
export async function GET(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(listAuditEvents(filterFromParams(new URL(req.url).searchParams)));
}
