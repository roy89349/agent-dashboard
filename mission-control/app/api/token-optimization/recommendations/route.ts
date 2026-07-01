import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { generateRecommendations, listRecommendations, setRecommendationStatus } from "@/lib/token-optimization/recommendations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}

export async function GET(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const recommendations = q.get("generate") === "1" ? generateRecommendations() : listRecommendations();
  return NextResponse.json({ recommendations });
}

export async function POST(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const id = String(body?.id ?? "");
  const status = body?.status;
  if (!id || (status !== "applied" && status !== "dismissed")) {
    return NextResponse.json({ error: "id and status ('applied' | 'dismissed') required" }, { status: 400 });
  }
  const recommendation = setRecommendationStatus(id, status, "dashboard");
  if (!recommendation) return NextResponse.json({ error: "recommendation not found" }, { status: 404 });
  return NextResponse.json({ recommendation });
}
