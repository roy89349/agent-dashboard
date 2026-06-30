import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { readFleet, writeFleet, httpStatusOf, type FleetPatch } from "@/lib/fleet";
import { enforce, permissionStatusOf } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authed() {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}

// GET → current desired state (incl. rev for the next baseRev).
export async function GET() {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ fleet: readFleet() });
}

// POST → declarative control (mode/knobs/priority/per-task-model) with CAS on rev.
export async function POST(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const { patch, baseRev, confirm } = body as {
    patch?: FleetPatch;
    baseRev?: number;
    confirm?: boolean;
  };
  if (!patch || typeof patch !== "object")
    return NextResponse.json({ error: "patch missing" }, { status: 400 });

  // Central permission layer for the privileged knobs (force-opus / cap increase), diffed vs current.
  // Non-privileged knobs (mode pause/resume, effort, depth, priority) pass straight through. writeFleet's
  // own opus-env-gate + dangerous-confirm gate remain the backstop. A confirmed human is allowed (#7);
  // an outage-free durable approval blocks otherwise (202, no write).
  const ctx = {
    agentId: (body as { agentId?: string }).agentId ?? null,
    initiator: ((body as { agentId?: string }).agentId ? "agent" : "human") as "agent" | "human",
    trusted: !(body as { agentId?: string }).agentId,
    confirmed: confirm === true,
    via: "dashboard",
    actor: "dashboard",
  };
  try {
    const cur = readFleet();
    if (patch.router === "opus" && cur.router !== "opus") {
      const d = await enforce({ type: "use_opus", scope: "global" }, ctx, { summary: "Force model → opus globally" });
      if (!d.allowed) return NextResponse.json({ pending: true, approvalId: d.approvalId, error: "approval required" }, { status: 202 });
    }
    const capUp =
      (patch.max_workers != null && patch.max_workers > (cur.max_workers ?? 0)) ||
      (patch.max_pr_per_day != null && patch.max_pr_per_day > (cur.max_pr_per_day ?? 0));
    if (capUp) {
      const d = await enforce({ type: "phone_command", verb: "cap_increase", mutates: true, patch: { max_workers: patch.max_workers ?? undefined, max_pr_per_day: patch.max_pr_per_day ?? undefined } }, ctx, { summary: "Raise fleet caps" });
      if (!d.allowed) return NextResponse.json({ pending: true, approvalId: d.approvalId, error: "approval required" }, { status: 202 });
    }
    const rev = writeFleet(patch, baseRev as number, confirm);
    return NextResponse.json({ rev });
  } catch (e) {
    if (permissionStatusOf(e) === 403)
      return NextResponse.json({ error: e instanceof Error ? e.message : "denied" }, { status: 403 });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: httpStatusOf(e) },
    );
  }
}
