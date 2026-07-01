import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { getGlobalMode, listPolicies, MODE_DEFAULTS } from "@/lib/token-optimization/budget-manager";
import { usageSummary, efficiencyMetrics } from "@/lib/token-optimization/ledger";
import { cacheStats } from "@/lib/token-optimization/context-cache";
import { compressionStats } from "@/lib/token-optimization/compressor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}

// Each section is independently guarded — one broken subsystem must not 500 the whole page.
function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

export async function GET() {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const todayIso = new Date().toISOString().slice(0, 10);
  const weekIso = new Date(Date.now() - 7 * 86400_000).toISOString();
  return NextResponse.json({
    mode: safe(() => getGlobalMode()),
    summary: safe(() => usageSummary(todayIso)),
    week: safe(() => usageSummary(weekIso)),
    efficiency: safe(() => efficiencyMetrics()),
    cache: safe(() => cacheStats()),
    compression: safe(() => compressionStats()),
    policies: safe(() => listPolicies()),
    mode_defaults: MODE_DEFAULTS,
  });
}
