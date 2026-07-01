import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { runWatchdog } from "@/lib/watchdog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// One watchdog tick: evaluate fleet health → deduped Telegram alert / recovery all-clear.
// Auth: a dashboard session OR the internal X-Watchdog-Token (MC_WATCHDOG_TOKEN) so a systemd
// timer / cron on the VPS can call it (see deploy/watchdog.sh + mission-control-watchdog.timer).
async function authed(req: Request): Promise<boolean> {
  const tok = (process.env.MC_WATCHDOG_TOKEN ?? "").trim();
  if (tok && req.headers.get("x-watchdog-token") === tok) return true;
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}

async function tick(req: Request) {
  if (!(await authed(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await runWatchdog());
}

export async function POST(req: Request) {
  return tick(req);
}

export async function GET(req: Request) {
  return tick(req);
}
