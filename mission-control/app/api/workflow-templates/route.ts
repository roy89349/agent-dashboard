import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { listTemplates } from "@/lib/workflows";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}

// GET → the workflow templates (default pipelines seed lazily on first read).
export async function GET(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const includeDisabled = new URL(req.url).searchParams.get("all") === "1";
  return NextResponse.json({ templates: listTemplates({ includeDisabled }) });
}
