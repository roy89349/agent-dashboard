import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";

export const dynamic = "force-dynamic";

// Non-secret, read-only view of the install config (for the Config screen).
export async function GET() {
  const c = await cookies();
  if (!(await verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const n = (k: string, d: number) => {
    const v = parseInt(process.env[k] ?? "", 10);
    return Number.isFinite(v) ? v : d;
  };
  return NextResponse.json({
    projectName: process.env.PROJECT_NAME?.trim() || null,
    projectDesc: process.env.PROJECT_DESC?.trim() || null,
    repo: process.env.GITHUB_REPO?.trim() || null,
    fleetDir: process.env.FLEET_DIR?.trim() || null,
    hasVault: !!process.env.VAULT_DIR?.trim(),
    githubTokenSet: !!process.env.GITHUB_TOKEN?.trim() && process.env.GITHUB_TOKEN !== "replace-me",
    allowGlobalOpus: (process.env.ALLOW_GLOBAL_OPUS ?? "0") === "1",
    hardMaxWorkers: n("HARD_MAX_WORKERS", 8),
    hardMaxPrPerDay: n("HARD_MAX_PR_PER_DAY", 50),
    maxAttemptsPerDay: n("MAX_ATTEMPTS_PER_DAY", 40),
  });
}
