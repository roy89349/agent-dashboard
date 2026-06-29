import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { createAgentTask } from "@/lib/github";

export async function POST(req: Request) {
  const c = await cookies();
  if (!(await verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { title, body } = await req.json().catch(() => ({}));
  if (!title || typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }
  try {
    const task = await createAgentTask({ title, body });
    return NextResponse.json({ number: task.number, url: task.url });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
