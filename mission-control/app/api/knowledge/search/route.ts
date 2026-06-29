import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { searchNotes } from "@/lib/knowledge";

export const dynamic = "force-dynamic";

// GET ?q=<query> → ripgrep matches across the vault (file + line + snippet).
export async function GET(req: Request) {
  const c = await cookies();
  if (!(await verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return NextResponse.json({ results: searchNotes(q) });
}
