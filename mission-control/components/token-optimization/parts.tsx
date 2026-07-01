"use client";
// Shared bits for the token-optimization screens. Honesty first: every token number is an estimate
// unless the ledger reported actuals — the tags below mirror the SourceTag pattern in components/analytics/parts.

export type TokenSource = "actual" | "estimate" | "mixed";

const TAG: Record<TokenSource, string> = {
  actual: "border-emerald-500/30 text-emerald-300",
  mixed: "border-amber-500/25 text-amber-300/80",
  estimate: "border-amber-500/40 bg-amber-500/10 text-amber-200",
};

export function TokenTag({ source }: { source: TokenSource }) {
  return <span className={`rounded border px-1 text-[9px] font-medium uppercase tracking-wide ${TAG[source]}`}>{source}</span>;
}

export const fmt = (n: number | null | undefined): string => (n == null ? "—" : n.toLocaleString());

// One row in a "most expensive" glass list — key, runs/failed, best-known tokens + honesty tag.
export function UsageRow({
  name,
  runs,
  tokens,
  failed,
  source,
}: {
  name: string;
  runs: number;
  tokens: number;
  failed?: number;
  source: TokenSource;
}) {
  return (
    <div className="glass-card flex min-h-11 items-center gap-2.5 px-3 py-2">
      <span className="min-w-0 flex-1 truncate text-sm text-white/80" title={name}>{name}</span>
      {failed != null && failed > 0 && (
        <span className="shrink-0 rounded-full border border-red-500/30 bg-red-500/15 px-1.5 text-[10px] text-red-300">{failed} failed</span>
      )}
      <span className="shrink-0 text-[11px] text-white/35">{runs} run{runs === 1 ? "" : "s"}</span>
      <span className="shrink-0 tabular-nums text-sm text-white">{fmt(tokens)} <span className="text-[10px] text-white/35">tok</span></span>
      <TokenTag source={source} />
    </div>
  );
}

export function Skeleton({ className = "h-20" }: { className?: string }) {
  return <div className={`glass-card animate-pulse ${className}`} />;
}
