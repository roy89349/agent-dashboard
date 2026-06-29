import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { listTree, vaultConfigured, vaultRoot } from "@/lib/knowledge";

export const dynamic = "force-dynamic";

// GET → vault file tree (markdown/txt), or configured:false when no VAULT_DIR.
export async function GET() {
  const c = await cookies();
  if (!(await verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const configured = vaultConfigured();
  return NextResponse.json({ configured, root: configured ? vaultRoot() : null, tree: listTree() });
}
