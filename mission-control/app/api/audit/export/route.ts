import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { exportAuditEvents } from "@/lib/audit";
import { filterFromParams } from "@/lib/audit-query";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}
// GET → download the (filtered) audit trail as JSON or CSV. Values are already redacted at write time; CSV cells
// are additionally formula-injection-guarded.
export async function GET(req: Request) {
  if (!(await authed())) return new NextResponse("unauthorized", { status: 401 });
  const q = new URL(req.url).searchParams;
  const format = q.get("format") === "csv" ? "csv" : "json";
  const { body, contentType, filename } = exportAuditEvents(filterFromParams(q), format);
  return new NextResponse(body, { headers: { "content-type": contentType, "content-disposition": `attachment; filename="${filename}"` } });
}
