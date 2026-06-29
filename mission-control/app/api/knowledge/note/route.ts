import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { readNote, writeNote, kStatusOf } from "@/lib/knowledge";

export const dynamic = "force-dynamic";

async function authed() {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}

// GET ?path=<vault-relative> → read a note.
export async function GET(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const path = new URL(req.url).searchParams.get("path");
  try {
    return NextResponse.json(readNote(path));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: kStatusOf(e) },
    );
  }
}

// POST {path, content} → write a note back to the vault.
export async function POST(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { path, content } = await req.json().catch(() => ({}));
  try {
    return NextResponse.json(writeNote(path, content));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: kStatusOf(e) },
    );
  }
}
