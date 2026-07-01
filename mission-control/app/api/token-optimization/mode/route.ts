import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { setGlobalMode } from "@/lib/token-optimization/budget-manager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}

export async function POST(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    // emergency never switches directly — setGlobalMode raises an approval instead
    return NextResponse.json(setGlobalMode(String(body?.mode ?? ""), "dashboard", "dashboard"));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "invalid mode" }, { status: 400 });
  }
}
