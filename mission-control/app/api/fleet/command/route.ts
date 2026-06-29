import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { appendCommand, httpStatusOf } from "@/lib/fleet";
import type { FleetCommand } from "@/lib/types";

export const dynamic = "force-dynamic";

// POST → imperative one-shot: kill / cancel / breaker-reset. Only writes a queue line; never execs.
export async function POST(req: Request) {
  const c = await cookies();
  if (!(await verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { cmd, issue, slot, reason, confirm } = body as FleetCommand & { confirm?: boolean };
  if (!cmd) return NextResponse.json({ error: "cmd missing" }, { status: 400 });
  // kill/cancel touch a running process → explicit confirmation required (UI brake).
  if ((cmd === "kill" || cmd === "cancel") && confirm !== true)
    return NextResponse.json({ error: "confirmation required" }, { status: 412 });
  try {
    const id = appendCommand({ cmd, issue, slot, reason });
    return NextResponse.json({ id });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: httpStatusOf(e) },
    );
  }
}
