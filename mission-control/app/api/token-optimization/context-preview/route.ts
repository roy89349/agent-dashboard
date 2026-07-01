import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { compileContext } from "@/lib/token-optimization/context-compiler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_RAW = 100_000; // clamp pasted logs/diffs — the compiler compresses, but never accept unbounded input

async function authed(): Promise<boolean> {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

export async function POST(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const goal = str(body?.goal);
  if (!goal) return NextResponse.json({ error: "goal required" }, { status: 400 });
  const risk = ["low", "medium", "high", "critical"].includes(body?.risk) ? (body.risk as "low" | "medium" | "high" | "critical") : undefined;
  try {
    const pkg = compileContext({
      goal,
      agent_id: str(body?.agent_id),
      role: str(body?.role),
      team_id: str(body?.team_id),
      work_item_id: str(body?.work_item_id),
      workflow_id: str(body?.workflow_id),
      issue: Number.isFinite(Number(body?.issue)) && body?.issue != null ? Number(body.issue) : null,
      risk,
      raw_log_tail: str(body?.raw_log_tail)?.slice(0, MAX_RAW) ?? null,
      raw_diff: str(body?.raw_diff)?.slice(0, MAX_RAW) ?? null,
    });
    return NextResponse.json({ package: pkg });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "compile failed" }, { status: 500 });
  }
}
