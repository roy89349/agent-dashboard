import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { listPolicies, upsertPolicy, deletePolicy } from "@/lib/token-optimization/budget-manager";
import type { BudgetPolicy } from "@/lib/token-optimization/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}

export async function GET() {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ policies: listPolicies() });
}

export async function POST(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    // upsertPolicy validates scope/mode and clamps every number server-side
    const policy = upsertPolicy(
      {
        // runtime string — upsertPolicy validates against BUDGET_SCOPES and throws on anything invalid
        scope: String(body?.scope ?? "") as BudgetPolicy["scope"],
        scope_id: String(body?.scope_id ?? "*"),
        mode: body?.mode,
        max_context_tokens: body?.max_context_tokens,
        max_run_tokens: body?.max_run_tokens,
        max_day_tokens: body?.max_day_tokens,
        max_retries: body?.max_retries,
        approval_threshold_tokens: body?.approval_threshold_tokens,
      },
      "dashboard",
    );
    return NextResponse.json({ policy });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "invalid policy" }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const scope = q.get("scope");
  const scopeId = q.get("scope_id");
  if (!scope || !scopeId) return NextResponse.json({ error: "scope and scope_id required" }, { status: 400 });
  const deleted = deletePolicy(scope, scopeId, "dashboard");
  if (!deleted) return NextResponse.json({ error: "policy not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
