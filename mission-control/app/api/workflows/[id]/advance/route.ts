import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import {
  advanceWorkflow, completeStep, failStep, blockStep, skipStep, requestStepApproval, httpStatusOf,
} from "@/lib/workflows";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}

// POST → drive the workflow's state machine. `op` selects the transition (default: advance).
//   advance                         → finish the current step, start the next (or complete the run)
//   complete {stepId, output}       → mark the current step done with output, then advance
//   fail     {stepId, reason}       → record a failed attempt (retry while attempts remain, else fail)
//   block    {stepId, reason}       → block the step + workflow (needs intervention)
//   skip     {stepId}               → skip the step (advance if it was current)
//   request_approval {stepId}       → raise a durable approval that gates this step
const OPS = new Set(["advance", "complete", "fail", "block", "skip", "request_approval"]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const op = typeof body?.op === "string" ? body.op : "advance";
  if (!OPS.has(op)) return NextResponse.json({ error: `unknown op: ${op}` }, { status: 400 });
  const stepId = body?.stepId ? String(body.stepId) : "";
  const needsStep = op !== "advance";
  if (needsStep && !stepId) return NextResponse.json({ error: "stepId required" }, { status: 400 });
  const actor = "dashboard";
  try {
    switch (op) {
      case "complete": return NextResponse.json(completeStep(id, stepId, body?.output, actor));
      case "fail": return NextResponse.json(failStep(id, stepId, body?.reason, actor));
      case "block": return NextResponse.json(blockStep(id, stepId, body?.reason, actor));
      case "skip": return NextResponse.json(skipStep(id, stepId, actor));
      case "request_approval": { const { step } = requestStepApproval(id, stepId, actor); return NextResponse.json({ step }); }
      default: return NextResponse.json(advanceWorkflow(id, actor));
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: httpStatusOf(e) });
  }
}
