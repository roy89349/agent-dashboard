import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/session";
import { getConversation, getMessages, addMessage, touchConversation } from "@/lib/db";
import { runClaude, vaultDir, chatCwd } from "@/lib/agent";
import { readStatus, readIssueState, agentLogTail } from "@/lib/fleet";
import { compressLog } from "@/lib/token-optimization/compressor";
import { recordUsage } from "@/lib/token-optimization/ledger";
import { estimateTokens } from "@/lib/token-optimization/types";

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

function taskSystem(issue: number): { text: string; compressed: boolean } {
  const project = process.env.PROJECT_NAME?.trim() || "this project";
  const st = readIssueState(issue);
  // Token optimization: the raw tail is compressed (errors/decisions kept, noise dropped) so the
  // task chat spends context on signal, not on repeated progress lines.
  const rawLog = agentLogTail(issue, 4000);
  let log = rawLog;
  let compressed = false;
  try {
    const c = compressLog(rawLog, 450);
    if (c.compression_ratio < 1 && !c.needs_raw_context) {
      log = c.summary;
      compressed = true;
    }
  } catch {
    /* fall back to the raw tail */
  }
  const f = (k: string) => (st && st[k] != null ? String(st[k]) : "");
  let info = `build task #${issue}`;
  if (st) {
    const bits = [
      f("title") && `title="${f("title")}"`,
      f("state") && `state=${f("state")}`,
      f("model") && `model=${f("model")}`,
      f("review_verdict") && `review=${f("review_verdict")}`,
      f("branch") && `branch=${f("branch")}`,
      f("pr_url") && `PR=${f("pr_url")}`,
      f("error") && `error=${f("error")}`,
    ].filter(Boolean);
    if (bits.length) info += ` (${bits.join(", ")})`;
  }
  return {
    text:
      `You are the orchestrator assistant discussing ${info} in ${project}. ` +
      "Help the user understand what the agent did, review the change, and plan next steps or a follow-up task. " +
      "You can Read/Grep/Glob the repository (attached via --add-dir). Answer concisely and concretely." +
      (log ? `\n\nRecent agent log (${compressed ? "summarized" : "tail"}, redacted):\n${log}` : ""),
    compressed,
  };
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
  // Resume whenever the conversation already has ANY prior turn — the very first message
  // (prior empty) starts a new session via --session-id; every later message resumes it.
  // (Keying on assistant-presence could brick a conversation after a failed first turn,
  // because claude may already have created the session record.)
  const resume = prior.length > 0;
  addMessage({ conversation_id: id, role: "user", content });
  if (!conv.title) touchConversation(id, { title: content.slice(0, 80) });

  const sessionId = conv.session_id ?? undefined;
  const isTask = conv.kind === "task" && conv.issue != null;
  const sysInfo = isTask ? taskSystem(conv.issue!) : { text: orchestratorSystem(), compressed: false };
  const sys = sysInfo.text;
  const repoDir = process.env.REPO_DIR?.trim();
  const dirs = [vaultDir(), isTask && repoDir ? repoDir : ""].filter(Boolean) as string[];
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
            cwd: conv.cwd ?? chatCwd(),
            sessionId: resume ? undefined : sessionId,
            resumeId: resume ? sessionId : undefined,
            model: conv.model ?? "sonnet",
            effort: conv.effort ?? "medium",
            addDirs: dirs,
            allowedTools: "Read,Grep,Glob",
            appendSystemPrompt: sys,
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
        // Token ledger: this is the one place with REAL cost data (the CLI result event).
        try {
          recordUsage({
            agent_id: isTask ? "task-chat" : "orchestrator",
            model: conv.model ?? "sonnet",
            effort: conv.effort ?? "medium",
            estimated_input_tokens: estimateTokens(content) + estimateTokens(sys),
            estimated_output_tokens: estimateTokens(finalText),
            actual_cost_usd: res.costUsd,
            compression_used: sysInfo.compressed,
            result_status: "ok",
            source: "chat",
          });
        } catch {
          /* accounting must never break the chat */
        }
        send({ type: "done", costUsd: res.costUsd, numTurns: res.numTurns });
      } catch (e) {
        try {
          recordUsage({
            agent_id: isTask ? "task-chat" : "orchestrator",
            model: conv.model ?? "sonnet",
            estimated_input_tokens: estimateTokens(content) + estimateTokens(sys),
            compression_used: sysInfo.compressed,
            result_status: "failed",
            source: "chat",
          });
        } catch {}
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
