import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { listKnowledgeItems, searchKnowledge, addKnowledgeSource, agentMayUse, ensureDefaultInstructions, vaultConfigured, knowledgeStatusOf, type KnowledgeType } from "@/lib/knowledge-index";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Who is calling? A dashboard SESSION (Roy — may see flagged-unsafe items to manage them), the internal
// X-Agent-Token (a fleet AGENT — only safe + access-allowed items), or nobody. Session wins if both are present.
async function principal(req: Request): Promise<"session" | "agent" | null> {
  const c = await cookies();
  if (await verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!)) return "session";
  const tok = (process.env.AGENT_GATEWAY_TOKEN ?? "").trim();
  if (tok && req.headers.get("x-agent-token") === tok) return "agent";
  return null;
}

// GET → list or search indexed knowledge. AGENTS are hard-scoped to SAFE + access-allowed items (a token caller
// can never drop the filter by omitting agent_id); a session sees everything for management.
export async function GET(req: Request) {
  const who = await principal(req);
  if (!who) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  ensureDefaultInstructions();
  const q = new URL(req.url).searchParams;
  const query = q.get("q");
  const agentScoped = who === "agent";
  const type = (q.get("type") as KnowledgeType) ?? undefined;
  const team_id = q.get("team_id") ?? undefined;
  const tag = q.get("tag") ?? undefined;
  const agent_id = q.get("agent_id") ?? undefined;
  const role = q.get("role") ?? undefined;
  if (query && query.trim()) {
    // searchKnowledge already forces safe_only + agentMayUse — safe for both principals.
    return NextResponse.json({ items: searchKnowledge(query, { agent_id, role, team_id, include_unsafe: false }).map((h) => h.item), vault_configured: vaultConfigured() });
  }
  let items = listKnowledgeItems({ type, team_id, tag, agent_id, role, safe_only: agentScoped });
  if (agentScoped) items = items.filter((i) => agentMayUse(i, agent_id ?? null, role ?? null)); // restricted items excluded unless allowed
  return NextResponse.json({ items, vault_configured: vaultConfigured() });
}

// POST → add a knowledge source (manual record, a single vault file, or reindex a folder). Session ONLY.
export async function POST(req: Request) {
  if ((await principal(req)) !== "session") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    return NextResponse.json(addKnowledgeSource({ ...body, actor: "dashboard" }), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: knowledgeStatusOf(e) });
  }
}
