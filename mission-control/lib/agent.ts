import "server-only";
import { spawn } from "node:child_process";
import readline from "node:readline";
import path from "node:path";

/**
 * Runs the Claude Code CLI headless and streams the assistant tokens via a callback.
 * Uses --output-format stream-json (+ --verbose --include-partial-messages) and
 * --session-id / --resume for resumable conversations.
 */

export function fleetDir(): string {
  const env = process.env.FLEET_DIR;
  return env && env.trim() ? env.trim() : path.resolve(process.cwd(), "..");
}
// Optional knowledge-base directory; empty = no vault configured.
export function vaultDir(): string {
  return process.env.VAULT_DIR?.trim() || "";
}

export interface RunOpts {
  prompt: string;
  cwd: string;
  sessionId?: string; // new conversation → --session-id
  resumeId?: string; // continuation → --resume
  model?: string;
  effort?: string;
  addDirs?: string[];
  appendSystemPrompt?: string;
  allowedTools?: string;
  maxTurns?: number;
  signal?: AbortSignal;
}
export interface RunResult {
  sessionId: string | null;
  text: string;
  costUsd: number | null;
  numTurns: number | null;
}

export function runClaude(
  opts: RunOpts,
  onText: (t: string) => void,
  onTool?: (name: string) => void,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const args = [
      "-p",
      opts.prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
    ];
    if (opts.resumeId) args.push("--resume", opts.resumeId);
    else if (opts.sessionId) args.push("--session-id", opts.sessionId);
    if (opts.model) args.push("--model", opts.model);
    if (opts.effort) args.push("--effort", opts.effort);
    for (const d of opts.addDirs ?? []) args.push("--add-dir", d);
    if (opts.allowedTools) args.push("--allowedTools", opts.allowedTools);
    if (opts.appendSystemPrompt) args.push("--append-system-prompt", opts.appendSystemPrompt);
    if (opts.maxTurns) args.push("--max-turns", String(opts.maxTurns));

    const child = spawn("claude", args, {
      cwd: opts.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let text = "";
    let sessionId = opts.resumeId ?? opts.sessionId ?? null;
    let costUsd: number | null = null;
    let numTurns: number | null = null;
    let stderr = "";

    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      const s = line.trim();
      if (!s) return;
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(s);
      } catch {
        return;
      }
      const event = ev.event as Record<string, unknown> | undefined;
      const delta = event?.delta as Record<string, unknown> | undefined;
      if (ev.type === "stream_event" && delta?.type === "text_delta") {
        const t = (delta.text as string) ?? "";
        if (t) {
          text += t;
          onText(t);
        }
      } else if (
        ev.type === "stream_event" &&
        event?.type === "content_block_start" &&
        (event.content_block as Record<string, unknown> | undefined)?.type === "tool_use"
      ) {
        onTool?.(((event.content_block as Record<string, unknown>).name as string) ?? "tool");
      } else if (ev.type === "result") {
        if (typeof ev.total_cost_usd === "number") costUsd = ev.total_cost_usd;
        if (typeof ev.num_turns === "number") numTurns = ev.num_turns;
        if (typeof ev.session_id === "string") sessionId = ev.session_id;
        if (!text && typeof ev.result === "string") text = ev.result;
      } else if (ev.type === "system" && typeof ev.session_id === "string") {
        sessionId = ev.session_id;
      }
    });

    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    if (opts.signal) {
      opts.signal.addEventListener("abort", () => child.kill("SIGTERM"));
    }
    child.on("error", (e) => reject(e));
    child.on("close", (code) => {
      rl.close();
      if (code === 0 || text) resolve({ sessionId, text, costUsd, numTurns });
      else reject(new Error(stderr.slice(0, 500) || `claude exit ${code}`));
    });
  });
}
