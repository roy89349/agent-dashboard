import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

// Liquid-glass building blocks. Thin wrappers over the .glass* classes in globals.css so every
// screen shares one surface language. Presentational only — no data fetching, no state.

export function GlassPanel({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <section className={cn("glass", className)}>{children}</section>;
}

export function GlassCard({
  className,
  hover = false,
  children,
}: {
  className?: string;
  hover?: boolean;
  children: React.ReactNode;
}) {
  return <div className={cn("glass-card", hover && "glass-hover", className)}>{children}</div>;
}

// Small uppercase section label ("Command", "Timeline", …)
export function SectionLabel({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <p className={cn("text-[11px] font-semibold uppercase tracking-[0.14em] text-white/35", className)}>
      {children}
    </p>
  );
}

// Page header: title + status subtitle + right-aligned quick actions.
export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold tracking-tight text-white sm:text-2xl">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-white/45">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const METRIC_TONE: Record<string, string> = {
  default: "text-white",
  ok: "text-emerald-300",
  warn: "text-amber-300",
  danger: "text-red-400",
  info: "text-indigo-300",
};

// Compact metric card for metrics rows / analytics grids.
export function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  href,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  tone?: keyof typeof METRIC_TONE;
  href?: string;
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[11px] font-medium uppercase tracking-wide text-white/40">{label}</p>
        {Icon && <Icon className="size-3.5 shrink-0 text-white/25" />}
      </div>
      <p className={cn("mt-1 text-xl font-semibold tabular-nums leading-tight", METRIC_TONE[tone])}>
        {value}
      </p>
      {hint && <div className="mt-0.5 truncate text-[11px] text-white/35">{hint}</div>}
    </>
  );
  const cls = cn("glass-card px-3.5 py-3", href && "glass-hover block", className);
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
