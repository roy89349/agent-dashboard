// Semantic Context Cache — avoids recomputing expensive summaries/analyses. Keyed by kind+scope,
// invalidated when the SOURCE HASH changes (file hash, diff hash, knowledge/task/decision update).
// Content is redacted BEFORE write; never cache secrets.
import { createHash } from "node:crypto";
import { db } from "../db.ts";
import { redact } from "../redact.ts";
import { estimateTokens } from "./types.ts";

export type CacheKind = "file_summary" | "task_summary" | "knowledge_summary" | "dependency_map" | "analysis" | "log_summary";

export function sourceHash(source: string): string {
  return createHash("sha256").update(source).digest("hex").slice(0, 24);
}

export function cacheKey(kind: CacheKind, scopeId: string): string {
  return `${kind}:${scopeId}`.slice(0, 200);
}

/** Cache lookup. A hash mismatch counts as a miss AND invalidates the stale row. */
export function getCached(kind: CacheKind, scopeId: string, currentSourceHash: string): { content: string; token_estimate: number } | null {
  const key = cacheKey(kind, scopeId);
  const row = db().prepare("SELECT source_hash, content, token_estimate FROM context_cache WHERE key = ?").get(key) as
    | { source_hash: string; content: string; token_estimate: number }
    | undefined;
  const now = new Date().toISOString();
  if (row && row.source_hash === currentSourceHash) {
    db().prepare("UPDATE context_cache SET hits = hits + 1, updated_at = ? WHERE key = ?").run(now, key);
    return { content: row.content, token_estimate: row.token_estimate };
  }
  if (row) db().prepare("DELETE FROM context_cache WHERE key = ?").run(key); // stale → invalidate
  // record the miss on a tombstone-free counter row? keep it simple: misses tracked on write (below)
  return null;
}

/** Store (or replace) a computed summary/analysis for a source state. */
export function putCached(kind: CacheKind, scopeId: string, srcHash: string, content: string): void {
  const key = cacheKey(kind, scopeId);
  const clean = redact(content);
  const now = new Date().toISOString();
  const prev = db().prepare("SELECT misses FROM context_cache WHERE key = ?").get(key) as { misses: number } | undefined;
  db()
    .prepare(
      `INSERT INTO context_cache (key, kind, source_hash, content, token_estimate, hits, misses, created_at, updated_at)
       VALUES (?,?,?,?,?,0,?,?,?)
       ON CONFLICT(key) DO UPDATE SET source_hash=excluded.source_hash, content=excluded.content,
         token_estimate=excluded.token_estimate, misses=context_cache.misses+1, updated_at=excluded.updated_at`,
    )
    .run(key, kind, srcHash, clean, estimateTokens(clean), (prev?.misses ?? 0) + 1, now, now);
}

/** Get-or-compute helper: the standard way callers use the cache. */
export function cached(kind: CacheKind, scopeId: string, source: string, compute: (source: string) => string): { content: string; token_estimate: number; hit: boolean } {
  const h = sourceHash(source);
  const hitRow = getCached(kind, scopeId, h);
  if (hitRow) return { ...hitRow, hit: true };
  const content = compute(source);
  putCached(kind, scopeId, h, content);
  const clean = redact(content);
  return { content: clean, token_estimate: estimateTokens(clean), hit: false };
}

/** Explicit invalidation (knowledge update, task update, decision update, git change). */
export function invalidateCache(opts: { kind?: CacheKind; scopePrefix?: string }): number {
  if (opts.kind && opts.scopePrefix) {
    return Number(db().prepare("DELETE FROM context_cache WHERE kind = ? AND key LIKE ?").run(opts.kind, `${opts.kind}:${opts.scopePrefix}%`).changes);
  }
  if (opts.kind) return Number(db().prepare("DELETE FROM context_cache WHERE kind = ?").run(opts.kind).changes);
  if (opts.scopePrefix) return Number(db().prepare("DELETE FROM context_cache WHERE key LIKE ?").run(`%:${opts.scopePrefix}%`).changes);
  return 0;
}

export function cacheStats(): { entries: number; hits: number; misses: number; hit_rate: number | null; by_kind: { kind: string; entries: number; hits: number }[] } {
  const tot = db().prepare("SELECT COUNT(*) c, COALESCE(SUM(hits),0) h, COALESCE(SUM(misses),0) m FROM context_cache").get() as { c: number; h: number; m: number };
  const byKind = db().prepare("SELECT kind, COUNT(*) entries, COALESCE(SUM(hits),0) hits FROM context_cache GROUP BY kind ORDER BY hits DESC").all() as {
    kind: string;
    entries: number;
    hits: number;
  }[];
  const denom = tot.h + tot.m;
  return { entries: tot.c, hits: tot.h, misses: tot.m, hit_rate: denom > 0 ? Math.round((tot.h / denom) * 1000) / 10 : null, by_kind: byKind };
}
