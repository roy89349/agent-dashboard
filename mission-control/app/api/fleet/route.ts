import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { readFleet, writeFleet, httpStatusOf, type FleetPatch } from "@/lib/fleet";

export const dynamic = "force-dynamic";

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
  try {
    const rev = writeFleet(patch, baseRev as number, confirm);
    return NextResponse.json({ rev });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: httpStatusOf(e) },
    );
  }
}
