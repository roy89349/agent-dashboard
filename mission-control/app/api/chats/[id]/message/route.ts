import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { getConversation, getMessages, addMessage, touchConversation } from "@/lib/db";
import { runClaude, vaultDir, fleetDir } from "@/lib/agent";
import { readStatus } from "@/lib/fleet";

export const dynamic = "force-dynamic";
export const maxDuration = 800; // allow long agent runs

function orchestratorSystem(): string {
  const project = process.env.PROJECT_NAME?.trim() || "this project";
  const desc = process.env.PROJECT_DESC?.trim();
  const hasVault = !!vaultDir();
  let ctx = "";
  try {
    const st = readStatus();
    if (st)
      ctx = ` Live fleet status: mode=${st.mode}, online=${st.online}, active workers=${st.slots.length}/${st.knobs.max_workers}, PRs today=${st.prs_today}, breaker=${st.breaker.consecutive_fails}/${st.knobs.fail_break}${st.pause_reason ? `, paused=${st.pause_reason}` : ""}.`;
  } catch {
    /* status optional */
  }
  return (
    `You are the orchestrator assistant for an autonomous agent fleet (Mission Control) working on ${project}${desc ? ` (${desc})` : ""}. ` +
    `You help understand and steer the fleet, plan and phrase tasks, and consult the codebase${hasVault ? " and the attached knowledge base (mounted via --add-dir)" : ""}. ` +
    "Answer concisely and concretely. You have read-only tools (Read/Grep/Glob)." +
    ctx
  );
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await cookies();
  if (!(await verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const conv = getConversation(id);
  if (!conv) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) return NextResponse.json({ error: "empty message" }, { status: 400 });

  const prior = getMessages(id);
  const hasAssistant = prior.some((m) => m.role === "assistant");
  addMessage({ conversation_id: id, role: "user", content });
  if (!conv.title) touchConversation(id, { title: content.slice(0, 80) });

  const sessionId = conv.session_id ?? undefined;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          closed = true;
        }
      };
      let full = "";
      try {
        const res = await runClaude(
          {
            prompt: content,
            cwd: conv.cwd ?? fleetDir(),
            sessionId: hasAssistant ? undefined : sessionId,
            resumeId: hasAssistant ? sessionId : undefined,
            model: conv.model ?? "sonnet",
            effort: conv.effort ?? "medium",
            addDirs: vaultDir() ? [vaultDir()] : [],
            allowedTools: "Read,Grep,Glob",
            appendSystemPrompt: orchestratorSystem(),
            maxTurns: 30,
            signal: req.signal,
          },
          (t) => {
            full += t;
            send({ type: "text", text: t });
          },
          (name) => send({ type: "tool", name }),
        );
        const finalText = res.text || full;
        addMessage({
          conversation_id: id,
          role: "assistant",
          content: finalText,
          meta: { costUsd: res.costUsd, numTurns: res.numTurns },
        });
        if (res.sessionId && res.sessionId !== conv.session_id)
          touchConversation(id, { session_id: res.sessionId });
        send({ type: "done", costUsd: res.costUsd, numTurns: res.numTurns });
      } catch (e) {
        send({ type: "error", error: e instanceof Error ? e.message : String(e) });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
    },
  });
}
