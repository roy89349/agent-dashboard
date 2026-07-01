// Prompt Compression Engine — DETERMINISTIC (no LLM: compressing must never itself cost tokens).
// Redaction happens BEFORE compression; low keep-confidence marks the result "needs raw context".
// Keeps: errors, failures, decisions, constraints, open questions, verdicts, file paths, TODOs.
// Drops: repetition, progress noise, old irrelevant detail.
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { db } from "../db.ts";
import { redact } from "../redact.ts";
import { estimateTokens, type CompressionResult } from "./types.ts";

export const LOW_CONFIDENCE = 0.5;

// Lines that must survive compression (case-insensitive).
const IMPORTANT_RE =
  /\b(error|fail(ed|ure)?|exception|traceback|fatal|panic|denied|reject(ed)?|blocke?d|warn(ing)?|security|vulnerab|secret|constraint|must|never|always|decision|decided|approve[d]?|caution|verdict|todo|fixme|open question|\?$|breaking|migrat|deprecat)\b/i;
const NOISE_RE = /^(\s*[|>*-]?\s*)?(ok|done|info|debug|trace|\.{3}|…|\s*)$/i;

function hashOf(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 24);
}

/** Core line-based compressor: keep important lines + head/tail window, dedupe repeats. */
function compressLines(raw: string, opts: { maxTokens: number; head: number; tail: number; mode: "lossy" | "lossless_ish" }): CompressionResult {
  const clean = redact(raw);
  const before = estimateTokens(clean);
  if (before <= opts.maxTokens) {
    return { summary: clean, tokens_before: before, tokens_after: before, compression_ratio: 1, confidence: 1, mode: "lossless_ish", needs_raw_context: false };
  }
  const lines = clean.split("\n");
  const seen = new Set<string>();
  const kept: string[] = [];
  const keep = (l: string) => {
    const key = l.trim().slice(0, 160);
    if (!key || seen.has(key)) return; // dedupe exact repeats
    seen.add(key);
    kept.push(l.length > 400 ? l.slice(0, 400) + " …" : l);
  };
  // head + tail windows preserve orientation; important lines preserved everywhere
  lines.slice(0, opts.head).forEach(keep);
  let important = 0;
  for (const l of lines.slice(opts.head, Math.max(opts.head, lines.length - opts.tail))) {
    if (NOISE_RE.test(l)) continue;
    if (IMPORTANT_RE.test(l)) {
      keep(l);
      important++;
    }
  }
  lines.slice(Math.max(opts.head, lines.length - opts.tail)).forEach(keep);

  let summary = kept.join("\n");
  // hard budget: trim the middle, never the tail (most recent state usually matters most)
  while (estimateTokens(summary) > opts.maxTokens && kept.length > opts.head + opts.tail + 2) {
    kept.splice(opts.head, 1);
    summary = kept.join("\n");
  }
  if (estimateTokens(summary) > opts.maxTokens) summary = summary.slice(-opts.maxTokens * 4);
  const after = estimateTokens(summary);
  const ratio = before > 0 ? Math.round((after / before) * 100) / 100 : 1;
  // confidence: how much important signal we could keep, tempered by how hard we squeezed
  const conf = Math.max(0.1, Math.min(1, (opts.mode === "lossless_ish" ? 0.9 : 0.75) - (ratio < 0.05 ? 0.35 : ratio < 0.15 ? 0.2 : 0) + Math.min(0.15, important * 0.01)));
  return { summary, tokens_before: before, tokens_after: after, compression_ratio: ratio, confidence: Math.round(conf * 100) / 100, mode: opts.mode, needs_raw_context: conf < LOW_CONFIDENCE };
}

export function compressLog(raw: string, maxTokens = 500): CompressionResult {
  return compressLines(raw, { maxTokens, head: 3, tail: 25, mode: "lossy" });
}

export function compressConversation(raw: string, maxTokens = 800): CompressionResult {
  return compressLines(raw, { maxTokens, head: 6, tail: 30, mode: "lossy" });
}

/** Diff compression: keeps file headers + hunk headers + a capped window of changed lines per file. */
export function compressDiff(rawDiff: string, maxTokens = 1500): CompressionResult {
  const clean = redact(rawDiff);
  const before = estimateTokens(clean);
  if (before <= maxTokens) return { summary: clean, tokens_before: before, tokens_after: before, compression_ratio: 1, confidence: 1, mode: "lossless_ish", needs_raw_context: false };
  const out: string[] = [];
  let perFile = 0;
  for (const l of clean.split("\n")) {
    if (l.startsWith("diff --git") || l.startsWith("+++") || l.startsWith("---")) {
      out.push(l);
      perFile = 0;
    } else if (l.startsWith("@@")) {
      out.push(l);
    } else if ((l.startsWith("+") || l.startsWith("-")) && perFile < 40) {
      out.push(l.length > 240 ? l.slice(0, 240) + " …" : l);
      perFile++;
    } else if (perFile === 40) {
      out.push("… (more changes in this file omitted)");
      perFile++;
    }
  }
  let summary = out.join("\n");
  if (estimateTokens(summary) > maxTokens) summary = summary.slice(0, maxTokens * 4) + "\n… (diff truncated)";
  const after = estimateTokens(summary);
  const ratio = before > 0 ? Math.round((after / before) * 100) / 100 : 1;
  const conf = ratio < 0.05 ? 0.45 : 0.7; // an extremely squeezed diff is risky context
  return { summary, tokens_before: before, tokens_after: after, compression_ratio: ratio, confidence: conf, mode: "lossy", needs_raw_context: conf < LOW_CONFIDENCE };
}

export function compressKnowledge(raw: string, maxTokens = 400): CompressionResult {
  return compressLines(raw, { maxTokens, head: 8, tail: 4, mode: "lossy" });
}

export function compressWorkflowState(raw: string, maxTokens = 300): CompressionResult {
  return compressLines(raw, { maxTokens, head: 20, tail: 10, mode: "lossless_ish" });
}

export function compressFileSummary(raw: string, maxTokens = 350): CompressionResult {
  return compressLines(raw, { maxTokens, head: 20, tail: 6, mode: "lossy" });
}

/** Persist a compression result with metadata so savings/quality are auditable. */
export function storeSummary(input: {
  source_kind: "conversation" | "log" | "diff" | "knowledge" | "file" | "workflow_state";
  source_ref?: string | null;
  raw: string;
  result: CompressionResult;
  invalidation?: string;
}): string {
  const id = randomUUID();
  db()
    .prepare(
      `INSERT INTO context_summaries (id, source_kind, source_ref, source_hash, mode, summary, tokens_before, tokens_after, compression_ratio, confidence, invalidation, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      input.source_kind,
      input.source_ref ?? null,
      hashOf(input.raw),
      input.result.mode,
      redact(input.result.summary), // defensive double-redact
      input.result.tokens_before,
      input.result.tokens_after,
      input.result.compression_ratio,
      input.result.confidence,
      input.invalidation ?? "source hash change",
      new Date().toISOString(),
    );
  return id;
}

export function compressionStats(sinceIso?: string): { count: number; tokens_saved: number; avg_ratio: number | null; low_confidence: number } {
  const since = sinceIso ?? new Date(Date.now() - 7 * 86400_000).toISOString();
  const rows = db()
    .prepare("SELECT tokens_before, tokens_after, confidence FROM context_summaries WHERE created_at >= ? LIMIT 5000")
    .all(since) as { tokens_before: number; tokens_after: number; confidence: number }[];
  const saved = rows.reduce((s, r) => s + Math.max(0, r.tokens_before - r.tokens_after), 0);
  const ratios = rows.filter((r) => r.tokens_before > 0);
  return {
    count: rows.length,
    tokens_saved: saved,
    avg_ratio: ratios.length ? Math.round((ratios.reduce((s, r) => s + r.tokens_after / r.tokens_before, 0) / ratios.length) * 100) / 100 : null,
    low_confidence: rows.filter((r) => r.confidence < LOW_CONFIDENCE).length,
  };
}
