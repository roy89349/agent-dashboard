// Local voice-note → text for the Telegram command interface. SELLABILITY RULE: transcription runs
// ENTIRELY on the server with a LOCAL whisper.cpp binary — no external STT API, no keys, no metered
// costs, and the audio + transcript NEVER leave the box. Off by default (VOICE_NOTES != "on"), so
// small installs and CI are unaffected. Everything is wrapped so it NEVER throws to the caller: on any
// problem (flag off, missing binary, download/convert/transcribe failure) it returns { error }.
//
// Deps (fetch + process runner + logger + env) are INJECTABLE so the pipeline is unit-testable without
// a real whisper binary or network — see lib/phone.test.ts.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { redact } from "../redact.ts";

export type TranscribeResult = { text: string } | { error: string };

/** Result of running a child process. `timedOut` = we killed it at the hard limit. */
export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}
export type Runner = (bin: string, args: string[], opts: { timeoutMs: number }) => Promise<RunResult>;

export interface TranscribeDeps {
  fetch: typeof fetch;
  run: Runner;
  /** Logger — only ever receives ALREADY-REDACTED text. */
  log: (msg: string) => void;
  env: Record<string, string | undefined>;
}

const WHISPER_TIMEOUT_MS = 120_000; // hard cap: a stuck/huge transcription can never hang the webhook
const FFMPEG_TIMEOUT_MS = 60_000;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // Telegram voice notes are tiny; refuse anything absurd

/** Default process runner: spawn with a hard timeout (SIGKILL on expiry). Never rejects. */
const defaultRun: Runner = (bin, args, opts) =>
  new Promise<RunResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      resolve({ code: null, stdout: "", stderr: e instanceof Error ? e.message : "spawn failed", timedOut: false });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
    }, opts.timeoutMs);
    child.stdout?.on("data", (d) => { stdout += d.toString(); });
    child.stderr?.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: null, stdout, stderr: stderr || String(e), timedOut }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
  });

function realDeps(): TranscribeDeps {
  return { fetch: (...a: Parameters<typeof fetch>) => fetch(...a), run: defaultRun, log: (m) => console.log(m), env: process.env };
}

interface Cfg {
  on: boolean;
  token: string;
  whisperBin: string;
  whisperModel: string;
  ffmpegBin: string;
  lang: string;
}
function readCfg(env: Record<string, string | undefined>): Cfg {
  return {
    on: (env.VOICE_NOTES ?? "").trim().toLowerCase() === "on",
    token: (env.TELEGRAM_BOT_TOKEN ?? "").trim(),
    whisperBin: (env.WHISPER_BIN ?? "").trim(),
    whisperModel: (env.WHISPER_MODEL ?? "").trim(),
    ffmpegBin: (env.FFMPEG_BIN ?? "ffmpeg").trim(),
    lang: (env.WHISPER_LANG ?? "auto").trim() || "auto",
  };
}

/**
 * Download a Telegram voice note by file_id and transcribe it LOCALLY with whisper.cpp.
 * Returns `{ text }` on success or `{ error }` otherwise — it NEVER throws.
 * `error === "voice_disabled"` means the feature is off or a binary/model/token is missing.
 */
export async function transcribeVoice(fileId: string, injected?: Partial<TranscribeDeps>): Promise<TranscribeResult> {
  const deps: TranscribeDeps = { ...realDeps(), ...injected };
  const cfg = readCfg(deps.env);

  // ── the gate: never spawn / download when the feature is off or unconfigured ──
  if (!cfg.on || !cfg.whisperBin || !cfg.whisperModel || !cfg.token) return { error: "voice_disabled" };
  if (!fileId) return { error: "no_file" };

  let dir: string | null = null;
  try {
    // 1) getFile → the storage path on Telegram's side
    const api = `https://api.telegram.org/bot${cfg.token}`;
    const gf = await deps.fetch(`${api}/getFile?file_id=${encodeURIComponent(fileId)}`, { cache: "no-store" });
    const gj = (await gf.json().catch(() => ({}))) as { ok?: boolean; result?: { file_path?: string; file_size?: number } };
    const filePath = gj?.result?.file_path;
    if (!gf.ok || !gj.ok || !filePath) return { error: "getfile_failed" };
    if ((gj.result?.file_size ?? 0) > MAX_AUDIO_BYTES) return { error: "too_large" };

    // 2) download the OGG/Opus bytes to a private temp file (0600)
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "mc-voice-"));
    await fs.chmod(dir, 0o700).catch(() => {});
    const oggPath = path.join(dir, "voice.ogg");
    const dl = await deps.fetch(`https://api.telegram.org/file/bot${cfg.token}/${filePath}`, { cache: "no-store" });
    if (!dl.ok) return { error: "download_failed" };
    const buf = Buffer.from(await dl.arrayBuffer());
    if (buf.byteLength === 0) return { error: "empty_audio" };
    if (buf.byteLength > MAX_AUDIO_BYTES) return { error: "too_large" };
    await fs.writeFile(oggPath, buf, { mode: 0o600 });

    // 3) whisper.cpp needs 16 kHz mono WAV → convert with ffmpeg when available; otherwise feed the OGG
    //    directly (works with a whisper build that links libavcodec; if not it fails cleanly → { error }).
    let input = oggPath;
    if (cfg.ffmpegBin) {
      const wavPath = path.join(dir, "voice.wav");
      const conv = await deps.run(cfg.ffmpegBin, ["-nostdin", "-i", oggPath, "-ar", "16000", "-ac", "1", "-y", wavPath], { timeoutMs: FFMPEG_TIMEOUT_MS });
      if (conv.code === 0 && !conv.timedOut) input = wavPath;
    }

    // 4) run whisper.cpp (main / whisper-cli). --output-txt writes "<outBase>.txt"; we also keep stdout.
    const outBase = path.join(dir, "out");
    const wr = await deps.run(
      cfg.whisperBin,
      ["-m", cfg.whisperModel, "-f", input, "-of", outBase, "--no-timestamps", "--language", cfg.lang, "--output-txt"],
      { timeoutMs: WHISPER_TIMEOUT_MS },
    );
    if (wr.timedOut) return { error: "transcribe_timeout" };

    // 5) prefer the .txt file; fall back to stdout. Trim + normalize whitespace.
    let raw = await fs.readFile(`${outBase}.txt`, "utf8").catch(() => "");
    if (!raw.trim()) raw = wr.stdout;
    const text = raw.replace(/\s+/g, " ").trim();
    if (!text) return { error: wr.code === 0 ? "empty_transcript" : "transcribe_failed" };

    // log ONLY the redacted transcript (audio + raw text never leave the server)
    deps.log(`voice transcript (${text.length} chars): ${redact(text)}`);
    return { text };
  } catch (e) {
    // absolutely never throw to the webhook
    return { error: e instanceof Error ? e.message.slice(0, 120) : "transcribe_error" };
  } finally {
    if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
