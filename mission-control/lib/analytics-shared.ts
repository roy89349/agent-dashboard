// Shared primitives for the KPI / Costs / Agent-Performance services. Every number carries a HONESTY LABEL so
// the UI can always show real-vs-estimate: "real" (a direct count from stored data), "derived" (an approximation
// from proxies, e.g. task lifespan as duration), or "estimate" (a modelled guess, e.g. cost with no token usage).
// No secrets, no shell-out; pure-ish over the existing tables.

export type MetricSource = "real" | "derived" | "estimate";
export interface Metric {
  key: string;
  label: string;
  value: number | string;
  unit?: string;
  source: MetricSource;
  note?: string;
}
export const metric = (key: string, label: string, value: number | string, source: MetricSource, extra: { unit?: string; note?: string } = {}): Metric =>
  ({ key, label, value, source, ...extra });

export type Period = "today" | "week" | "month" | "all";
export const PERIODS: Period[] = ["today", "week", "month", "all"];
/** Lower bound (ISO) for a period, or null for "all". Uses local day boundaries. */
export function sinceFor(period: Period): string | null {
  const d = new Date();
  if (period === "today") { d.setHours(0, 0, 0, 0); return d.toISOString(); }
  if (period === "week") { d.setDate(d.getDate() - 7); return d.toISOString(); }
  if (period === "month") { d.setDate(d.getDate() - 30); return d.toISOString(); }
  return null;
}
export const inRange = (ts: string | null | undefined, since: string | null): boolean => !since || (!!ts && ts >= since);

/** Whole-hours (1 decimal) between two ISO timestamps; 0 if either is missing. */
export function hoursBetween(a: string | null | undefined, b: string | null | undefined): number {
  if (!a || !b) return 0;
  const ms = Math.abs(Date.parse(b) - Date.parse(a));
  return Number.isFinite(ms) ? Math.round(ms / 360000) / 10 : 0;
}
export const ageHours = (ts: string | null | undefined): number => (ts ? hoursBetween(ts, new Date().toISOString()) : 0);
export const avg = (xs: number[]): number => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : 0);
export const pct = (num: number, den: number): number => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);

/** A tiny daily trend series (for sparklines) — buckets ISO timestamps into the last `days` local days. */
export function dailyTrend(timestamps: (string | null | undefined)[], days = 7): { day: string; count: number }[] {
  const out: { day: string; count: number }[] = [];
  const start = new Date(); start.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(start); d.setDate(d.getDate() - i);
    const next = new Date(d); next.setDate(next.getDate() + 1);
    const lo = d.toISOString(), hi = next.toISOString();
    // label from LOCAL date parts (d is local midnight) — slicing the UTC ISO would shift the label a day in UTC+ zones
    const label = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    out.push({ day: label, count: timestamps.filter((t) => !!t && t! >= lo && t! < hi).length });
  }
  return out;
}
