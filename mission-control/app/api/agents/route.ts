import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { readAgents, writeAgents, agentById, httpStatusOf, type AgentsPatch } from "@/lib/agents";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}

// Read-only roster (control/agents.json, seeded from deploy/agents.default.json).
export async function GET() {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const file = readAgents();
  return NextResponse.json({ agents: file.agents, rev: file.rev });
}

// Write the registry: upsert (merge) / remove only. CAS on rev. The whole-list replace is NOT allowed
// from here. Flipping enabled/role/label_scope/blocking on an EXISTING agent re-routes the LIVE fleet
// (worker.sh/lib.sh read agents.json — routing + the security gate), so it requires confirm:true.
const FLEET_FIELDS = ["enabled", "role", "label_scope", "blocking", "autonomy"] as const;

export async function POST(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const { patch, baseRev, confirm } = body as { patch?: AgentsPatch; baseRev?: number; confirm?: boolean };
  if (!patch || typeof patch !== "object")
    return NextResponse.json({ error: "patch missing" }, { status: 400 });
  if (patch.agents !== undefined)
    return NextResponse.json({ error: "bulk replace is not allowed here — use upsert/remove" }, { status: 400 });

  if (patch.upsert && !confirm) {
    const cur = agentById(patch.upsert.id);
    if (cur) {
      const up = patch.upsert as Record<string, unknown>;
      const curRec = cur as unknown as Record<string, unknown>;
      const changed = FLEET_FIELDS.filter((k) => k in up && JSON.stringify(up[k]) !== JSON.stringify(curRec[k]));
      if (changed.length)
        return NextResponse.json(
          { error: `changing ${changed.join(", ")} affects the running fleet (routing / security gate). Re-send with confirm:true.`, needsConfirm: true },
          { status: 412 },
        );
    }
  }
  // removing an ENABLED agent drops it from the live fleet (routing / security gate) → also confirm-gated
  if (patch.remove && !confirm) {
    const cur = agentById(patch.remove);
    if (cur?.enabled)
      return NextResponse.json(
        { error: `removing agent ${patch.remove} drops it from the running fleet (routing / security gate). Re-send with confirm:true.`, needsConfirm: true },
        { status: 412 },
      );
  }

  try {
    const rev = writeAgents(patch, baseRev as number);
    return NextResponse.json({ rev });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: httpStatusOf(e) });
  }
}
