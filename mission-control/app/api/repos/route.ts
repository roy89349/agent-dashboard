import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { readRepos, writeRepos, deleteRepo, listReposResolved, httpStatusOf } from "@/lib/repos";
import { recordAudit } from "@/lib/db";
import { redactAuditDetails } from "@/lib/audit";
import type { ReposPatch } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}

// The resolved repo list (synthesised primary + enabled extras) plus the raw registry rev for CAS.
// `extras` additionally carries the RAW registry entries (disabled ones included) so the Config UI can
// list/re-enable them. Absent control/repos.json = zero-config single-repo → [primary], never 500.
export async function GET() {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const file = readRepos();
  return NextResponse.json({ repos: listReposResolved(), extras: file.repos, rev: file.rev });
}

// Upsert ONE extra repo: { patch: { upsert }, baseRev } → CAS write (409 on stale/id-collision, 400 on
// invalid). All validation (slug id ≠ "primary", owner/name, absolute repo_dir, clamped overrides) is
// server-side in lib/repos.ts. The whole-list replace is NOT allowed from here.
export async function POST(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const { patch, baseRev } = body as { patch?: ReposPatch; baseRev?: number };
  if (!patch || typeof patch !== "object")
    return NextResponse.json({ error: "patch missing" }, { status: 400 });
  if (!patch.upsert && !patch.remove)
    return NextResponse.json({ error: "patch must carry an upsert or remove" }, { status: 400 });

  const before = readRepos();
  try {
    const rev = writeRepos(patch, baseRev as number);
    const after = readRepos();
    recordAudit({
      actor: "dashboard",
      via: "dashboard",
      action: "repos.update",
      kind: "repos",
      target_type: "repos",
      target_id: "repos.json",
      detail: redactAuditDetails(
        `rev ${before.rev}→${rev}; repos: [${after.repos.map((r) => `${r.id}${r.enabled ? "" : " (off)"}`).join(", ")}]`,
      ),
      old_value: before.repos,
      new_value: after.repos,
    });
    return NextResponse.json({ rev });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: httpStatusOf(e) });
  }
}

// Delete one extra repo by id: DELETE /api/repos?id=<slug>. 400 for a missing id or the reserved
// "primary" (env-configured, cannot be deleted).
export async function DELETE(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id query param required" }, { status: 400 });

  const before = readRepos();
  try {
    const rev = deleteRepo(id);
    const after = readRepos();
    recordAudit({
      actor: "dashboard",
      via: "dashboard",
      action: "repos.delete",
      kind: "repos",
      target_type: "repos",
      target_id: id,
      detail: redactAuditDetails(`removed repo '${id}'; rev ${before.rev}→${rev}`),
      old_value: before.repos,
      new_value: after.repos,
    });
    return NextResponse.json({ rev });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: httpStatusOf(e) });
  }
}
