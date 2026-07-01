import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { listGrouped, listThreads, searchThreads, createThread, convStatusOf, CONVERSATION_KINDS, type ConversationKind, type ConversationGroup } from "@/lib/conversations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}
// GET → grouped list (default), a single group (?group=), or a search (?q=). POST → create a thread of a kind.
export async function GET(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const search = q.get("q");
  if (search) return NextResponse.json({ results: searchThreads(search) });
  const group = q.get("group") as ConversationGroup | null;
  if (group) return NextResponse.json({ threads: listThreads({ group }) });
  return NextResponse.json({ grouped: listGrouped() });
}
export async function POST(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!CONVERSATION_KINDS.includes(body.kind)) return NextResponse.json({ error: "invalid kind" }, { status: 400 });
  try {
    return NextResponse.json({ thread: createThread({ ...body, kind: body.kind as ConversationKind }) }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: convStatusOf(e) });
  }
}
