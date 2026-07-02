import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { recordAudit } from "@/lib/db";
import { generateSummary, httpStatusOf, type SummaryType } from "@/lib/communication";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Morning/evening digest trigger for the night shift: generates a summary AND pushes it to the
// phone (Telegram). Called by a systemd timer on the VPS (deploy/morning-digest.sh + .timer),
// so — like /api/fleet/watchdog — it accepts the internal X-Watchdog-Token next to a session.
// Fail-closed: no token configured + no session = 401.
async function authed(req: Request): Promise<boolean> {
  const tok = (process.env.MC_WATCHDOG_TOKEN ?? "").trim();
  if (tok && req.headers.get("x-watchdog-token") === tok) return true;
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}

// The digest is deliberately NOT a free generateSummary proxy: the type is clamped to the two
// digest flavours and notify is always on — that is the whole point of the endpoint.
const DIGEST_TYPES: SummaryType[] = ["daily_standup", "end_of_day"];

export async function POST(req: Request) {
  if (!(await authed(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const type: SummaryType = DIGEST_TYPES.includes(body?.type) ? body.type : "daily_standup";
  try {
    const summary = generateSummary({ type, created_by: "night-shift", notify: true });
    recordAudit({ actor: "night-shift", via: "system", action: "comm.digest", detail: type });
    return NextResponse.json({ ok: true, summary_id: summary.id });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: httpStatusOf(e) });
  }
}
